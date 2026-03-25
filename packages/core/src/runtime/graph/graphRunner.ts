// ── Agent Graph Runner ─────────────────────────────────────────────────
//
// Executes a validated GraphDefinition deterministically:
//   1. Compute SCCs (Tarjan's algorithm) and condense into execution plan
//   2. Walk groups in topological order; skip unreachable groups
//   3. Single-node groups: execute once with reachability tracking
//   4. Loop SCCs: execute iteratively until a condition exits the SCC
//   5. Handle per-node error policies (halt / retry / skip / fallback)
//   6. Return full execution result with per-node provenance
//
// Loops are supported when a cycle contains a condition node that has at
// least one branch exiting the SCC.  The `vars` store enables feeding
// updated values (e.g. page++) back into earlier nodes on next iteration.
//
// The runner is completely additive — it does NOT touch the existing
// autonomous / triggered pipeline code paths.

import { randomUUID } from "node:crypto";

import type {
  ConditionPredicate,
  ErrorPolicy,
  GraphDefinition,
  GraphEdge,
  GraphExecutionContext,
  GraphExecutionResult,
  GraphNode,
  GraphRunOptions,
  NodeOutput,
} from "./types.js";
import { validateGraph, tarjanSCC } from "./graphValidator.js";
import { loadGraph } from "./graphStore.js";
import { runGraphTracked } from "./graphRunRegistry.js";
import { resolveConfig } from "../config/configResolver.js";
import { createToolContext } from "../tools/toolContext.js";
import { callProvider } from "../providers/providerRouter.js";
import { getTool } from "../tools/toolLoader.js";
import { getSkill } from "../skills/skillLoader.js";

// Lazy import to avoid circular deps (same pattern as subagentTools.ts).
let _runAutonomousTask: typeof import("../pipeline/autonomous.js").runAutonomousTask | null = null;
async function getRunAutonomousTask() {
  if (!_runAutonomousTask) {
    const mod = await import("../pipeline/autonomous.js");
    _runAutonomousTask = mod.runAutonomousTask;
  }
  return _runAutonomousTask;
}

// ── Logging ────────────────────────────────────────────────────────────

const log  = (...a: unknown[]) => console.log("[graph:runner]", ...a);
const logW = (...a: unknown[]) => console.warn("[graph:runner]", ...a);
const logE = (...a: unknown[]) => console.error("[graph:runner]", ...a);

// ── Internal types ─────────────────────────────────────────────────────

/**
 * Reason a loop SCC stopped iterating.
 *
 * - "condition"     — a condition node branched out of the SCC (clean exit)
 * - "maxIterations" — the loop consumed all allowed iterations
 * - "error"         — a halt-policy error occurred inside the loop
 * - "abort"         — the run was cancelled via AbortSignal
 *
 * "condition" exits do NOT trigger catch nodes.  The other three do when
 * a catch node declares the matching CatchTrigger.
 */
type LoopExitReason = "condition" | "maxIterations" | "error" | "abort";

// ── Public entry point ─────────────────────────────────────────────────

/**
 * Execute an agent graph.
 *
 * @param graphOrId  A full {@link GraphDefinition} object or the graph ID
 *                   (loads from `~/.nyteshift/graphs/<id>.json`).
 * @param options    Execution options (input variables, signal, callbacks).
 */
