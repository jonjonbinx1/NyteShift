// ── Agent Graph Type Definitions ────────────────────────────────────────
//
// Defines the serialisable graph blueprint, execution context and result
// types.  These live alongside (not replace) the existing agent / trigger
// pipeline — a graph is an independent execution primitive.

// ── Condition Predicate ────────────────────────────────────────────────

/**
 * Structured, safe condition predicate for edge / branch evaluation.
 *
 * Uses explicit operators instead of arbitrary expressions, preventing
 * injection attacks while remaining expressive enough for routing logic.
 */
export interface ConditionPredicate {
  /**
   * Dot-path reference resolved against execution context.
   *
   * Examples:
   *   "input.query"           — graph input variable
   *   "summarizer.output"     — output of node with outputKey "summarizer"
   *   "analyzer.output.score" — nested field in a JSON output
   */
  ref: string;
  /** Comparison operator. */
  operator:
    | "eq"
    | "neq"
    | "gt"
    | "lt"
    | "gte"
    | "lte"
    | "contains"
    | "not_contains"
    | "starts_with"
    | "ends_with"
    | "exists"
    | "not_exists"
    | "matches";
  /** Value to compare against (unused for exists / not_exists). */
  value?: unknown;
}

// ── Error Policy ───────────────────────────────────────────────────────

/**
 * Per-node or graph-level error handling policy.
 */
export interface ErrorPolicy {
  /** Behaviour on error. */
  type: "halt" | "retry" | "skip" | "fallback";
  /** Maximum retry attempts (retry only). Default: 3. */
  maxRetries?: number;
  /** Initial delay between retries in ms. Default: 1000. */
  retryDelayMs?: number;
  /** Multiplier applied to delay after each retry. Default: 2. */
  retryBackoffMultiplier?: number;
  /** Value to use as output when type is "skip" or "fallback". */
  fallbackValue?: unknown;
}

// ── Graph Node ─────────────────────────────────────────────────────────

// ── Operation Action ──────────────────────────────────────────────────

// ── Catch Node ───────────────────────────────────────────────────────

/**
 * Conditions that can trigger a `catch` node to fire after a loop exits.
 *
 * - maxIterations — the loop hit `graph.maxIterations` without a condition exit
 * - error         — a node inside the loop halted with an unhandled error
 * - abort         — the run was cancelled via an AbortSignal
 */
export type CatchTrigger = "maxIterations" | "error" | "abort";

/**
 * Controls whether the runner resumes plan execution after a catch node fires.
 *
 * - "never"     — (default) the graph stops after the catch; downstream nodes do not run.
 * - "ifHandled" — resume only when the catch's `handledWhen` predicate or
 *                 `handledOutputPath` value evaluates to truthy.
 * - "always"    — always resume; downstream nodes run regardless of outcome.
 */
export type CatchResumePolicy = "never" | "ifHandled" | "always";

/**
 * When multiple `catch` nodes match the same loop exit reason, controls how
 * "handled" is evaluated across all of them.
 *
 * - "any" — (default) at least one catch must indicate handled.
 * - "all" — every matching catch must indicate handled.
 */
export type CatchResumeMode = "any" | "all";

/**
 * Strategy for how a catch node's `resumeTarget` is applied.
 *
 * - "resumeFrom" — (default) jump to the target node and continue the graph
 *                  from there, regardless of whether it has already run.
 *                  The execution plan restarts from the group containing the
 *                  target so nodes before it are NOT re-run.
 * - "rewindTo"   — similar to resumeFrom, but the target node must have
 *                  already executed in this run.  If it hasn't, this catch
 *                  is NOT considered handled and the next catch candidate
 *                  (by catchOrder) is tried instead.
 */
export type CatchResumeStrategy = "resumeFrom" | "rewindTo";

/**
 * A single mutation performed by an `operation` node against the
 * mutable `vars` store in the execution context.
 */
