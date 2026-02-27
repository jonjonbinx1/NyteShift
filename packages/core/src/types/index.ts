// ── SolixAI Core Type Definitions ──────────────────────────────────────

// ── Messages ───────────────────────────────────────────────────────────

export type MessageRole = "system" | "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string;
}

// ── Provider ───────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  description?: string;
}

export interface ProviderCallParams {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderCallResult {
  output: string;
  /** Optional chain-of-thought / reasoning from the model (e.g. Ollama thinking). */
  thinking?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface SolixProvider {
  id: string;
  listModels(): Promise<ModelInfo[]>;
  call(params: ProviderCallParams): Promise<ProviderCallResult>;
}

// ── Skill ──────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  version: string;
  contributor: string;
  description: string;
  tags?: string[];
  /**
   * Optional JSON-Schema-compatible object describing the inputs, outputs and
   * post-action verify hints for this skill.  Consumed by the core runtime
   * for documentation and validation purposes.
   */
  schema?: Record<string, unknown>;
}

export interface Skill {
  frontmatter: SkillFrontmatter;
  body: string;
  /** Resolved absolute path on disk. */
  filePath: string;
}

// ── Tool ───────────────────────────────────────────────────────────────

export interface ToolRunContext {
  input: unknown;
  context: Record<string, unknown>;
}

/**
 * Lightweight interface contract published by each tool so the runtime can
 * validate calls before execution and verify outcomes afterwards.
 */
export interface ToolSpec {
  /**
   * JSON Schema object (draft-07 compatible) describing the expected shape of
   * the `input` parameter passed to `run()`.  At minimum, declare `required`
   * fields and `properties` with `type` / `enum` constraints.
   */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema object describing the shape of the resolved return value. */
  outputSchema?: Record<string, unknown>;
  /**
   * Qualified tool names (e.g. `"base/filesystem"`) to invoke after a
   * successful call for post-action verification.  Each verify tool is called
   * with the same input so side-effects can be confirmed without extra model
   * reasoning.
   */
  verify?: string[];
}

export interface ToolContract {
  name: string;
  version: string;
  contributor: string;
  description: string;
  /**
   * Optional interface spec.  Tools that omit this will still load but will
   * generate a warning and forfeit input validation.
   */
  spec?: ToolSpec;
  run(ctx: ToolRunContext): Promise<unknown>;
}

// ── Agent ──────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  skills?: string[];
  tools?: string[];
  [key: string]: unknown;
}

// ── Config Hierarchy ───────────────────────────────────────────────────

export interface SolixConfig {
  defaultProvider?: string;
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;
  providers?: Record<string, ProviderSettings>;
  [key: string]: unknown;
}

export interface ProviderSettings {
  apiKey?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

// ── Pipeline ───────────────────────────────────────────────────────────

export interface AutonomousTaskOptions {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  signal?: AbortSignal;
  onStep?: (step: PipelineStep) => void;
  /** Prior conversation turns to prepend so the agent retains context. */
  chatHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface PipelineStep {
  index: number;
  action: string;
  input: unknown;
  output: unknown;
  /** Model reasoning / chain-of-thought for this step, if available. */
  thinking?: string;
  timestamp: number;
}

export interface PipelineResult {
  agentName: string;
  steps: PipelineStep[];
  finalOutput: string;
  /** Aggregated chain-of-thought from all steps. */
  thinking?: string;
  aborted: boolean;
}

// ── Trigger ────────────────────────────────────────────────────────────

export interface TriggerEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface PipelineConfig {
  steps: PipelineStepConfig[];
}

export interface PipelineStepConfig {
  skill?: string;
  tool?: string;
  input?: unknown;
}

// ── Control ────────────────────────────────────────────────────────────

export type ControlAction = "cancel" | "stop";