export async function runGraph(
  graphOrId: GraphDefinition | string,
  options: GraphRunOptions = {},
): Promise<GraphExecutionResult> {
  const startedAt = Date.now();
  const traceId = `graph:${randomUUID()}`;

  // ── Load graph ────────────────────────────────────────────────────────
  const graph: GraphDefinition | null =
    typeof graphOrId === "string" ? await loadGraph(graphOrId) : graphOrId;

  if (!graph) {
    throw new Error(`Graph "${graphOrId}" not found.`);
  }

  log(`▶ graph run — id="${graph.id}" name="${graph.name}" trace="${traceId}"`);

  // ── Validate ──────────────────────────────────────────────────────────
  const validationErrors = validateGraph(graph);
  if (validationErrors.length > 0) {
    const msgs = validationErrors.map((e) => e.message).join("; ");
    throw new Error(`Invalid graph "${graph.id}": ${msgs}`);
  }

  // ── Resolve global config ─────────────────────────────────────────────
  const globalConfig = await resolveConfig();

  // ── Execution context ─────────────────────────────────────────────────
  const context: GraphExecutionContext = {
    input: options.input ?? {},
    // Seed vars from graph.initVars, then allow options.input to override.
    // This gives graph authors defaults (e.g. page: 1) while still letting
    // callers pass different starting values at run-time.
    // When resuming a paused run, initialContext.vars supplements the seed.
    vars: { ...(graph.initVars ?? {}), ...(options.input ?? {}), ...(options.initialContext?.vars ?? {}) },
    nodeOutputs: { ...(options.initialContext?.nodeOutputs ?? {}) } as Record<string, NodeOutput>,
    traceId,
    startedAt,
    signal: options.signal,
    _triggerDepth: options._triggerDepth ?? 0,
  };

  // ── Build lookup structures ───────────────────────────────────────────
  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  // Outgoing edges per node (regular edges only — condition branches
  // are handled separately inside condition-node execution).
  const outgoing = new Map<string, GraphEdge[]>();
  for (const node of graph.nodes) outgoing.set(node.id, []);
  for (const edge of graph.edges ?? []) {
    outgoing.get(edge.source)?.push(edge);
  }

  // ── Compute SCC-based execution plan ───────────────────────────────────
  const executionPlan = computeExecutionPlan(graph);
  log(`  execution plan: ${executionPlan.map(g =>
    g.type === "node" ? g.id : `[loop:${[...g.scc].join("+")}]`).join(" → ")}`);

  // ── Reachability set ──────────────────────────────────────────────────────
  // Seed reachability for groups that have no external predecessors.
  const allExternalIncoming = computeAllExternalIncomingCounts(graph, executionPlan);
  const reachable = new Set<string>();
  for (const group of executionPlan) {
    const representative = group.type === "node" ? group.id : group.entryId;
    if ((allExternalIncoming.get(representative) ?? 0) === 0) reachable.add(representative);
  }

  // ── Walk nodes ────────────────────────────────────────────────────────
  const nodeResults: NodeOutput[] = [];
  let finalOutput: unknown = undefined;
  let graphError: string | undefined;
  let graphStatus: "completed" | "failed" | "aborted" | "paused" = "completed";
  /** Set when a handled catch node requests manual resume instead of auto-continue. */
  let manualPauseInfo: { pausedResumeFrom?: string } | null = null;

  // Tracks how many times each catch node (by id) has fired in this run.
  // Used to enforce catchMaxFires limits (undefined/1 = once, 0 = unlimited).
  const catchFireCounts = new Map<string, number>();

  // Tracks cumulative iterations per loop SCC (keyed by group entryId).
  // When a catch node re-enters a loop, the iteration count carries over so
  // maxIterations is enforced across all passes through the same loop.
  const loopIterCounts = new Map<string, number>();

  // Use index-based loop so catch nodes can rewind/jump to earlier groups.
  for (let _planIdx = 0; _planIdx < executionPlan.length; _planIdx++) {
    const group = executionPlan[_planIdx]!;
    // Only treat a real AbortSignal as an immediate hard stop here.
    // Soft-stop requests (`options._softStop?.requested`) are handled inside
    // loop SCC execution so catch nodes can run; don't break the whole run
    // at this outer boundary or we'll prevent downstream nodes from running.
    if (options.signal?.aborted) {
      graphStatus = "aborted";
      log(`  AbortSignal fired — stopping graph execution`);
      break;
    }
    if (options._softStop?.requested) {
      log(`  soft-stop requested — will finish current work and run catches`);
    }

    if (group.type === "node") {
      const nodeId = group.id;
      const node = nodeMap.get(nodeId)!;

      // Catch nodes fire via post-SCC logic; skip here to prevent double-execution
      // or spurious skipped-output entries if the catch node never triggered.
      // We store a sentinel placeholder (metadata.__placeholder === true) so the
      // post-SCC guard can tell the difference between "never ran" and "already
      // ran for a previous SCC" — preventing the placeholder from blocking catch
      // execution when a loop exits with an error.
      if (node.type === "catch") {
        if (!context.nodeOutputs[node.outputKey ?? node.id]) {
          const placeholder = makeCatchPlaceholder(node);
          nodeResults.push(placeholder);
          context.nodeOutputs[node.outputKey ?? node.id] = placeholder;
          options.onNodeComplete?.(placeholder);
        }
        continue;
      }

      if (!reachable.has(nodeId)) {
        const skipOut = makeSkippedOutput(node);
        nodeResults.push(skipOut);
        context.nodeOutputs[node.outputKey ?? node.id] = skipOut;
        options.onNodeComplete?.(skipOut);
        continue;
      }

      const policy = node.errorPolicy ?? graph.errorPolicy ?? { type: "halt" };
      options.onNodeStart?.(node.id, node.name, node.type);
      const nodeOutput = await executeNodeWithPolicy(node, context, globalConfig, graph, options, policy);
      // Annotate returned output with node type for UI/icon rendering
      try { (nodeOutput as any).nodeType = node.type; } catch {}
      nodeResults.push(nodeOutput);
      context.nodeOutputs[node.outputKey ?? node.id] = nodeOutput;
      options.onNodeComplete?.(nodeOutput);

      if (node.type === "output" && nodeOutput.status === "success") {
        finalOutput = nodeOutput.output;
      } else if (nodeOutput.status === "success" && node.type !== "condition") {
        finalOutput = nodeOutput.output;
      }

      if (nodeOutput.status === "error" && policy.type === "halt") {
        // Top-level node error: run matching catch nodes (same semantics
        // as loop SCC exits). This allows graph authors to catch errors
        // even when the failing node is not part of a loop.
        context._loopExitReason = "error";

        const matchingCatchNodes = graph.nodes
          .filter(n => {
            if (n.type !== "catch") return false;
            if (!(n.catchTriggers ?? []).some(t => t === "error")) return false;
            const fireCount = catchFireCounts.get(n.id) ?? 0;
            const maxFires = (n.catchMaxFires === undefined || n.catchMaxFires === 1) ? 1
              : n.catchMaxFires <= 0 ? Infinity
              : n.catchMaxFires;
            return fireCount < maxFires;
          })
          .sort((a, b) => (a.catchOrder ?? Infinity) - (b.catchOrder ?? Infinity));

        const firedCatches: Array<{ catchNode: typeof graph.nodes[0]; catchOut: import("./types.js").NodeOutput; handled: boolean }> = [];
        let _catchResumeIdx: number | undefined;

        for (const catchNode of matchingCatchNodes) {
          log(`  catch node "${catchNode.id}" triggered (reason="error", catchOrder=${catchNode.catchOrder ?? "unset"})`);
          try {
            const outs = (outgoing.get(catchNode.id) ?? []).map(e => e.target).join(", ");
            log(`  catch "${catchNode.id}" outgoing edges: ${outs}`);
          } catch {}
          options.onNodeStart?.(catchNode.id, catchNode.name, catchNode.type);
          const catchPolicy = catchNode.errorPolicy ?? graph.errorPolicy ?? { type: "halt" };
          const catchOut = await executeNodeWithPolicy(catchNode, context, globalConfig, graph, options, catchPolicy);
          catchFireCounts.set(catchNode.id, (catchFireCounts.get(catchNode.id) ?? 0) + 1);
          try { (catchOut as any).nodeType = catchNode.type; } catch {}
          nodeResults.push(catchOut);
          context.nodeOutputs[catchNode.outputKey ?? catchNode.id] = catchOut;
          options.onNodeComplete?.(catchOut);

          if (catchOut.status === "error") {
            logW(`  catch node "${catchNode.id}" errored — trying next catch node`);
            firedCatches.push({ catchNode, catchOut, handled: false });
            continue;
          }

          const strategy = catchNode.resumeStrategy ?? "resumeFrom";
          if (strategy === "rewindTo" && catchNode.resumeTarget) {
            const targetKey = nodeMap.get(catchNode.resumeTarget)?.outputKey ?? catchNode.resumeTarget;
            const existingOutput = context.nodeOutputs[targetKey];
            const alreadyRan = existingOutput &&
              existingOutput.status !== "skipped" &&
              !(existingOutput.metadata as any)?.__placeholder;
            if (!alreadyRan) {
              log(`  catch "${catchNode.id}" resumeStrategy "rewindTo" — target "${catchNode.resumeTarget}" has NOT run yet, skipping this catch`);
              firedCatches.push({ catchNode, catchOut, handled: false });
              continue;
            }
          }

          const resumePolicy = catchNode.resumePolicy ?? "never";
          let thisHandled = false;
          if (resumePolicy === "always") {
            thisHandled = true;
          } else if (resumePolicy === "ifHandled") {
            if (catchNode.handledOutputPath) {
              const parts = catchNode.handledOutputPath
                .replace(/\[(\d+)\]/g, ".$1")
                .replace(/^output\./, "")
                .split(".");
              let val: unknown = catchOut.output;
              for (const part of parts) {
                if (val !== null && typeof val === "object") {
                  val = (val as Record<string, unknown>)[part];
                } else { val = undefined; break; }
              }
              thisHandled = !!val;
            }
            if (!thisHandled && catchNode.handledWhen) {
              thisHandled = evaluateCondition(catchNode.handledWhen, context);
            }
          }

          if (catchOut.status === "success" || catchPolicy.type === "fallback") {
            propagateReachability(catchNode, outgoing.get(catchNode.id) ?? [], context, reachable);
            if (thisHandled && catchNode.resumeTarget) {
              if ((catchNode as any).manualResume) {
                if (!manualPauseInfo) manualPauseInfo = { pausedResumeFrom: catchNode.resumeTarget };
                log(`  catch "${catchNode.id}" manualResume → "${catchNode.resumeTarget}" (will pause after notification nodes run)`);
              } else {
                const resumeGroupIdx = executionPlan.findIndex(g => {
                  if (g.type === "node") return g.id === catchNode.resumeTarget;
                  return g.scc.has(catchNode.resumeTarget!);
                });
                if (resumeGroupIdx >= 0) {
                  reachable.add(catchNode.resumeTarget!);
                  const resumeGroup = executionPlan[resumeGroupIdx]!;
                  if (resumeGroup.type === "loop") reachable.add(resumeGroup.entryId);
                  log(`  catch "${catchNode.id}" ${strategy} → "${catchNode.resumeTarget}" (plan index ${resumeGroupIdx}, current ${_planIdx})`);
                  _catchResumeIdx = resumeGroupIdx;
                } else {
                  reachable.add(catchNode.resumeTarget!);
                  log(`  catch "${catchNode.id}" resumeTarget → "${catchNode.resumeTarget}" added to reachable (group not found — forward-only fallback)`);
                }
              }
            }
          }

          firedCatches.push({ catchNode, catchOut, handled: thisHandled });
          if (thisHandled) break;
        }

        let nodeErrorHandled = false;
        if (nodeOutput && firedCatches.length > 0) {
          const successfulCatch = firedCatches.find(fc => fc.catchOut.status !== "error" && fc.handled);
          if (successfulCatch) {
            nodeErrorHandled = true;
            log(`  node error handled by catch "${successfulCatch.catchNode.id}" — continuing execution`);
          }
        }

        if (!nodeErrorHandled) {
          graphError = nodeOutput.error;
          graphStatus = "failed";
          break;
        }

        if (_catchResumeIdx !== undefined) {
          log(`  catch resume: rewinding plan index from ${_planIdx} to ${_catchResumeIdx}`);
          _planIdx = _catchResumeIdx - 1; // -1 because the for-loop will increment
          continue; // resume plan at requested group
        }

        // If handled and no resume requested, continue normal plan execution.
        continue;
      }

      if (nodeOutput.status === "success" || (policy.type === "fallback" && nodeOutput.status !== "error")) {
        propagateReachability(node, outgoing.get(nodeId) ?? [], context, reachable);
      }
    } else {
      // Loop SCC
      if (!reachable.has(group.entryId)) {
        for (const id of group.scc) {
          const node = nodeMap.get(id)!;
          const skipOut = makeSkippedOutput(node);
          nodeResults.push(skipOut);
          context.nodeOutputs[node.outputKey ?? node.id] = skipOut;
          options.onNodeComplete?.(skipOut);
        }
        continue;
      }

      const loopResult = await runLoopSCC(group, graph, context, nodeMap, outgoing, globalConfig, options, loopIterCounts.get(group.entryId) ?? 0);
      nodeResults.push(...loopResult.results);
      loopIterCounts.set(group.entryId, loopResult.totalIterations);
      // onNodeComplete is already called inside runLoopSCC — do not duplicate.

      // ── Fire catch nodes ────────────────────────────────────────────────
      // Execute matching catch nodes immediately so their outputs are
      // available to downstream nodes in the remainder of the plan.
      // This runs before the error-halt check so catch nodes with
      // trigger="error" fire even when the loop halted on an error.
      // Allow user-invoked stop/abort to influence the loop exit reason
      // and surface a more specific stop kind in catch outputs.
      // If a soft-stop was requested by the user, prefer "abort" so
      // catch nodes that listen for "abort" trigger will run.
      // Also expose `stopKind` on the catch output for UI clarity.
      if (options._softStop?.requested && options._softStop.kind === "manualStop") {
        // If the loop naturally ended due to maxIterations but the user
        // requested a soft stop during the run, report "abort" so catch
        // nodes with trigger "abort" fire; also mark stopKind so UIs can
        // display "manual stop" instead of generic "abort".
        if (loopResult.exitReason === "maxIterations") loopResult.exitReason = "abort";
        (context as any)._stopKind = "manualStop";
      }
      // If the AbortSignal fired and the registry recorded a manual hard
      // abort for this run, surface that as a manualAbort stopKind.
      try {
        // Import registry lazily to avoid circular top-level imports.
        const { graphRunRegistry } = await import("./graphRunRegistry.js");
        if (options.signal?.aborted && options._runId && graphRunRegistry.wasHardAborted(options._runId)) {
          loopResult.exitReason = "abort";
          (context as any)._stopKind = "manualAbort";
        }
      } catch {}
      context._loopExitReason = loopResult.exitReason;

      // ── Sort and fire catch nodes in catchOrder priority ──────────────────
      // Catch nodes are tried in ascending catchOrder (lower = higher priority;
      // unset = tried last).  If a catch node itself errors, execution continues
      // to the next candidate.  If a catch node executes without error but does
      // NOT meet "resume from" criteria (thisHandled is false), execution also
      // continues to the next candidate.  Only when a catch node executes without
      // error AND meets "resume from" criteria (thisHandled is true) are remaining
      // candidates skipped.
      const matchingCatchNodes = graph.nodes
        .filter(n => {
          if (n.type !== "catch") return false;
          if (!(n.catchTriggers ?? []).some(t => t === loopResult.exitReason)) return false;
          // Enforce catchMaxFires limit.
          // undefined and 1 both mean "fire at most once" (default).
          // 0 means unlimited.  Any other positive integer is the cap.
          const fireCount = catchFireCounts.get(n.id) ?? 0;
          const maxFires = (n.catchMaxFires === undefined || n.catchMaxFires === 1) ? 1
            : n.catchMaxFires <= 0 ? Infinity
            : n.catchMaxFires;
          return fireCount < maxFires;
        })
        .sort((a, b) => (a.catchOrder ?? Infinity) - (b.catchOrder ?? Infinity));

      const firedCatches: Array<{ catchNode: typeof graph.nodes[0]; catchOut: import("./types.js").NodeOutput; handled: boolean }> = [];
      /** When set, the plan index is rewound/jumped after catch handling. */
      let _catchResumeIdx: number | undefined;

      for (const catchNode of matchingCatchNodes) {
        log(`  catch node "${catchNode.id}" triggered (reason="${loopResult.exitReason}", catchOrder=${catchNode.catchOrder ?? "unset"})`);
        // Debug: list outgoing edges for the catch so we can trace routing
        try {
          const outs = (outgoing.get(catchNode.id) ?? []).map(e => e.target).join(", ");
          log(`  catch "${catchNode.id}" outgoing edges: ${outs}`);
        } catch {}
        options.onNodeStart?.(catchNode.id, catchNode.name, catchNode.type);
        const catchPolicy = catchNode.errorPolicy ?? graph.errorPolicy ?? { type: "halt" };
        const catchOut = await executeNodeWithPolicy(catchNode, context, globalConfig, graph, options, catchPolicy);
        // Count this execution regardless of outcome so catchMaxFires is enforced.
        catchFireCounts.set(catchNode.id, (catchFireCounts.get(catchNode.id) ?? 0) + 1);
        try { (catchOut as any).nodeType = catchNode.type; } catch {}
        nodeResults.push(catchOut);
        context.nodeOutputs[catchNode.outputKey ?? catchNode.id] = catchOut;
        options.onNodeComplete?.(catchOut);

        if (catchOut.status === "error") {
          // This catch node itself failed — record it and continue to the next one.
          logW(`  catch node "${catchNode.id}" errored — trying next catch node`);
          firedCatches.push({ catchNode, catchOut, handled: false });
          continue;
        }

        // ── rewindTo pre-check ──────────────────────────────────────────────
        // When resumeStrategy is "rewindTo", the target node must have already
        // executed in this run.  If it hasn't, this catch is NOT considered
        // handled — skip it and try the next catch candidate.
        const strategy = catchNode.resumeStrategy ?? "resumeFrom";
        if (strategy === "rewindTo" && catchNode.resumeTarget) {
          const targetKey = nodeMap.get(catchNode.resumeTarget)?.outputKey ?? catchNode.resumeTarget;
          const existingOutput = context.nodeOutputs[targetKey];
          const alreadyRan = existingOutput &&
            existingOutput.status !== "skipped" &&
            !(existingOutput.metadata as any)?.__placeholder;
          if (!alreadyRan) {
            log(`  catch "${catchNode.id}" resumeStrategy "rewindTo" — target "${catchNode.resumeTarget}" has NOT run yet, skipping this catch`);
            firedCatches.push({ catchNode, catchOut, handled: false });
            continue;
          }
        }

        // This catch node executed successfully — determine if it handled the error.
        const resumePolicy = catchNode.resumePolicy ?? "never";
        let thisHandled = false;
        if (resumePolicy === "always") {
          thisHandled = true;
        } else if (resumePolicy === "ifHandled") {
          // Check handledOutputPath first (truthy field in the catch output).
          if (catchNode.handledOutputPath) {
            const parts = catchNode.handledOutputPath
              .replace(/\[(\d+)\]/g, ".$1")
              .replace(/^output\./, "")
              .split(".");
            let val: unknown = catchOut.output;
            for (const part of parts) {
              if (val !== null && typeof val === "object") {
                val = (val as Record<string, unknown>)[part];
              } else { val = undefined; break; }
            }
            thisHandled = !!val;
          }
          // Then check handledWhen predicate (overrides if both are present).
          if (!thisHandled && catchNode.handledWhen) {
            thisHandled = evaluateCondition(catchNode.handledWhen, context);
          }
        }
        if (catchOut.status === "success" || catchPolicy.type === "fallback") {
          propagateReachability(catchNode, outgoing.get(catchNode.id) ?? [], context, reachable);
          // Apply resumeTarget — supports jumping to ANY node in the plan.
          if (thisHandled && catchNode.resumeTarget) {
            if ((catchNode as any).manualResume) {
              if (!manualPauseInfo) {
                manualPauseInfo = { pausedResumeFrom: catchNode.resumeTarget };
              }
              log(`  catch "${catchNode.id}" manualResume → "${catchNode.resumeTarget}" (will pause after notification nodes run)`);
            } else {
              // Find the execution plan group that contains (or IS) the resume target
              // and rewind _planIdx so the runner re-enters at that point.
              const resumeGroupIdx = executionPlan.findIndex(g => {
                if (g.type === "node") return g.id === catchNode.resumeTarget;
                return g.scc.has(catchNode.resumeTarget!);
              });
              if (resumeGroupIdx >= 0) {
                reachable.add(catchNode.resumeTarget!);
                // If the target is inside a loop SCC, mark the entry reachable too
                const resumeGroup = executionPlan[resumeGroupIdx]!;
                if (resumeGroup.type === "loop") reachable.add(resumeGroup.entryId);
                log(`  catch "${catchNode.id}" ${strategy} → "${catchNode.resumeTarget}" (plan index ${resumeGroupIdx}, current ${_planIdx})`);
                // Set the plan index so the next iteration of the outer loop
                // picks up from the group containing the target.  Works for
                // both forward jumps AND backward rewinds.
                _catchResumeIdx = resumeGroupIdx;
              } else {
                reachable.add(catchNode.resumeTarget!);
                log(`  catch "${catchNode.id}" resumeTarget → "${catchNode.resumeTarget}" added to reachable (group not found — forward-only fallback)`);
              }
            }
          }
        }
        firedCatches.push({ catchNode, catchOut, handled: thisHandled });
        // Only stop trying further catch nodes if this one handled the error.
        if (thisHandled) break;
      }

      // ── Evaluate whether the loop error has been handled ──────────────────
      let loopErrorHandled = false;
      if (loopResult.error && firedCatches.length > 0) {
        const successfulCatch = firedCatches.find(fc => fc.catchOut.status !== "error" && fc.handled);
        if (successfulCatch) {
          loopErrorHandled = true;
          log(`  loop error handled by catch "${successfulCatch.catchNode.id}" — continuing execution`);
        }
      }

      if (loopResult.error && !loopErrorHandled) {
        graphError = loopResult.error;
        graphStatus = "failed";
        break;
      }

      // If a catch requested a plan rewind/jump, apply it now.
      if (_catchResumeIdx !== undefined) {
        log(`  catch resume: rewinding plan index from ${_planIdx} to ${_catchResumeIdx}`);
        _planIdx = _catchResumeIdx - 1; // -1 because the for-loop will increment
        _catchResumeIdx = undefined;
        continue; // skip the normal post-loop reachability propagation
      }

      if (loopResult.exitTarget) reachable.add(loopResult.exitTarget);
      for (const id of group.scc) {
        for (const edge of outgoing.get(id) ?? []) {
          if (!group.scc.has(edge.target)) {
            if (!edge.condition || evaluateCondition(edge.condition, context)) {
              reachable.add(edge.target);
            }
          }
        }
      }
      const lastSuccess = [...loopResult.results].reverse().find(r => r.status === "success");
      if (lastSuccess) finalOutput = lastSuccess.output;
    }
  }

  const completedAt = Date.now();

  // Manual pause: save context snapshot and return paused status.
  // Any notification/cleanup nodes downstream of the catch have already run.
  if (manualPauseInfo && graphStatus === "completed") {
    graphStatus = "paused";
    const pausedContext = { vars: { ...context.vars }, nodeOutputs: { ...context.nodeOutputs } };
    log(`■ graph paused — trace="${traceId}" resumeFrom="${manualPauseInfo.pausedResumeFrom}" elapsed=${completedAt - startedAt}ms`);
    return {
      graphId: graph.id,
      graphName: graph.name,
      traceId,
      nodeResults,
      finalOutput,
      status: "paused",
      elapsedMs: completedAt - startedAt,
      startedAt,
      completedAt,
      pausedContext,
      pausedResumeFrom: manualPauseInfo.pausedResumeFrom,
    };
  }

  // If a soft-stop was requested, mark the run as aborted (user asked to stop).
  if (options._softStop?.requested && graphStatus === "completed") {
    graphStatus = "aborted";
  }
  log(`■ graph complete — trace="${traceId}" status=${graphStatus} elapsed=${completedAt - startedAt}ms`);

  return {
    graphId: graph.id,
    graphName: graph.name,
    traceId,
    nodeResults,
    finalOutput,
    status: graphStatus,
    error: graphError,
    elapsedMs: completedAt - startedAt,
    startedAt,
    completedAt,
  };
}

