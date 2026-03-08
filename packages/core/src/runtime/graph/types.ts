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
  op: "set" | "inc" | "dec" | "copy" | "toggle" | "append";
  /** Name of the variable to mutate (written as `vars.<varName>` in templates). */
  varName: string;
  /** Static value for `set` and `append` (supports {{ref}} strings). */
  value?: unknown;
  /** Dot-path reference for `copy` (e.g. "fetchTool.output.hasNext"). */
  fromRef?: string;
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
 */
export interface GraphNode {
  /** Unique identifier within the graph. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Determines execution behaviour. */
  type: "input" | "output" | "llm" | "agent" | "tool" | "condition" | "operation";

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
 * Stored as JSON in ~/.solix/graphs/<id>.json.
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
   */
  maxIterations?: number;
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
  onNodeStart?: (nodeId: string, nodeName: string) => void;
  /** Callback fired after each node completes (for progress tracking). */
  onNodeComplete?: (output: NodeOutput) => void;
  /** Override default provider for all nodes. */
  provider?: string;
  /** Override default model for all nodes. */
  model?: string;
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
  status: "completed" | "failed" | "aborted";
  error?: string;
  elapsedMs: number;
  startedAt: number;
  completedAt: number;
}