export interface OperationAction {
  /**
   * set    — vars[varName] = value (supports {{ref}} interpolation)
   * inc    — vars[varName] += amount (default 1)
   * dec    — vars[varName] -= amount (default 1)
   * copy   — vars[varName] = resolveRef(fromRef)
   * toggle — vars[varName] = !vars[varName]
   * append — vars[varName].push(value)
   */
  op: "set" | "inc" | "dec" | "copy" | "toggle" | "append" | "extract";
  /** Name of the variable to mutate (written as `vars.<varName>` in templates). */
  varName: string;
  /** Static value for `set` and `append` (supports {{ref}} strings). */
  value?: unknown;
  /** Dot-path reference for `copy` (e.g. "fetchTool.output.hasNext"). */
  fromRef?: string;
  /** When op="extract", the key to pluck from each array element (dot-path). */
  key?: string;
  /** Numeric increment/decrement amount (default 1). */
  amount?: number;
}

/**
 * A single node in an agent graph.
 *
 * Node types:
 *   input     — entry point, emits graph input variables
 *   output    — exit point, collects final result
 *   llm       — single LLM call (prompt → response, no tool access)
 *   agent     — full ReAct autonomous run via runAutonomousTask
 *   tool      — direct tool invocation
 *   condition — routing node (exclusive branch selection)
 *   operation — mutates a mutable variable in `vars` (enables loop feedback)
 *   trigger   — invoke another graph or agent, sync or async
 */
export interface GraphNode {
  /** Unique identifier within the graph. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Determines execution behaviour. */
  type: "input" | "output" | "llm" | "agent" | "tool" | "skill" | "condition" | "operation" | "catch" | "trigger";

  // ── LLM node ─────────────────────────────────────────────────────────
  /** Provider ID override (e.g. "openai", "anthropic"). */
  provider?: string;
  /** Model ID override. */
  model?: string;
  /** Sampling temperature. */
  temperature?: number;
  /** Maximum output tokens. */
  maxTokens?: number;
  /** System prompt for LLM / agent nodes. */
  systemPrompt?: string;
  /**
   * User-prompt template.  Supports `{{ref}}` interpolation:
   *   {{input.field}}     — graph input variable
   *   {{nodeId.output}}   — previous node output
   */
  promptTemplate?: string;

  // ── Agent node ───────────────────────────────────────────────────────
  /** Existing agent name to delegate to (uses its soul / skills / tools). */
  agentName?: string;
  /** Maximum ReAct steps. */
  maxSteps?: number;
  /** Skills whitelist (agent nodes). */
  skills?: string[];
  /** Tools whitelist (agent nodes). */
  tools?: string[];

  // ── Tool node ────────────────────────────────────────────────────────
  /** Qualified tool name (e.g. "contrib/tool-name"). */
  toolName?: string;
  /**
   * Tool input — values may contain `{{ref}}` template strings.
   * If a value is exactly `{{ref}}`, the raw resolved value is passed
   * (preserving non-string types).
   */
  toolInput?: Record<string, unknown>;

  // ── Condition node ───────────────────────────────────────────────────
  /**
   * Ordered list of branches.  First match wins (exclusive routing).
   */
  branches?: Array<{
    /** Human-readable branch label. */
    label: string;
    /** Predicate evaluated against execution context. */
    condition: ConditionPredicate;
    /** Target node ID if this branch is selected. */
    target: string;
  }>;
  /** Fallback target when no branch matches. */
  defaultTarget?: string;

  // ── Operation node ───────────────────────────────────────────────────
  /**
   * Describes the mutation to perform against `context.vars`.
   * Required when `type` is "operation".
   *
   * Accessed downstream as `{{vars.<varName>}}` in templates / conditions.
   */
  operationAction?: OperationAction;

