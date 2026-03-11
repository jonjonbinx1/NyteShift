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
import { callProvider } from "../providers/providerRouter.js";
import { getTool } from "../tools/toolLoader.js";

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
    vars: { ...(graph.initVars ?? {}), ...(options.input ?? {}) },
    nodeOutputs: {},
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
  let graphStatus: "completed" | "failed" | "aborted" = "completed";

  for (const group of executionPlan) {
    if (options.signal?.aborted) {
      graphStatus = "aborted";
      log(`  AbortSignal fired — stopping graph execution`);
      break;
    }

    if (group.type === "node") {
      const nodeId = group.id;
      const node = nodeMap.get(nodeId)!;

      // Catch nodes fire via post-SCC logic; skip here to prevent double-execution
      // or spurious skipped-output entries if the catch node never triggered.
      if (node.type === "catch") {
        if (!context.nodeOutputs[node.outputKey ?? node.id]) {
          const skipOut = makeSkippedOutput(node);
          nodeResults.push(skipOut);
          context.nodeOutputs[node.outputKey ?? node.id] = skipOut;
          options.onNodeComplete?.(skipOut);
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
        graphError = nodeOutput.error;
        graphStatus = "failed";
        break;
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

      const loopResult = await runLoopSCC(group, graph, context, nodeMap, outgoing, globalConfig, options);
      nodeResults.push(...loopResult.results);
      // onNodeComplete is already called inside runLoopSCC — do not duplicate.

      // ── Fire catch nodes ────────────────────────────────────────────────
      // Execute matching catch nodes immediately so their outputs are
      // available to downstream nodes in the remainder of the plan.
      // This runs before the error-halt check so catch nodes with
      // trigger="error" fire even when the loop halted on an error.
      context._loopExitReason = loopResult.exitReason;
      let catchHalt = false;
      for (const catchNode of graph.nodes) {
        if (catchNode.type !== "catch") continue;
        if (!(catchNode.catchTriggers ?? []).some(t => t === loopResult.exitReason)) continue;
        // Guard: don't re-fire if a previous SCC in this run already triggered it.
        if (context.nodeOutputs[catchNode.outputKey ?? catchNode.id]) continue;
        log(`  catch node "${catchNode.id}" triggered (reason="${loopResult.exitReason}")`);
        options.onNodeStart?.(catchNode.id, catchNode.name, catchNode.type);
        const catchPolicy = catchNode.errorPolicy ?? graph.errorPolicy ?? { type: "halt" };
        const catchOut = await executeNodeWithPolicy(catchNode, context, globalConfig, graph, options, catchPolicy);
        try { (catchOut as any).nodeType = catchNode.type; } catch {}
        nodeResults.push(catchOut);
        context.nodeOutputs[catchNode.outputKey ?? catchNode.id] = catchOut;
        options.onNodeComplete?.(catchOut);
        if (catchOut.status === "error" && catchPolicy.type === "halt") {
          graphError = catchOut.error;
          graphStatus = "failed";
          catchHalt = true;
          break;
        }
        if (catchOut.status === "success" || (catchPolicy.type === "fallback" && catchOut.status !== "error")) {
          propagateReachability(catchNode, outgoing.get(catchNode.id) ?? [], context, reachable);
        }
      }
      if (catchHalt) break;

      if (loopResult.error) {
        graphError = loopResult.error;
        graphStatus = "failed";
        break;
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
      if (evaluateCondition(edge.condition, context)) {
        reachable.add(edge.target);
      }
    } else {
      reachable.add(edge.target);
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
    output: null,
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
    case "agent":
      return executeAgentNode(node, context, globalConfig, graph, options);
    case "tool":
      return executeToolNode(node, context);
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

  const systemPrompt = node.systemPrompt ?? "You are a helpful AI assistant.";
  const userPrompt = interpolateTemplate(node.promptTemplate ?? "", context);

  log(`    llm call — provider="${provider}" model="${model}"`);

  const result = await callProvider(provider, {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    maxTokens,
  });

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
    maxSteps: node.maxSteps ?? 10,
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

  const toolCtx: Record<string, unknown> = {};
  if (needsBridge) {
    try {
      const discordMod = await import("../discord/discordBridge.js");
      toolCtx.getGlobalBridge = (discordMod as any).getGlobalBridge;
      toolCtx.startGlobalBridge = (discordMod as any).startGlobalBridge;
      toolCtx.stopGlobalBridge = (discordMod as any).stopGlobalBridge;
      toolCtx.readGlobalDiscordConfig = (discordMod as any).readGlobalDiscordConfig;
      // If a global bridge instance is active, expose it directly for convenience.
      try {
        const gb = typeof (discordMod as any).getGlobalBridge === "function" ? (discordMod as any).getGlobalBridge() : null;
        if (gb) (toolCtx as any).bridge = gb;
      } catch (_) {}
    } catch (_) {
      // ignore failures to import bridge module — tool will handle missing bridge
    }
  }

  const result = await tool.run({ input, context: toolCtx });
  const elapsed = Date.now() - startTime;

  // Try to parse JSON strings so downstream condition nodes can inspect fields.
  let output: unknown = result;
  if (typeof result === "string") {
    try { output = JSON.parse(result); } catch { /* leave as raw string */ }
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

  switch (op) {
    case "set":
      context.vars[varName] = value;
      break;
    case "inc":
      context.vars[varName] = typeof current === "number" ? current + amount : amount;
      break;
    case "dec":
      context.vars[varName] = typeof current === "number" ? current - amount : -amount;
      break;
    case "copy":
      context.vars[varName] = fromRef ? resolveRef(fromRef, context) : undefined;
      break;
    case "toggle":
      context.vars[varName] = !current;
      break;
    case "append": {
      const arr = Array.isArray(current) ? current : [];
      context.vars[varName] = [...arr, value];
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
  log(`    catch node "${node.id}" — exitReason="${exitReason}"`);
  return {
    nodeId: node.id,
    nodeName: node.name,
    output: {
      exitReason,
      vars: { ...context.vars },
    },
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
  const adj = buildAdjacencyForRunner(graph);
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

  for (const [src, targets] of adj) {
    const srcRep = nodeToRep.get(src);
    for (const tgt of targets) {
      const tgtRep = nodeToRep.get(tgt);
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
): Promise<{ results: NodeOutput[]; error?: string; exitTarget?: string; exitReason: LoopExitReason }> {
  const maxIter = graph.maxIterations ?? 100;
  const results: NodeOutput[] = [];
  let exitTarget: string | undefined;
  let exitReason: LoopExitReason = "maxIterations";

  for (let iter = 0; iter < maxIter; iter++) {
    if (options.signal?.aborted) {
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
        if (options.signal?.aborted) { shouldExit = true; break; }
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
          return { results, error: nodeOutput.error, exitReason: "error" };
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
    if (iter === maxIter - 1) {
      log(`  loop SCC hit maxIterations (${maxIter}) — stopping`);
      // exitReason stays "maxIterations"
    }
  }

  return { results, exitTarget, exitReason };
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
            maxSteps: typeof node.maxSteps === "number" ? node.maxSteps : 10,
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
        maxSteps: typeof node.maxSteps === "number" ? node.maxSteps : 10,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