// ── Reachability propagation ───────────────────────────────────────────

function propagateReachability(
  node: GraphNode,
  edges: GraphEdge[],
  context: GraphExecutionContext,
  reachable: Set<string>,
): void {
  // Condition nodes: exclusive routing via branches
  if (node.type === "condition" && node.branches) {
    let matched = false;
    for (const branch of node.branches) {
      if (!matched && evaluateCondition(branch.condition, context)) {
        reachable.add(branch.target);
        matched = true;
        log(`    branch "${branch.label}" → node "${branch.target}" (activated)`);
      }
    }
    if (!matched && node.defaultTarget) {
      reachable.add(node.defaultTarget);
      log(`    default → node "${node.defaultTarget}" (activated)`);
    }
    if (!matched && !node.defaultTarget) {
      logW(`    no branch matched and no defaultTarget — downstream nodes will be skipped`);
    }
  }

  // Regular outgoing edges (conditional or unconditional)
  for (const edge of edges) {
    if (edge.condition) {
      const ok = evaluateCondition(edge.condition, context);
      if (ok) reachable.add(edge.target);
      log(`    propagate: node "${node.id}" -> "${edge.target}" (condition ${ok ? 'passed' : 'failed'})`);
    } else {
      reachable.add(edge.target);
      log(`    propagate: node "${node.id}" -> "${edge.target}" (unconditional)`);
    }
  }
}