  // ── Catch node ───────────────────────────────────────────────────────
  /**
   * One or more loop-exit conditions that cause this node to fire.
   * Required when `type` is "catch".
   *
   * The node fires inline after any loop SCC exits for a matching reason.
   * Its output is `{ exitReason: string, vars: Record<string,unknown> }`
   * so downstream nodes can inspect why the loop stopped.
   *
   * Outgoing edges from a catch node propagate normally, allowing
   * users to wire cleanup / notification subgraphs.
   */
  catchTriggers?: CatchTrigger[];

  /**
   * Determines the order in which this catch node is tried relative to other
   * catch nodes that match the same exit reason.  Lower numbers run first.
   *
   * If two catch nodes share the same `catchOrder`, the execution order is
   * non-deterministic between runs and should be avoided.
   *
   * Undefined (unset) nodes are treated as lowest priority (tried last).
   */
  catchOrder?: number;

  /**
   * Maximum number of times this catch node may fire within a single graph run.
   *
   * - `undefined` / `1` — fires at most once per run (default).
   * - `0`               — unlimited; fires every time its triggers match.
   * - `N > 1`           — fires at most N times, then is excluded from
   *                       subsequent catch evaluation for the same run.
   */
  catchMaxFires?: number;

  /**
   * Controls whether the runner resumes plan execution after this catch fires.
   *
   * - "never"     — (default) stop the graph after the catch runs.
   * - "ifHandled" — resume when `handledWhen` predicate or `handledOutputPath`
   *                 value evaluates to truthy.
   * - "always"    — resume unconditionally after the catch succeeds.
   *
   * Only applies when `type` is "catch".
   */
  resumePolicy?: CatchResumePolicy;

  /**
   * Predicate evaluated against the execution context after the catch runs.
   * When it passes, this catch is considered to have "handled" the error.
   * Used when `resumePolicy` is "ifHandled".
   *
   * Example — resume only when the exit was due to max iterations:
   *   { ref: "myCatch.output.exitReason", operator: "eq", value: "maxIterations" }
   *
   * Example — resume when a custom var signals recovery:
   *   { ref: "vars.isRecovered", operator: "eq", value: true }
   */
  handledWhen?: ConditionPredicate;

  /**
   * Dot-path into the catch node's output (e.g. `"output.handled"`).  When
   * the value at this path is truthy, the catch is considered to have handled
   * the error.  Used when `resumePolicy` is "ifHandled".
   *
   * Example: `"output.handled"` — your catch node's tool/LLM returns
   * `{ handled: true }` when it successfully dealt with the failure.
   */
  handledOutputPath?: string;

  /**
   * When multiple catch nodes match the same exit reason, controls how
   * "handled" is evaluated across all of them.
   *
   * - "any" — (default) at least one catch must indicate handled.
   * - "all" — every matching catch must indicate handled.
   *
   * Only the first catch node's `resumeMode` is consulted.
   */
  resumeMode?: CatchResumeMode;

  /**
   * Optional node ID to jump to when this catch handles the error.
   *
   * The runner restarts the execution plan from the group containing
   * this node, so it works for targets both before AND after the current
   * position in the plan.
   */
  resumeTarget?: string;

  /**
   * How the `resumeTarget` is applied.
   *
   * - "resumeFrom" — (default) always jump to the target and continue.
   * - "rewindTo"   — only jump if the target already ran in this run.
   *                   If it hasn't, this catch is skipped and the next
   *                   catch candidate is tried.
   *
   * Only meaningful when `resumeTarget` is set.
   */
  resumeStrategy?: CatchResumeStrategy;

  /**
   * When `true` (and `resumePolicy` is "ifHandled" or "always"), the runner
   * pauses instead of automatically resuming after the catch handles the error.
   *
   * The complete execution context (vars + node outputs) is persisted to disk
   * so the user can click "Resume" from the Run History view at any time —
   * even after an application restart.
   *
   * Requires a `resumeTarget` to specify the node to continue from.
   */
  manualResume?: boolean;

