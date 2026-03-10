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

// ── Public entry point ─────────────────────────────────────────────────

/**
 * Execute an agent graph.
 *
 * @param graphOrId  A full {@link GraphDefinition} object or the graph ID
 *                   (loads from `~/.solix/graphs/<id>.json`).
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

      if (!reachable.has(nodeId)) {
        const skipOut = makeSkippedOutput(node);
        nodeResults.push(skipOut);
        context.nodeOutputs[node.outputKey ?? node.id] = skipOut;
        options.onNodeComplete?.(skipOut);
        continue;
      }

      const policy = node.errorPolicy ?? graph.errorPolicy ?? { type: "halt" };
      options.onNodeStart?.(node.id, node.name);
      const nodeOutput = await executeNodeWithPolicy(node, context, globalConfig, graph, options, policy);
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
  globalConfig: import("../../types/index.js").SolixConfig,
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
  globalConfig: import("../../types/index.js").SolixConfig,
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
  globalConfig: import("../../types/index.js").SolixConfig,
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
  globalConfig: import("../../types/index.js").SolixConfig,
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

// ── Condition evaluator ────────────────────────────────────────────────

function evaluateCondition(
  predicate: ConditionPredicate,
  context: GraphExecutionContext,
): boolean {
  const refValue = resolveRef(predicate.ref, context);

  switch (predicate.operator) {
    case "eq":
      return refValue === predicate.value;
    case "neq":
      return refValue !== predicate.value;
    case "gt":
      return typeof refValue === "number" && typeof predicate.value === "number" && refValue > predicate.value;
    case "lt":
      return typeof refValue === "number" && typeof predicate.value === "number" && refValue < predicate.value;
    case "gte":
      return typeof refValue === "number" && typeof predicate.value === "number" && refValue >= predicate.value;
    case "lte":
      return typeof refValue === "number" && typeof predicate.value === "number" && refValue <= predicate.value;
    case "contains":
      return typeof refValue === "string" && typeof predicate.value === "string" && refValue.includes(predicate.value);
    case "not_contains":
      return typeof refValue === "string" && typeof predicate.value === "string" && !refValue.includes(predicate.value);
    case "starts_with":
      return typeof refValue === "string" && typeof predicate.value === "string" && refValue.startsWith(predicate.value);
    case "ends_with":
      return typeof refValue === "string" && typeof predicate.value === "string" && refValue.endsWith(predicate.value);
    case "exists":
      return refValue !== undefined && refValue !== null;
    case "not_exists":
      return refValue === undefined || refValue === null;
    case "matches": {
      if (typeof refValue !== "string" || typeof predicate.value !== "string") return false;
      try {
        return new RegExp(predicate.value).test(refValue);
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
  for (const node of graph.nodes) adj.set(node.id, []);

  for (const edge of graph.edges ?? []) {
    adj.get(edge.source)?.push(edge.target);
  }
  for (const node of graph.nodes) {
    if (node.type === "condition" && node.branches) {
      const targets = adj.get(node.id)!;
      for (const branch of node.branches) {
        if (!targets.includes(branch.target)) targets.push(branch.target);
      }
      if (node.defaultTarget && !targets.includes(node.defaultTarget)) {
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
  globalConfig: import("../../types/index.js").SolixConfig,
  options: GraphRunOptions,
): Promise<{ results: NodeOutput[]; error?: string; exitTarget?: string }> {
  const maxIter = graph.maxIterations ?? 100;
  const results: NodeOutput[] = [];
  let exitTarget: string | undefined;

  for (let iter = 0; iter < maxIter; iter++) {
    if (options.signal?.aborted) break;

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
        options.onNodeStart?.(node.id, node.name);
        const nodeOutput = await executeNodeWithPolicy(node, context, globalConfig, graph, options, policy);

        if (nodeOutput.metadata) {
          (nodeOutput.metadata as Record<string, unknown>).iteration = iter;
        }

        results.push(nodeOutput);
        context.nodeOutputs[node.outputKey ?? node.id] = nodeOutput;
        options.onNodeComplete?.(nodeOutput);

        if (nodeOutput.status === "error" && policy.type === "halt") {
          return { results, error: nodeOutput.error };
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
                shouldExit = true;
                break;
              }
            }
            if (!shouldExit && node.defaultTarget && !group.scc.has(node.defaultTarget)) {
              exitTarget = node.defaultTarget;
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
    }
  }

  return { results, exitTarget };
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

// ── Helpers ────────────────────────────────────────────────────────────

function makeSkippedOutput(node: GraphNode): NodeOutput {
  return {
    nodeId: node.id,
    nodeName: node.name,
    output: null,
    metadata: { elapsedMs: 0 },
    status: "skipped",
    timestamp: Date.now(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