// ── Node execution with error policy ───────────────────────────────────

async function executeNodeWithPolicy(
  node: GraphNode,
  context: GraphExecutionContext,
  globalConfig: import("../../types/index.js").NyteShiftConfig,
  graph: GraphDefinition,
  options: GraphRunOptions,
  policy: ErrorPolicy,
): Promise<NodeOutput> {
  const maxAttempts = policy.type === "retry" ? (policy.maxRetries ?? 3) : 1;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay =
        (policy.retryDelayMs ?? 1000) *
        Math.pow(policy.retryBackoffMultiplier ?? 2, attempt - 1);
      log(`    retry ${attempt}/${maxAttempts - 1} after ${delay}ms…`);
      await sleep(delay);
    }

    try {
      return await executeNode(node, context, globalConfig, graph, options);
    } catch (err) {
      lastError = err as Error;
      logW(`    attempt ${attempt + 1}/${maxAttempts} failed: ${lastError.message}`);
    }
  }

  // All attempts exhausted
  if (policy.type === "fallback") {
    log(`    using fallback value`);
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      output: policy.fallbackValue ?? null,
      metadata: { elapsedMs: 0 },
      status: "success",
      error: lastError?.message,
      timestamp: Date.now(),
    };
  }

  if (policy.type === "skip") {
    log(`    skipping node after failure`);
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      output: policy.fallbackValue ?? null,
      metadata: { elapsedMs: 0 },
      status: "skipped",
      error: lastError?.message,
      timestamp: Date.now(),
    };
  }

  // halt or retry-exhausted
  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    output: (lastError as any)?.providerOutput ?? null,
    metadata: { elapsedMs: 0 },
    status: "error",
    error: lastError?.message ?? "Unknown error",
    timestamp: Date.now(),
  };
}

// ── Individual node executors ──────────────────────────────────────────

async function executeNode(
  node: GraphNode,
  context: GraphExecutionContext,
  globalConfig: import("../../types/index.js").NyteShiftConfig,
  graph: GraphDefinition,
  options: GraphRunOptions,
): Promise<NodeOutput> {
  switch (node.type) {
    case "input":
      return executeInputNode(node, context);
    case "output":
      return executeOutputNode(node, context);
    case "llm":
      return executeLlmNode(node, context, globalConfig, graph, options);
    case "skill":
      return executeSkillNode(node, context, globalConfig, graph, options);
    case "agent":
      return executeAgentNode(node, context, globalConfig, graph, options);
    case "tool":
      return executeToolNode(node, context, options);
    case "condition":
      return executeConditionNode(node, context);
    case "operation":
      return executeOperationNode(node, context);
    case "catch":
      return executeCatchNode(node, context);
    case "trigger":
      return executeTriggerNode(node, context, globalConfig, graph, options);
    default:
      throw new Error(`Unknown node type "${(node as GraphNode).type}".`);
  }
}

// ── Input node ─────────────────────────────────────────────────────────

function executeInputNode(node: GraphNode, context: GraphExecutionContext): NodeOutput {
  log(`    input node — passing through graph input variables`);
  return {
    nodeId: node.id,
    nodeName: node.name,
    output: context.input,
    metadata: { elapsedMs: 0 },
    status: "success",
    timestamp: Date.now(),
  };
}

// ── Output node ────────────────────────────────────────────────────────

function executeOutputNode(node: GraphNode, context: GraphExecutionContext): NodeOutput {
  // Collect the output from the promptTemplate reference, or fall back to
  // the most recently stored node output.
  let output: unknown;
  if (node.promptTemplate) {
    output = interpolateTemplate(node.promptTemplate, context);
  } else {
    // Use the last non-condition, non-input node output
    const keys = Object.keys(context.nodeOutputs);
    for (let i = keys.length - 1; i >= 0; i--) {
      const no = context.nodeOutputs[keys[i]!];
      if (no && no.status === "success" && no.nodeId !== node.id) {
        output = no.output;
        break;
      }
    }
  }

  log(`    output node — finalising`);
  return {
    nodeId: node.id,
    nodeName: node.name,
    output,
    metadata: { elapsedMs: 0 },
    status: "success",
    timestamp: Date.now(),
  };
}

// ── LLM node ───────────────────────────────────────────────────────────

async function executeLlmNode(
  node: GraphNode,
  context: GraphExecutionContext,
  globalConfig: import("../../types/index.js").NyteShiftConfig,
  graph: GraphDefinition,
  options: GraphRunOptions,
): Promise<NodeOutput> {
  const startTime = Date.now();

  const provider =
    node.provider ?? options.provider ?? graph.defaultProvider ??
    (globalConfig.defaultProvider as string | undefined) ?? "openai";
  const model =
    node.model ?? options.model ?? graph.defaultModel ??
    (globalConfig.defaultModel as string | undefined) ?? "gpt-4o";
  const temperature = node.temperature ?? 0.7;
  const maxTokens = node.maxTokens ?? 4096;

  let systemPrompt = node.systemPrompt ?? "You are a helpful AI assistant.";

  // Auto-inject skill node outputs via edges: any skill node with an edge to this LLM node
  // has its output appended to the system prompt as instructions.
  const incomingSkillNodes = graph.edges
    .filter(e => e.target === node.id)
    .map(e => graph.nodes.find(n => n.id === e.source))
    .filter((n): n is GraphNode => n?.type === "skill");
  if (incomingSkillNodes.length > 0) {
    const skillSections: string[] = [];
    for (const sn of incomingSkillNodes) {
      const skillOut = context.nodeOutputs[sn.outputKey ?? sn.id];
      if (skillOut?.status === "success" && skillOut.output != null) {
        const text = typeof skillOut.output === "string"
          ? skillOut.output
          : JSON.stringify(skillOut.output, null, 2);
        skillSections.push(text);
      }
    }
    if (skillSections.length > 0) {
      systemPrompt = `${systemPrompt}\n\n--- Skill Instructions ---\n${skillSections.join("\n\n")}`;
    }
  }

  const userPrompt = interpolateTemplate(node.promptTemplate ?? "", context);

  log(`    llm call — provider="${provider}" model="${model}"`);

  let result: Awaited<ReturnType<typeof callProvider>>;
  try {
    result = await callProvider(provider, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      maxTokens,
    });
  } catch (err) {
    // Re-throw an enhanced error that carries the raw provider error body so
    // executeNodeWithPolicy can surface it as the node output rather than null.
    // Provider error messages typically look like:
    //   "[openrouter] 400 — {"error":{"message":"...","code":400}}"
    const errMsg = (err as Error).message ?? String(err);
    let providerOutput: unknown;
    try {
      const jsonMatch = errMsg.match(/\{[\s\S]*\}/);
      if (jsonMatch) providerOutput = JSON.parse(jsonMatch[0]);
    } catch { /* leave undefined */ }
    const enhanced = new Error(errMsg);
    (enhanced as any).providerOutput = providerOutput ?? errMsg;
    throw enhanced;
  }

  // Try to parse JSON output for easier downstream referencing
  let parsedOutput: unknown = result.output;
  try {
    parsedOutput = JSON.parse(result.output);
  } catch {
    // keep as string
  }

  const elapsed = Date.now() - startTime;
  log(`    llm response in ${elapsed}ms — ${result.output.length} chars`);

  return {
    nodeId: node.id,
    nodeName: node.name,
    output: parsedOutput,
    rawOutput: result.output,
    metadata: {
      provider,
      model,
      tokens: result.usage
        ? { prompt: result.usage.promptTokens, completion: result.usage.completionTokens }
        : undefined,
      elapsedMs: elapsed,
    },
    status: "success",
    timestamp: Date.now(),
  };
}

// ── Skill node ─────────────────────────────────────────────────────────
// Skill nodes are data-only: they render the skill markdown/template using
// the current execution context and configured params, and return the
// rendered content as the node output. They do NOT perform an LLM call.
async function executeSkillNode(
  node: GraphNode,
  context: GraphExecutionContext,
  globalConfig: import("../../types/index.js").NyteShiftConfig,
  graph: GraphDefinition,
  options: GraphRunOptions,
): Promise<NodeOutput> {
  const startTime = Date.now();

  const skillRef = node.skillRef ?? "";
  if (!String(skillRef).trim()) {
    throw new Error(`Skill node "${node.id}" has no skillRef configured.`);
  }

  const skill = await getSkill(skillRef);
  if (!skill) {
    throw new Error(`Skill "${skillRef}" not found.`);
  }

  const rawParams = node.params ?? {};
  const resolvedParams = interpolateValue(rawParams, context) as Record<string, unknown>;

  // Apply config defaults from skill frontmatter
  const configDefaults: Record<string, unknown> = {};
  if (Array.isArray((skill.frontmatter as any)?.config)) {
    for (const c of (skill.frontmatter as any).config) {
      if (c && typeof c.key === "string" && c.default !== undefined) {
        configDefaults[c.key] = c.default;
      }
    }
  }

  const finalInputs = { ...configDefaults, ...resolvedParams };
  const derivedContext: GraphExecutionContext = { ...context, input: { ...(context.input ?? {}), ...finalInputs } };

  // Render the skill body/template into a plain string. This is returned
  // directly and later consumed by downstream LLM nodes (via edges).
  const rendered = interpolateTemplate((skill.body as string) ?? "", derivedContext);

  const elapsed = Date.now() - startTime;
  log(`    skill node — "${skillRef}" rendered (${String(rendered ?? "").length} chars)`);

  return {
    nodeId: node.id,
    nodeName: node.name,
    output: rendered,
    rawOutput: rendered,
    metadata: { elapsedMs: elapsed },
    status: "success",
    timestamp: Date.now(),
  };
}

// ── Agent node ─────────────────────────────────────────────────────────