  // ── Trigger node ─────────────────────────────────────────────────────
  /**
   * Whether this trigger node targets another graph or an agent.
   * Required when `type` is "trigger".
   */
  targetType?: "graph" | "agent";
  /**
   * Graph ID (when targetType is "graph") or agent name
   * (when targetType is "agent") to invoke.
   * Required when `type` is "trigger".
   */
  targetId?: string;
  /**
   * When true (default) the graph runner awaits the child run to finish
   * before continuing.  When false the child is fired in background and
   * this node resolves immediately with `{ isAsync: true, runId }`.
   *
   * Using async=false is STRONGLY recommended for recursive invocations
   * to avoid unbounded stack growth.  The validator will warn when a
   * trigger node targets the parent graph without either async=true or
   * a condition guard.
   */
  awaitResult?: boolean;
  /**
   * Input variables forwarded to the child run.
   * Values may contain `{{ref}}` template strings resolved against the
   * current execution context before the child is invoked.
   */
  triggerInput?: Record<string, unknown>;
  /**
   * Milliseconds to wait before treating a sync trigger run as timed out
   * and throwing an error (subject to the node errorPolicy).
   * Unlimited by default.
   */
  timeoutMs?: number;

  // ── Common ───────────────────────────────────────────────────────────
  /**
   * Key used to store this node's output in the execution context.
   * Defaults to the node ID.  Downstream nodes reference this key in
   * templates and condition predicates.
   */
  outputKey?: string;
  /** Per-node error policy (overrides graph default). */
  errorPolicy?: ErrorPolicy;
  /** XY position for UI visual builder. */
  position?: { x: number; y: number };

  // ── Skill node ────────────────────────────────────────────────────────
  /** Qualified skill reference (e.g. "nyteshift/git"). */
  skillRef?: string;
  /** Input params supplied to the skill (templated/interpolated). */
  params?: Record<string, unknown>;
  /** Optional caching flag — when true, runtime may cache skill output per-run. */
  cache?: boolean;
}

// ── Graph Edge ─────────────────────────────────────────────────────────

/**
 * Directed edge connecting two nodes.
 *
 * Edges without a condition are always taken when the source completes.
 * Edges with a condition are only taken when the predicate passes.
 */
export interface GraphEdge {
  /** Unique edge identifier. */
  id: string;
  /** Source node ID. */
  source: string;
  /** Target node ID. */
  target: string;
  /** Optional condition — edge activates only when predicate passes. */
  condition?: ConditionPredicate;
  /** Human-readable label for UI display. */
  label?: string;
}

// ── Graph Definition ───────────────────────────────────────────────────

/**
 * Complete, serialisable graph blueprint.
 *
 * Stored as JSON in ~/.nyteshift/graphs/<id>.json.
 */
export interface GraphDefinition {
  /** Unique graph identifier (kebab-case). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Semantic version string. */
  version: string;
  /** Declared input variables for this graph (UI metadata). */
  inputs?: Array<{
    /** Input key used at runtime (e.g. "query"). */
    key: string;
    /** Friendly label for the UI. */
    label?: string;
    /** Human-friendly description shown in editors. */
    description?: string;
    /** Input type controlling editor widget. */
    type?: "string" | "number" | "boolean" | "json";
    /** Default value for the input. */
    default?: unknown;
    /** Whether the input is required at run time. */
    required?: boolean;
  }>;
  /** Ordered list of graph nodes. */
  nodes: GraphNode[];
  /** Directed edges between nodes. */
  edges: GraphEdge[];
  /** Default provider for all LLM / agent nodes (node-level overrides). */
  defaultProvider?: string;
  /** Default model for all LLM / agent nodes (node-level overrides). */
  defaultModel?: string;
  /** Graph-level default error policy. */
  errorPolicy?: ErrorPolicy;
  /**
   * Initial values for the mutable `vars` store.
   * Merged with `options.input` at the start of every execution:
   *   context.vars = { ...initVars, ...options.input }
   * Operation nodes can then mutate these values to feed data back
   * into earlier nodes on subsequent loop iterations.
   *
   * Example: `{ "page": 1, "hasNext": true }`
   */
  initVars?: Record<string, unknown>;
  /**
   * Maximum number of iterations any loop SCC is allowed to run.
   * Defaults to 100.  Set lower for safety or higher for deep pagination.
   * Ignored when `unbounded` is true.
   */
  maxIterations?: number;
  /**
   * When true, loop SCCs run indefinitely — there is no iteration ceiling.
   * The loop will only exit when:
   *   - a condition node branches outside the SCC  ("condition" exit)
   *   - a node errors with a halt policy            ("error" exit)
   *   - the run is cancelled via AbortSignal        ("abort" exit)
   *
   * `maxIterations` is ignored when this is true.
   * Catch nodes using the `"maxIterations"` trigger will never fire.
   *
   * ⚠ Use only when the graph has a reliable condition-based exit.
   * Without one, the loop will run until the process is killed.
   */
  unbounded?: boolean;
  /** Creation timestamp (ms). */
  createdAt: number;
  /** Last-modified timestamp (ms). */
  updatedAt: number;
}

// ── Execution Types ────────────────────────────────────────────────────

/**
 * Output produced by a single node execution.
 *
 * Captures provenance, timing and token usage following industry
 * best-practices for reproducibility and observability.
 */
export interface NodeOutput {
  nodeId: string;
  nodeName: string;
  /** Optional node type (llm, agent, tool, condition, etc.) — added for UI iconization */
  nodeType?: GraphNode["type"];
  /** Processed output value (string for LLM, any for tools). */
  output: unknown;
  /** Raw LLM text before JSON parsing (LLM / agent nodes). */
  rawOutput?: string;
  /** Execution metadata. */
  metadata: {
    provider?: string;
    model?: string;
    tokens?: { prompt: number; completion: number };
    elapsedMs: number;
    /** Tool calls made during an agent-node ReAct loop. */
    toolCalls?: Array<{ name: string; input: unknown; output: unknown }>;
    /** ReAct step count (agent nodes). */
    agentSteps?: number;
    /** Loop iteration index (1-based) — only set for nodes inside a loop SCC. */
    iteration?: number;
    /** Trigger node: "graph" or "agent" (trigger nodes only). */
    triggerType?: "graph" | "agent";
    /** Trigger node: the graph ID or agent name that was invoked. */
    targetId?: string;
    /** Trigger node: final status of the child graph run. */
    childStatus?: string;
    /** Trigger node: traceId of the child graph run. */
    childTraceId?: string;
    /**
     * Internal sentinel: `true` only on outputs pre-populated by the runner
     * for catch nodes that have not actually executed yet.  Allows post-SCC
     * catch-firing logic to overwrite the placeholder instead of skipping the
     * catch entirely when a loop exits due to an error.
     */
    __placeholder?: boolean;
  };
  status: "success" | "error" | "skipped";
  error?: string;
  timestamp: number;
}

/**
 * Mutable runtime context threaded through graph execution.
 */
export interface GraphExecutionContext {
  /** Input variables provided at invocation. */
  input: Record<string, unknown>;
  /**
   * Mutable variable store for loop feedback.
   *
   * Seeded from `graph.initVars` merged with `options.input` at the
   * start of execution.  Only `operation` nodes may write to this store.
   * Templates and condition predicates reference values as `vars.<name>`.
   */
  vars: Record<string, unknown>;
  /** Accumulated node outputs, keyed by outputKey (defaults to node ID). */
  nodeOutputs: Record<string, NodeOutput>;
  /** Unique trace identifier for this execution. */
  traceId: string;
  /** Wall-clock start time. */
  startedAt: number;
  /** Cooperative cancellation signal. */
  signal?: AbortSignal;
  /**
   * @internal
   * Current trigger-invocation nesting depth (propagated from GraphRunOptions).
   */
  _triggerDepth?: number;
  /**
   * @internal
   * Set by the runner immediately before executing catch nodes so they can
   * surface the exit reason in their output.  Not referenced by user templates.
   */
  _loopExitReason?: string;
}