async function executeAgentNode(
  node: GraphNode,
  context: GraphExecutionContext,
  globalConfig: import("../../types/index.js").NyteShiftConfig,
  graph: GraphDefinition,
  options: GraphRunOptions,
): Promise<NodeOutput> {
  const startTime = Date.now();
  const runAutonomousTask = await getRunAutonomousTask();

  const task = interpolateTemplate(node.promptTemplate ?? "", context);
  const agentName = node.agentName ?? graph.id;

  const provider =
    node.provider ?? options.provider ?? graph.defaultProvider ??
    (globalConfig.defaultProvider as string | undefined);
  const model =
    node.model ?? options.model ?? graph.defaultModel ??
    (globalConfig.defaultModel as string | undefined);

  log(`    agent run — agent="${agentName}" task="${task.slice(0, 100)}"`);

  const pipelineResult = await runAutonomousTask(agentName, task, {
    provider,
    model,
    temperature: node.temperature,
    maxTokens: node.maxTokens,
    // Pass node.maxSteps only when explicitly set on the graph node so that
    // autonomous.ts can fall back to agentCfg.maxSteps (the value configured
    // in Agent Settings).  A hardcoded ?? 10 here would shadow the agent's own
    // step budget and make the Agent Settings slider ineffective.
    maxSteps: node.maxSteps,
    signal: context.signal,
  });

  const elapsed = Date.now() - startTime;

  // Extract tool calls from pipeline steps for provenance
  const toolCalls = pipelineResult.steps
    .filter((s) => s.action.startsWith("tool-call:"))
    .map((s) => ({
      name: s.action.replace("tool-call:", ""),
      input: s.input,
      output: s.output,
    }));

  // Try to parse final output as JSON
  let parsedOutput: unknown = pipelineResult.finalOutput;
  try {
    parsedOutput = JSON.parse(pipelineResult.finalOutput);
  } catch {
    // keep as string
  }

  log(`    agent complete in ${elapsed}ms — ${pipelineResult.steps.length} steps, aborted=${pipelineResult.aborted}`);

  return {
    nodeId: node.id,
    nodeName: node.name,
    output: parsedOutput,
    rawOutput: pipelineResult.finalOutput,
    metadata: {
      provider: provider ?? undefined,
      model: model ?? undefined,
      elapsedMs: elapsed,
      agentSteps: pipelineResult.steps.length,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    status: pipelineResult.aborted ? "error" : "success",
    error: pipelineResult.aborted ? "Agent run was aborted." : undefined,
    timestamp: Date.now(),
  };
}

// ── Tool node ──────────────────────────────────────────────────────────

async function executeToolNode(
  node: GraphNode,
  context: GraphExecutionContext,
  options: GraphRunOptions,
): Promise<NodeOutput> {
  const startTime = Date.now();
  const tool = await getTool(node.toolName!);

  if (!tool) {
    throw new Error(`Tool "${node.toolName}" not found.`);
  }

  let input = node.toolInput
    ? interpolateValue(node.toolInput, context)
    : context.input;

  // If interpolation produced a JSON string (common when authoring JSON with
  // placeholders), try to parse it so tools receive structured input types
  // (numbers/booleans/objects) instead of a raw string.
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      // leave as string when not valid JSON
    }
  }

  // Recursively parse JSON-like strings inside nested structures so that
  // templates inserted into JSON text (e.g. "{{vars.uids}}" -> "[1,2]")
  // become real arrays/objects at runtime instead of remaining quoted strings.
  const jsonLike = /^\s*(?:\{[\s\S]*\}|\[[\s\S]*\]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\s*$/i;
  function deepParseJsonLike(val: unknown): unknown {
    if (typeof val === "string") {
      if (jsonLike.test(val)) {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    }
    if (Array.isArray(val)) return val.map(deepParseJsonLike);
    if (typeof val === "object" && val !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = deepParseJsonLike(v);
      return out;
    }
    return val;
  }

  input = deepParseJsonLike(input);

  log(`    tool call — "${node.toolName}"`);

  // DEBUG: capture tool shape and the final input value (type + preview)
  // This helps diagnose regressions where graph-run inputs appear unparsed
  // or tools behave differently when reloaded via cache-busting imports.
  try {
    const inputType = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
    let inputPreview: string;
    try {
      inputPreview = JSON.stringify(input);
    } catch {
      inputPreview = String(input);
    }
    const maxLen = 2000;
    if (inputPreview && inputPreview.length > maxLen) inputPreview = inputPreview.slice(0, maxLen) + "...";
    const toolKeys = Array.isArray(Object.keys(tool)) ? Object.keys(tool).slice(0, 20) : [];
    log(`    DEBUG tool.run type=${typeof (tool as any).run}, keys=${toolKeys.join(",")}`);
    log(`    DEBUG input (${inputType}) preview: ${inputPreview}`);
  } catch (err) {
    try { log(`    DEBUG inspect failed: ${(err as Error).message}`); } catch {}
  }
  // Provide bridge helpers only to tools that declare they need the bridge
  const needsBridge =
    (tool as any).spec?.requiresBridge === true ||
    (!!(tool as any).spec?.verify && Array.isArray((tool as any).spec.verify) && (tool as any).spec.verify.some((v: any) => String(v).startsWith("discord.")));

  // Build a bridge-helper base (only for tools that declare they need it), then
  // run the centralised factory so all paths receive identical secret-backed config.
  const bridgeBase: Record<string, unknown> = {};
  if (needsBridge) {
    try {
      const discordMod = await import("../discord/discordBridge.js");
      bridgeBase.getGlobalBridge = (discordMod as any).getGlobalBridge;
      bridgeBase.startGlobalBridge = (discordMod as any).startGlobalBridge;
      bridgeBase.stopGlobalBridge = (discordMod as any).stopGlobalBridge;
      bridgeBase.readGlobalDiscordConfig = (discordMod as any).readGlobalDiscordConfig;
      // If a global bridge instance is active, expose it directly for convenience.
      try {
        const gb = typeof (discordMod as any).getGlobalBridge === "function" ? (discordMod as any).getGlobalBridge() : null;
        if (gb) bridgeBase.bridge = gb;
      } catch (_) {}
    } catch (_) {
      // ignore failures to import bridge module — tool will handle missing bridge
    }
  }

  const toolCtx = await createToolContext(node.toolName!, options.agentName, bridgeBase);

  let result: unknown;
  try {
    result = await tool.run({ input, context: toolCtx });
  } catch (err) {
    // Wrap tool errors to expose any structured payloads (similar to LLM
    // provider errors). executeNodeWithPolicy looks for `error.providerOutput`
    // to populate the node output; without this we fall back to `null`.
    const errMsg = (err as Error)?.message ?? String(err);
    let providerOutput: unknown;
    try {
      const jsonMatch = String(errMsg).match(/\{[\s\S]*\}/);
      if (jsonMatch) providerOutput = JSON.parse(jsonMatch[0]);
    } catch {
      // ignore parse failures
    }
    const enhanced = new Error(errMsg);
    (enhanced as any).providerOutput = (err as any)?.providerOutput ?? providerOutput ?? err;
    throw enhanced;
  }
  const elapsed = Date.now() - startTime;

  // Try to parse JSON strings so downstream condition nodes can inspect fields.
  let output: unknown = result;
  if (typeof result === "string") {
    try { output = JSON.parse(result); } catch { /* leave as raw string */ }
  }

  // If the tool returned an object with `ok: false` treat it as an
  // exceptional/tool failure by default so graph `errorPolicy` / `catch`
  // semantics apply. This behaviour can be disabled by passing
  // `options.treatToolOkFalseAsError = false` when running the graph.
  const treatOkFalse = options?.treatToolOkFalseAsError ?? true;
  try {
    if (
      treatOkFalse &&
      output !== null &&
      typeof output === "object" &&
      (output as any).ok === false
    ) {
      const e = new Error(`Tool "${node.toolName}" returned ok=false`);
      (e as any).providerOutput = output;
      throw e;
    }
  } catch (err) {
    // Re-throw so executeNodeWithPolicy can apply retry/fallback/skip.
    throw err;
  }

  log(`    tool result in ${elapsed}ms`);

  return {
    nodeId: node.id,
    nodeName: node.name,
    output,
    metadata: { elapsedMs: elapsed },
    status: "success",
    timestamp: Date.now(),
  };
}

// ── Condition node ─────────────────────────────────────────────────────

function executeConditionNode(
  node: GraphNode,
  context: GraphExecutionContext,
): NodeOutput {
  // Condition nodes are pass-through — their routing logic is handled
  // by propagateReachability after execution.  The "output" records which
  // branch was selected for observability.
  let selectedBranch = "(none)";

  if (node.branches) {
    for (const branch of node.branches) {
      if (evaluateCondition(branch.condition, context)) {
        selectedBranch = branch.label;
        break;
      }
    }
    if (selectedBranch === "(none)" && node.defaultTarget) {
      selectedBranch = "(default)";
    }
  }

  log(`    condition evaluated — selected branch: ${selectedBranch}`);

  return {
    nodeId: node.id,
    nodeName: node.name,
    output: selectedBranch,
    metadata: { elapsedMs: 0 },
    status: "success",
    timestamp: Date.now(),
  };
}

// -- Operation node --

function executeOperationNode(
  node: GraphNode,
  context: GraphExecutionContext,
): NodeOutput {
  const action = node.operationAction;
  if (!action) {
    throw new Error(`Operation node "${node.id}" has no operationAction configured.`);
  }

  const { op, varName, value, fromRef, amount = 1 } = action;
  const current = context.vars[varName];

  // Resolve templated `value` when present so operation nodes can accept
  // mustache templates (e.g. "{{nodeId.output.items.length}}") and preserve
  // native types (numbers/arrays/objects) instead of plain strings.
  let resolvedValue: unknown = value;
  if (value !== undefined) {
    try {
      resolvedValue = interpolateValue(value, context);
    } catch {
      resolvedValue = value;
    }
  }

  switch (op) {
    case "set":
      context.vars[varName] = resolvedValue;
      break;
    case "inc":
      context.vars[varName] = typeof current === "number" ? current + amount : amount;
      break;
    case "dec":
      context.vars[varName] = typeof current === "number" ? current - amount : -amount;
      break;
    case "copy": {
      if (fromRef) {
        // Allow templated fromRef (e.g. "{{some.node.path}}") by attempting
        // to interpolate first; if interpolation yields a non-string value,
        // use it directly, otherwise resolve the resulting path.
        if (typeof fromRef === "string" && fromRef.includes("{{")) {
          const iv = interpolateValue(fromRef, context);
          if (iv !== undefined && typeof iv !== "string") {
            context.vars[varName] = iv;
          } else {
            context.vars[varName] = resolveRef(String(iv ?? fromRef), context);
          }
        } else {
          context.vars[varName] = resolveRef(fromRef, context);
        }
      } else {
        context.vars[varName] = undefined;
      }
      break;
    }
    case "extract": {
      // Extract supports general JSON path extraction.
      // - `fromRef` may be a templated reference or a dot-path to any JSON value.
      // - If `key` is omitted the resolved `fromRef` value is copied verbatim.
      // - If `key` is present and `fromRef` resolves to an array, we map over
      //   each element and extract the `key` path from each item (returns array).
      // - If `key` is present and `fromRef` resolves to an object/value, we
      //   navigate the `key` path inside that value and store the result.
      if (!fromRef) {
        context.vars[varName] = undefined;
        break;
      }

      // Resolve templated fromRef first
      let source: unknown;
      if (typeof fromRef === "string" && fromRef.includes("{{")) {
        const iv = interpolateValue(fromRef, context);
        if (iv !== undefined && typeof iv !== "string") {
          source = iv;
        } else {
          source = resolveRef(String(iv ?? fromRef), context);
        }
      } else {
        source = resolveRef(fromRef, context);
      }

      const rawKey = (action as any).key;
      if (!rawKey) {
        // No key: copy the whole resolved value
        context.vars[varName] = source;
        break;
      }

      // Resolve templated key if present and normalise into parts
      let resolvedKey = rawKey;
      if (typeof rawKey === "string" && rawKey.includes("{{")) {
        try { resolvedKey = String(interpolateValue(rawKey, context)); } catch { resolvedKey = rawKey; }
      }
      const parts = String(resolvedKey).replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '').split('.');

      if (Array.isArray(source)) {
        const out = (source as unknown[]).map((item) => navigatePath(item, parts));
        context.vars[varName] = out;
      } else {
        const v = navigatePath(source, parts);
        context.vars[varName] = v;
      }
      break;
    }
    case "toggle":
      context.vars[varName] = !current;
      break;
    case "append": {
      const arr = Array.isArray(current) ? current : [];
      context.vars[varName] = [...arr, resolvedValue];
      break;
    }
    default:
      throw new Error(`Unknown operation op "${op}" on node "${node.id}".`);
  }

  log(`    operation "${op}" on vars.${varName} => ${JSON.stringify(context.vars[varName])}`);

  return {
    nodeId: node.id,
    nodeName: node.name,
    output: { ...context.vars },
    metadata: { elapsedMs: 0 },
    status: "success",
    timestamp: Date.now(),
  };
}