/**
 * Options for {@link runGraph}.
 */
export interface GraphRunOptions {
  /** Input variables to seed the graph execution. */
  input?: Record<string, unknown>;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
  /** Callback fired before a node begins executing (for live progress tracking). */
  onNodeStart?: (nodeId: string, nodeName: string, nodeType?: GraphNode["type"]) => void;
  /** Callback fired after each node completes (for progress tracking). */
  onNodeComplete?: (output: NodeOutput) => void;
  /**
   * Name of the agent that owns this graph run.
   * When provided, tool nodes receive agent-scoped secrets and config overrides
   * in addition to global settings via {@link createToolContext}.  This enables
   * per-agent Gmail (or any configured tool) credentials to flow through
   * graph-run tool nodes identically to how they flow through the autonomous
   * and triggered pipeline paths.
   */
  agentName?: string;
  /** Override default provider for all nodes. */
  provider?: string;
  /** Override default model for all nodes. */
  model?: string;
  /**
   * Advanced: When true (default), treat tool node outputs of the shape
   * `{ ok: false, ... }` as runtime/tool failures that should be handled by
   * the graph `errorPolicy` (retry/fallback/skip) and `catch` nodes. When
   * set to `false`, `{ ok: false }` is treated as a normal successful node
   * output and the graph must explicitly branch on `output.ok`.
   */
  treatToolOkFalseAsError?: boolean;
  /**
   * @internal
   * Current trigger-invocation nesting depth.  Incremented each time a
   * trigger node spawns a child run so the depth-guard can reject
   * unintended infinite recursion.
   *
   * Depth 0 = top-level run.  Default max is 8.
   */
  _triggerDepth?: number;
  /**
   * @internal
   * When resuming a paused run, start execution from this specific node
   * rather than from the graph entry point.  The `initialContext` option
   * should accompany this to restore previously computed node outputs.
   */
  startFromNodeId?: string;
  /**
   * @internal
   * Pre-populated execution context from a previous (paused) run.
   * `vars` overrides `graph.initVars`, and `nodeOutputs` pre-seeds the
   * node-output map so template references to earlier nodes still resolve.
   */
  initialContext?: {
    vars: Record<string, unknown>;
    nodeOutputs: Record<string, unknown>;
  };
  /**
   * @internal
   * Mutable flag set by `graphRunRegistry.requestStop()` to request a
   * graceful stop.  Unlike hard-aborting the signal, this causes the
   * runner to exit the current loop with exitReason "abort" so catch
   * nodes can still fire before the graph finishes.
   */
  _softStop?: { requested: boolean; kind?: "manualStop" };
  /**
   * @internal Run identifier injected by `runGraphTracked` so the runner
   * can correlate AbortSignals with registry-originated hard aborts.
   */
  _runId?: string;
}

/**
 * Complete result of a graph execution run.
 */
export interface GraphExecutionResult {
  graphId: string;
  graphName: string;
  /** Unique trace identifier for observability. */
  traceId: string;
  /** Per-node execution results in execution order. */
  nodeResults: NodeOutput[];
  /** Output from the output node (or last completed node). */
  finalOutput: unknown;
  status: "completed" | "failed" | "aborted" | "paused";
  error?: string;
  elapsedMs: number;
  startedAt: number;
  completedAt: number;
  /** Present when `status === "paused"` — captured context for manual resume. */
  pausedContext?: { vars: Record<string, unknown>; nodeOutputs: Record<string, unknown> };
  /** Present when `status === "paused"` — the node ID to resume from. */
  pausedResumeFrom?: string;
}