// ── Catch node ─────────────────────────────────────────────────────────

/**
 * Execute a catch node.
 *
 * The node emits `{ exitReason, vars }` so downstream cleanup nodes can
 * inspect why the loop stopped and what the final variable state was.
 * The exit reason is also available via `_loopExitReason` on the context
 * for any template that reads `{{vars.*}}` — it is intentionally NOT
 * merged into `vars` to avoid polluting the user-visible variable store.
 */
function executeCatchNode(node: GraphNode, context: GraphExecutionContext): NodeOutput {
  const exitReason = context._loopExitReason ?? "unknown";
  const stopKind = (context as any)._stopKind as ("manualStop" | "manualAbort" | undefined);
  log(`    catch node "${node.id}" — exitReason="${exitReason}"${stopKind ? ` stopKind="${stopKind}"` : ""}`);
  const outputVal: any = { exitReason, vars: { ...context.vars } };
  if (stopKind) outputVal.stopKind = stopKind;
  return {
    nodeId: node.id,
    nodeName: node.name,
    output: outputVal,
    metadata: { elapsedMs: 0 },
    status: "success",
    timestamp: Date.now(),
  };
}

// ── Condition evaluator ────────────────────────────────────────────────

function evaluateCondition(
  predicate: ConditionPredicate,
  context: GraphExecutionContext,
): boolean {
  // Resolve the reference value. Support mustache templates in `predicate.ref`:
  // - If `ref` contains `{{...}}`, interpolate it first. If interpolation
  //   yields a string that resolves to a known path, attempt to resolve it.
  // - Otherwise treat `ref` as a dot-path and resolve directly.
  let refValue: unknown;
  if (typeof predicate.ref === "string" && predicate.ref.includes("{{")) {
    const interpolated = interpolateValue(predicate.ref, context);
    if (typeof interpolated === "string") {
      const maybePath = interpolated.trim();
      const resolved = resolveRef(maybePath, context);
      refValue = resolved !== undefined ? resolved : interpolated;
    } else {
      refValue = interpolated;
    }
  } else {
    refValue = resolveRef(String(predicate.ref), context);
  }

  // Interpolate the predicate value (supports templates and deep objects).
  const expected = interpolateValue(predicate.value, context);

  switch (predicate.operator) {
    case "eq":
      return refValue === expected;
    case "neq":
      return refValue !== expected;
    case "gt":
      return typeof refValue === "number" && typeof expected === "number" && (refValue as number) > (expected as number);
    case "lt":
      return typeof refValue === "number" && typeof expected === "number" && (refValue as number) < (expected as number);
    case "gte":
      return typeof refValue === "number" && typeof expected === "number" && (refValue as number) >= (expected as number);
    case "lte":
      return typeof refValue === "number" && typeof expected === "number" && (refValue as number) <= (expected as number);
    case "contains":
      if (typeof refValue === "string" && typeof expected === "string") return (refValue as string).includes(expected as string);
      if (Array.isArray(refValue)) return (refValue as unknown[]).includes(expected);
      return false;
    case "not_contains":
      if (typeof refValue === "string" && typeof expected === "string") return !(refValue as string).includes(expected as string);
      if (Array.isArray(refValue)) return !(refValue as unknown[]).includes(expected);
      return false;
    case "starts_with":
      return typeof refValue === "string" && typeof expected === "string" && (refValue as string).startsWith(expected as string);
    case "ends_with":
      return typeof refValue === "string" && typeof expected === "string" && (refValue as string).endsWith(expected as string);
    case "exists":
      return refValue !== undefined && refValue !== null;
    case "not_exists":
      return refValue === undefined || refValue === null;
    case "matches": {
      if (typeof refValue !== "string" || typeof expected !== "string") return false;
      try {
        return new RegExp(expected as string).test(refValue as string);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

// ── Template interpolation ─────────────────────────────────────────────

/**
 * Resolve `{{ref}}` placeholders in a template string.
 *
 *   {{input.field}}      → graph input variable
 *   {{nodeId.output}}    → node output (string)
 *   {{nodeId.output.x}}  → nested field in JSON output
 */
function interpolateTemplate(
  template: string,
  context: GraphExecutionContext,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, ref: string) => {
    const value = resolveRef(ref.trim(), context);
    if (value === undefined) return `{{${ref.trim()}}}`;
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/**
 * Deep-interpolate a value.
 *
 * If the entire string is a single `{{ref}}`, the raw resolved value is
 * returned (preserving non-string types).  Mixed templates are stringified.
 */
function interpolateValue(
  value: unknown,
  context: GraphExecutionContext,
): unknown {
  if (typeof value === "string") {
    const singleRef = value.match(/^\s*\{\{([^}]+)\}\}\s*$/);
    if (singleRef) {
      return resolveRef(singleRef[1]!.trim(), context) ?? value;
    }

    const templated = interpolateTemplate(value, context);
    // If the interpolated result looks like JSON (object/array/primitive),
    // try parsing so numeric/boolean/object results are preserved instead
    // of remaining as strings when the template produced JSON text.
    const jsonLike = /^\s*(?:\{[\s\S]*\}|\[[\s\S]*\]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\s*$/i;
    if (jsonLike.test(templated)) {
      try { return JSON.parse(templated); } catch { /* not parseable, fallthrough */ }
    }
    return templated;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateValue(v, context));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateValue(v, context);
    }
    return out;
  }
  return value;
}

// ── Reference resolver ─────────────────────────────────────────────────

function resolveRef(ref: string, context: GraphExecutionContext): unknown {
  // Normalize bracket numeric indexes (e.g. messages[0].uid -> messages.0.uid)
  const norm = String(ref).trim().replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
  const parts = norm.split(".");

  // vars.<name>[.path] — mutable variable store written by operation nodes
  if (parts[0] === "vars") {
    return navigatePath(context.vars, parts.slice(1));
  }

  if (parts[0] === "input") {
    return navigatePath(context.input, parts.slice(1));
  }

  // Lookup by outputKey
  const nodeOutput = context.nodeOutputs[parts[0]!];
  if (nodeOutput) {
    if (parts.length === 1) return nodeOutput.output;
    if (parts[1] === "output") return navigatePath(nodeOutput.output, parts.slice(2));
    if (parts[1] === "status") return nodeOutput.status;
    if (parts[1] === "error") return nodeOutput.error;
    // Default: treat remaining path as navigating into .output
    return navigatePath(nodeOutput.output, parts.slice(1));
  }

  return undefined;
}

function navigatePath(root: unknown, path: string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}


// -- SCC-based execution plan --

type NodeGroup =
  | { type: "node"; id: string }
  | { type: "loop"; scc: Set<string>; entryId: string; withinOrder: string[] };

function buildAdjacencyForRunner(graph: GraphDefinition): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  // Catch nodes are excluded from adjacency: they are reactive nodes fired
  // by runtime exit reasons, not by edge traversal.  Excluding them here
  // ensures SCC computation never absorbs them into a loop group.
  const catchIds = new Set(graph.nodes.filter(n => n.type === "catch").map(n => n.id));

  for (const node of graph.nodes) {
    if (!catchIds.has(node.id)) adj.set(node.id, []);
  }

  for (const edge of graph.edges ?? []) {
    if (catchIds.has(edge.target)) continue; // catch nodes receive no SCC edges
    adj.get(edge.source)?.push(edge.target);
  }
  for (const node of graph.nodes) {
    if (node.type === "condition" && node.branches) {
      const targets = adj.get(node.id)!;
      if (!targets) continue;
      for (const branch of node.branches) {
        if (catchIds.has(branch.target)) continue;
        if (!targets.includes(branch.target)) targets.push(branch.target);
      }
      if (node.defaultTarget && !catchIds.has(node.defaultTarget) && !targets.includes(node.defaultTarget)) {
        targets.push(node.defaultTarget);
      }
    }
  }
  return adj;
}

function computeExecutionPlan(graph: GraphDefinition): NodeGroup[] {
  const adj = buildAdjacencyForRunner(graph);
  const sccs = tarjanSCC(adj); // SCCs in reverse topological order — reverse to get topo order
  const groups: NodeGroup[] = [];
  for (const scc of [...sccs].reverse()) {
    if (scc.size === 1) {
      const [id] = [...scc];
      // Self-loop check
      if (adj.get(id!)?.includes(id!)) {
        const entryId = id!;
        groups.push({ type: "loop", scc, entryId, withinOrder: [entryId] });
      } else {
        groups.push({ type: "node", id: id! });
      }
    } else {
      const entryId = findSCCEntry(scc, graph);
      const withinOrder = computeWithinSCCOrder(scc, entryId, adj);
      groups.push({ type: "loop", scc, entryId, withinOrder });
    }
  }
  return groups;
}

function findSCCEntry(scc: Set<string>, graph: GraphDefinition): string {
  const adj = buildAdjacencyForRunner(graph);
  for (const id of scc) {
    for (const [src, targets] of adj) {
      if (!scc.has(src) && targets.includes(id)) return id;
    }
  }
  // Fallback: first node listed in the graph among SCC members
  for (const node of graph.nodes) {
    if (scc.has(node.id)) return node.id;
  }
  return [...scc][0]!;
}

function computeWithinSCCOrder(
  scc: Set<string>,
  entryId: string,
  adj: Map<string, string[]>,
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  const queue = [entryId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    order.push(cur);
    for (const next of adj.get(cur) ?? []) {
      if (scc.has(next) && !visited.has(next)) queue.push(next);
    }
  }
  return order;
}

function computeAllExternalIncomingCounts(
  graph: GraphDefinition,
  plan: NodeGroup[],
): Map<string, number> {
  // Build a mapping from node -> representative (group entry id).
  const nodeToRep = new Map<string, string>();
  for (const group of plan) {
    if (group.type === "node") {
      nodeToRep.set(group.id, group.id);
    } else {
      for (const id of group.scc) nodeToRep.set(id, group.entryId);
    }
  }

  const counts = new Map<string, number>();
  for (const group of plan) {
    const rep = group.type === "node" ? group.id : group.entryId;
    counts.set(rep, 0);
  }

  // Count incoming edges using the full graph so that edges originating
  // from catch nodes (which are intentionally excluded from SCC adjacency)
  // still count as incoming links.  Without this, targets only reachable
  // via catch nodes appear to have zero incoming edges and are seeded
  // as roots, causing them to run at the start of the graph.
  for (const edge of graph.edges ?? []) {
    const srcRep = nodeToRep.get(edge.source); // undefined for catch nodes
    const tgtRep = nodeToRep.get(edge.target);
    if (!tgtRep) continue;
    if (srcRep !== tgtRep) {
      counts.set(tgtRep, (counts.get(tgtRep) ?? 0) + 1);
    }
  }

  // Also account for condition branch targets and defaultTarget which may
  // not be represented in the edges array.
  for (const node of graph.nodes) {
    if (node.type !== "condition") continue;
    const srcRep = nodeToRep.get(node.id);
    for (const branch of node.branches ?? []) {
      const tgtRep = nodeToRep.get(branch.target);
      if (tgtRep && srcRep !== tgtRep) {
        counts.set(tgtRep, (counts.get(tgtRep) ?? 0) + 1);
      }
    }
    if (node.defaultTarget) {
      const tgtRep = nodeToRep.get(node.defaultTarget);
      if (tgtRep && srcRep !== tgtRep) {
        counts.set(tgtRep, (counts.get(tgtRep) ?? 0) + 1);
      }
    }
  }

  return counts;
}

async function runLoopSCC(
  group: { type: "loop"; scc: Set<string>; entryId: string; withinOrder: string[] },
  graph: GraphDefinition,
  context: GraphExecutionContext,
  nodeMap: Map<string, GraphNode>,
  outgoing: Map<string, GraphEdge[]>,
  globalConfig: import("../../types/index.js").NyteShiftConfig,
  options: GraphRunOptions,
  iterOffset = 0,
): Promise<{ results: NodeOutput[]; error?: string; exitTarget?: string; exitReason: LoopExitReason; totalIterations: number }> {
  const unbounded = graph.unbounded === true;
  const maxIter = graph.maxIterations ?? 100;
  const results: NodeOutput[] = [];
  let exitTarget: string | undefined;
  let exitReason: LoopExitReason = "maxIterations";

  if (unbounded) {
    logW(`  unbounded loop SCC — runs until a condition exits, an error occurs, or the run is cancelled.`);
  }

  let iter = iterOffset;
  while (unbounded || iter < maxIter) {
    if (options.signal?.aborted || options._softStop?.requested) {
      exitReason = "abort";
      break;
    }

    let shouldExit = false;
    const iterReachable = new Set<string>([group.entryId]);
    // Track which nodes have already executed in this iteration so that
    // multi-pass re-scans don't duplicate side-effects.
    const iterExecuted = new Set<string>();

    // Multi-pass: when a node late in withinOrder makes an earlier node
    // reachable (e.g. Operation 2 at pos 9 → HasNext at pos 4), a single
    // linear scan would miss the earlier node.  Re-scan until no new
    // nodes are executed.
    let madeProgress = true;
    while (madeProgress && !shouldExit) {
      madeProgress = false;

      for (const nodeId of group.withinOrder) {
        if (options.signal?.aborted || options._softStop?.requested) { shouldExit = true; break; }
        if (!iterReachable.has(nodeId)) continue;
        if (iterExecuted.has(nodeId)) continue;
        iterExecuted.add(nodeId);
        madeProgress = true;

        const node = nodeMap.get(nodeId)!;
        const policy = node.errorPolicy ?? graph.errorPolicy ?? { type: "halt" };
        options.onNodeStart?.(node.id, node.name, node.type);
        const nodeOutput = await executeNodeWithPolicy(node, context, globalConfig, graph, options, policy);
        try { (nodeOutput as any).nodeType = node.type; } catch {}

        if (nodeOutput.metadata) {
          (nodeOutput.metadata as Record<string, unknown>).iteration = iter;
        }

        results.push(nodeOutput);
        context.nodeOutputs[node.outputKey ?? node.id] = nodeOutput;
        options.onNodeComplete?.(nodeOutput);

        if (nodeOutput.status === "error" && policy.type === "halt") {
          return { results, error: nodeOutput.error, exitReason: "error", totalIterations: iter };
        }

        if (
          nodeOutput.status === "success" ||
          (policy.type === "fallback" && nodeOutput.status !== "error")
        ) {
          // Check condition branches for SCC exit
          if (node.type === "condition" && node.branches) {
            for (const branch of node.branches) {
              if (!group.scc.has(branch.target) && evaluateCondition(branch.condition, context)) {
                exitTarget = branch.target;
                exitReason = "condition";
                shouldExit = true;
                break;
              }
            }
            if (!shouldExit && node.defaultTarget && !group.scc.has(node.defaultTarget)) {
              exitTarget = node.defaultTarget;
              exitReason = "condition";
              shouldExit = true;
            }
          }

          // Propagate reachability within SCC (regular edges)
          for (const edge of outgoing.get(nodeId) ?? []) {
            if (group.scc.has(edge.target)) {
              if (!edge.condition || evaluateCondition(edge.condition, context)) {
                iterReachable.add(edge.target);
              }
            }
          }
          // Propagate reachability within SCC (condition branches)
          if (node.type === "condition" && node.branches) {
            for (const branch of node.branches) {
              if (group.scc.has(branch.target) && evaluateCondition(branch.condition, context)) {
                iterReachable.add(branch.target);
              }
            }
            if (node.defaultTarget && group.scc.has(node.defaultTarget)) {
              iterReachable.add(node.defaultTarget);
            }
          }
        }

        if (shouldExit) break;
      }
    }

    if (shouldExit) break;
    if (!unbounded && iter === maxIter - 1) {
      log(`  loop SCC hit maxIterations (${maxIter}) — stopping`);
      // exitReason stays "maxIterations"
    }
    iter++;
  }

  return { results, exitTarget, exitReason, totalIterations: iter };
}

// ── Topological sort ───────────────────────────────────────────────────

function topologicalSort(graph: GraphDefinition): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of graph.edges ?? []) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  for (const node of graph.nodes) {
    if (node.type !== "condition") continue;
    for (const branch of node.branches ?? []) {
      adjacency.get(node.id)?.push(branch.target);
      inDegree.set(branch.target, (inDegree.get(branch.target) ?? 0) + 1);
    }
    if (node.defaultTarget) {
      adjacency.get(node.id)?.push(node.defaultTarget);
      inDegree.set(node.defaultTarget, (inDegree.get(node.defaultTarget) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const target of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(target) ?? 1) - 1;
      inDegree.set(target, newDeg);
      if (newDeg === 0) queue.push(target);
    }
  }

  return sorted;
}

// ── Incoming-edge count (for seeding reachability) ─────────────────────

function computeIncomingCount(graph: GraphDefinition): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of graph.nodes) counts.set(node.id, 0);

  for (const edge of graph.edges ?? []) {
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }

  for (const node of graph.nodes) {
    if (node.type !== "condition") continue;
    for (const branch of node.branches ?? []) {
      counts.set(branch.target, (counts.get(branch.target) ?? 0) + 1);
    }
    if (node.defaultTarget) {
      counts.set(node.defaultTarget, (counts.get(node.defaultTarget) ?? 0) + 1);
    }
  }

  return counts;
}

// ── Trigger node ───────────────────────────────────────────────────────

/**
 * Maximum allowed nesting depth for trigger nodes to prevent accidental
 * infinite recursion (e.g. graph A triggers graph A synchronously).
 * Can be overridden via `graph.maxTriggerDepth` or the run options.
 *
 * Async trigger invocations do NOT consume depth budget because they are
 * fire-and-forget and do not grow the call stack.
 */
const DEFAULT_MAX_TRIGGER_DEPTH = 8;

/**
 * In-process registry of async trigger runs launched by trigger nodes.
 *
 * Key: auto-generated runId  Value: status + optional result/error.
 *
 * The registry lives at module scope so async results are discoverable by
 * the host process (e.g. the UI or CLI) without needing a round-trip to
 * disk.  Entries are kept until the process exits or the map is explicitly
 * cleared.
 */
interface AsyncTriggerEntry {
  runId: string;
  targetType: "graph" | "agent";
  targetId: string;
  startedAt: number;
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export const asyncTriggerRegistry = new Map<string, AsyncTriggerEntry>();

async function executeTriggerNode(
  node: GraphNode,
  context: GraphExecutionContext,
  globalConfig: import("../../types/index.js").NyteShiftConfig,
  graph: GraphDefinition,
  options: GraphRunOptions,
): Promise<NodeOutput> {
  const startTime = Date.now();

  const targetType = node.targetType ?? "agent";
  const targetId   = node.targetId ?? "";
  const awaitResult = node.awaitResult !== false; // default true

  if (!targetId) {
    throw new Error(`Trigger node "${node.id}" has no targetId configured.`);
  }

  // Resolve input for the child run (template interpolation).
  const rawInput = node.triggerInput ?? {};
  const childInput = interpolateValue(rawInput, context) as Record<string, unknown>;

  const provider = options.provider ?? (globalConfig.defaultProvider as string | undefined);
  const model    = options.model    ?? (globalConfig.defaultModel    as string | undefined);

  // ── Fire-and-forget (async) path ──────────────────────────────────────
  if (!awaitResult) {
    const runId = `trigger:${randomUUID()}`;
    const entry: AsyncTriggerEntry = {
      runId,
      targetType,
      targetId,
      startedAt: Date.now(),
      status: "running",
    };
    asyncTriggerRegistry.set(runId, entry);

    const fireAsync = async () => {
      try {
        let result: unknown;
        if (targetType === "graph") {
          const tracked = await runGraphTracked(
            targetId,
            { input: childInput, provider, model, _triggerDepth: 0 },
            { source: "trigger-node", parentGraphId: graph.id },
          );
          result = tracked.result;
          // Keep asyncTriggerRegistry in sync with the resolved runId.
          entry.runId = tracked.runId;
          asyncTriggerRegistry.set(tracked.runId, entry);
          asyncTriggerRegistry.delete(runId);
        } else {
          const runAgent = await getRunAutonomousTask();
          result = await runAgent(targetId, childInput.task as string ?? "", {
            provider,
            model,
            maxSteps: typeof node.maxSteps === "number" ? node.maxSteps : undefined,
          });
        }
        entry.status = "completed";
        entry.result = result;
        log(`    trigger node "${node.id}" async run completed (runId=${runId})`);
      } catch (err) {
        entry.status = "failed";
        entry.error = (err as Error).message ?? String(err);
        logE(`    trigger node "${node.id}" async run failed (runId=${runId}):`, entry.error);
      }
    };

    // Fire without await — intentional
    fireAsync().catch(logE);

    log(`    trigger node "${node.id}" — async ${targetType} "${targetId}" fired (runId=${runId})`);

    return {
      nodeId: node.id,
      nodeName: node.name,
      output: { isAsync: true, runId, targetType, targetId },
      metadata: { elapsedMs: Date.now() - startTime },
      status: "success",
      timestamp: Date.now(),
    };
  }

  // ── Synchronous path ──────────────────────────────────────────────────
  // Depth guard: prevent unbounded recursive graph/agent invocations.
  const currentDepth = context._triggerDepth ?? 0;
  const maxDepth     = (graph as any).maxTriggerDepth ?? DEFAULT_MAX_TRIGGER_DEPTH;

  if (currentDepth >= maxDepth) {
    throw new Error(
      `Trigger node "${node.id}" aborted: maximum sync trigger depth (${maxDepth}) reached. ` +
      `Set awaitResult=false (async) for recursive invocations or add a condition guard.`,
    );
  }

  log(`    trigger node "${node.id}" — sync ${targetType} "${targetId}" (depth=${currentDepth + 1}/${maxDepth})`);

  // Build an AbortSignal that also respects an optional timeout.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let ownController: AbortController | undefined;
  let effectiveSignal = context.signal;

  if (node.timeoutMs && node.timeoutMs > 0) {
    ownController = new AbortController();
    // Chain parent signal so parent abort cascades too.
    if (context.signal) {
      context.signal.addEventListener("abort", () => ownController!.abort(), { once: true });
    }
    timeoutId = setTimeout(() => {
      ownController!.abort();
    }, node.timeoutMs);
    effectiveSignal = ownController.signal;
  }

  try {
    let result: unknown;

    if (targetType === "graph") {
      const { result: graphResult } = await runGraphTracked(
        targetId,
        {
          input: childInput,
          signal: effectiveSignal,
          provider,
          model,
          _triggerDepth: currentDepth + 1,
          onNodeStart:    options.onNodeStart,
          onNodeComplete: options.onNodeComplete,
        },
        { source: "trigger-node", parentGraphId: graph.id },
      );

      const elapsed = Date.now() - startTime;
      log(`    trigger node "${node.id}" — child graph "${targetId}" completed in ${elapsed}ms`);

      return {
        nodeId: node.id,
        nodeName: node.name,
        output: graphResult.finalOutput,
        metadata: {
          elapsedMs: elapsed,
          triggerType: "graph",
          targetId,
          childStatus: graphResult.status,
          childTraceId: graphResult.traceId,
        },
        status: graphResult.status === "failed" ? "error" : "success",
        error: graphResult.status === "failed" ? graphResult.error : undefined,
        timestamp: Date.now(),
      };
    } else {
      // targetType === "agent"
      const runAgent = await getRunAutonomousTask();
      const agentTask: string =
        typeof childInput.task === "string" && childInput.task
          ? childInput.task
          : node.promptTemplate
            ? interpolateTemplate(node.promptTemplate, context)
            : `Run agent ${targetId}`;

      const agentResult = await runAgent(targetId, agentTask, {
        provider,
        model,
        maxSteps: typeof node.maxSteps === "number" ? node.maxSteps : undefined,
        signal: effectiveSignal,
      });

      const elapsed = Date.now() - startTime;
      log(`    trigger node "${node.id}" — agent "${targetId}" completed in ${elapsed}ms`);

      return {
        nodeId: node.id,
        nodeName: node.name,
        output: agentResult.finalOutput,
        metadata: {
          elapsedMs: elapsed,
          triggerType: "agent",
          targetId,
          agentSteps: agentResult.steps.length,
        },
        status: agentResult.aborted ? "error" : "success",
        error: agentResult.aborted ? "Agent run was aborted." : undefined,
        timestamp: Date.now(),
      };
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
  // TypeScript requires an explicit return here even though both if/else
  // branches above always return; suppress with a typed assertion.
  throw new Error(`Trigger node "${node.id}": unexpected execution path.`);
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeSkippedOutput(node: GraphNode): NodeOutput {
  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    output: null,
    metadata: { elapsedMs: 0 },
    status: "skipped",
    timestamp: Date.now(),
  };
}

/**
 * Produce a sentinel placeholder stored for catch nodes at plan-walk time.
 * Stamping `__placeholder: true` on the metadata lets the post-SCC catch-
 * firing logic distinguish "never ran yet" from "already ran for an earlier
 * SCC", preventing the placeholder from silently blocking catch execution.
 */
function makeCatchPlaceholder(node: GraphNode): NodeOutput {
  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    output: null,
    metadata: { elapsedMs: 0, __placeholder: true },
    status: "skipped",
    timestamp: Date.now(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Advanced options ───────────────────────────────────────────────────
//
// Toggle: `GraphRunOptions.treatToolOkFalseAsError` (default: true)
//   When true, any tool node that returns an object with `ok: false`
//   will be treated as a runtime/tool failure and re-thrown (the thrown
//   error carries the original object on `.providerOutput`). This causes
//   the graph runner to apply the node's `errorPolicy` (retry/fallback/skip)
//   and enables `catch` nodes to observe and handle the failure.
//
//   When false, `{ ok: false }` is treated as a normal node output and
//   the graph author must explicitly inspect `node.output.ok` via a
//   `condition` node or other logic.
//
// Use-case: prefer `ok:false` as a model-facing structured failure in the
// ReAct loop (so the model can decide next steps). The graph runner's
// default semantics treat it as an actual failure so graph-level retry
// and catch semantics work without additional wiring. Set this flag to
// `false` to preserve legacy behaviour where `ok:false` is a normal output.
