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

// ── Configurable Field Contract ─────────────────────────────────────────

/**
 * Declares a single configurable field for a skill or tool.
 *
 * Skills list these under the `config` key in their YAML frontmatter.
 * Tools list them in a `config` array on their default export.
 *
 * The UI renders an appropriate form control for each field type and
 * stores values at the global or agent level.
 */
export interface ConfigFieldDefinition {
  /** Unique storage key (e.g. "apiKey"). */
  key: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Determines the rendered control. */
  type: "string" | "secret" | "number" | "boolean" | "select" | "multiselect" | "textarea";
  /** Brief help text displayed below the control. */
  description?: string;
  /** Whether the field must be provided before the skill/tool can run. */
  required?: boolean;
  /** Default value when not explicitly set. */
  default?: unknown;
  /** Available choices for "select" / "multiselect" types. */
  options?: string[];
  /** Minimum value ("number" type). */
  min?: number;
  /** Maximum value ("number" type). */
  max?: number;
  /** Step increment ("number" type). */
  step?: number;
  /** Placeholder text for string / secret / textarea inputs. */
  placeholder?: string;
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
  /**
   * Configurable fields this skill requires (API keys, preferences, etc.).
   * Declared in YAML frontmatter under the `config` key as an array.
   */
  config?: ConfigFieldDefinition[];
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
  /**
   * Configurable fields this tool requires (API keys, preferences, etc.).
   * Declared as an array on the tool's default export or as a named export.
   */
  config?: ConfigFieldDefinition[];
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
  /**
   * When true the agent may call `sub_agent_run` with `async: true`,
   * firing the child run in the background and continuing its own ReAct
   * loop immediately.  The result can be retrieved later with
   * `sub_agent_collect`.  Disabled by default to keep the simpler
   * synchronous Anthropic orchestrator-workers behaviour.
   */
  allowAsyncSubAgents?: boolean;
  [key: string]: unknown;
}

// ── Config Hierarchy ───────────────────────────────────────────────────

export interface SolixConfig {
  defaultProvider?: string;
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;
  providers?: Record<string, ProviderSettings>;
  /**
   * Default behaviour for automatic updates of marketplace items (skills/tools).
   * The `installed.json` index also stores a `globalAutoUpdate` flag for
   * backwards compatibility and migration, but new behaviour should read from
   * this field instead.
   */
  autoUpdate?: {
    /** When true, any installed item will be refreshed whenever the
     * marketplace cache changes. */
    marketplace?: boolean;
    /** Individual overrides may also be stored here though we currently
     * persist per-item state in `installed.json`. */
    skills?: Record<string, boolean>;
    tools?: Record<string, boolean>;
  };
  /**
   * Global Discord bot configuration.  When set, a single shared bot can
   * serve all agents that don't have their own per-agent discord-bridge.json.
   * Agents without their own config must be called by name in messages.
   */
  globalDiscord?: GlobalDiscordConfig;
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

  // ── Sub-agent orchestration ─────────────────────────────────────────
  /**
   * Current nesting depth.  Used to enforce the maximum recursion limit
   * and prevent infinite delegation loops.  0 = top-level run.
   *
   * Follows Anthropic's recommendation to bound orchestrator-worker
   * delegation depth so a misbehaving agent cannot spawn unbounded
   * sub-agent chains.
   */
  _depth?: number;
  /**
   * Maximum allowed nesting depth for sub-agent delegation.
   * Default: 3 (parent → child → grandchild → great-grandchild).
   */
  maxDepth?: number;
  /**
   * Name of the parent agent that spawned this run, if any.
   * Stored for observability and lineage tracking.
   */
  parentAgent?: string;
  /**
   * Unique identifier of the parent run, if this task was spawned as a
   * sub-agent delegation.
   */
  parentRunId?: string;
}

export interface PipelineStep {
  index: number;
  action: string;
  input: unknown;
  output: unknown;
  /** Model reasoning / chain-of-thought for this step, if available. */
  thinking?: string;
  timestamp: number;
  /**
   * When this step is a sub-agent delegation, contains the full result
   * from the child run for observability / UI expansion.
   */
  subAgentResult?: SubAgentResult;
}

export interface PipelineResult {
  agentName: string;
  steps: PipelineStep[];
  finalOutput: string;
  /** Aggregated chain-of-thought from all steps. */
  thinking?: string;
  aborted: boolean;
  /** Parent agent name if this was a sub-agent run. */
  parentAgent?: string;
  /** Unique ID of the parent run when this is a sub-agent. */
  parentRunId?: string;
  /** Nesting depth (0 = top-level). */
  depth?: number;
  /** Sub-agent runs spawned during this pipeline execution. */
  subAgentRuns?: SubAgentResult[];
}

/**
 * Lightweight record of a completed sub-agent delegation.
 *
 * Follows Anthropic's orchestrator-workers pattern — each delegation is
 * a self-contained autonomous run that returns a final answer to the parent.
 */
export interface SubAgentResult {
  /** Name of the delegated agent. */
  agentName: string;
  /** Task description sent to the sub-agent. */
  task: string;
  /** Final answer produced by the sub-agent. */
  finalOutput: string;
  /** Number of ReAct steps consumed. */
  stepCount: number;
  /** Elapsed wall-clock time in ms. */
  elapsedMs: number;
  /** Whether the sub-agent was aborted. */
  aborted: boolean;
  /** Nesting depth of this sub-agent (1 = direct child). */
  depth: number;
  /** Full step details (for UI drill-down). */
  steps?: PipelineStep[];
  /** Any nested sub-agent results from this child. */
  children?: SubAgentResult[];
  // ── Async delegation fields ──────────────────────────────────────────
  /** True when the sub-agent was launched asynchronously (fire-and-forget). */
  isAsync?: boolean;
  /** Stable identifier for the async run (used with sub_agent_collect). */
  runId?: string;
  /** Lifecycle status for async runs. Sync runs are always "completed". */
  status?: "running" | "completed" | "failed";
  /** Error message when status is "failed". */
  error?: string;
}

// ── Trigger ────────────────────────────────────────────────────────────

export type TriggerType = "cron" | "webhook" | "manual" | "discord";

export interface TriggerEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/**
 * Persistent definition of a trigger attached to an agent.
 *
 * Follows the industry-standard pattern used by Anthropic's agentic tool-use
 * and OpenAI's Assistants API: an external event spawns a full autonomous run
 * of the agent with a templated task description.
 */
export interface TriggerDefinition {
  id: string;
  name: string;
  type: TriggerType;
  agentName: string;
  enabled: boolean;

  /** Cron expression (e.g. every-5-min) or interval shorthand ("5m", "1h"). */
  schedule?: string;

  /** URL path for webhook triggers (e.g. "/hooks/my-agent"). */
  webhookPath?: string;

  /** Optional secret for webhook HMAC-SHA256 signature verification. */
  webhookSecret?: string;

  /**
   * Task description sent to the agent when triggered.
   * Supports {{payload}}, {{payload.field}}, {{type}}, {{timestamp}} interpolation.
   */
  taskTemplate: string;

  /** Override provider for triggered runs. */
  provider?: string;

  /** Override model for triggered runs. */
  model?: string;

  /** Max autonomous steps for triggered runs (default 10). */
  maxSteps?: number;

  // ── Discord-specific fields ─────────────────────────────────────────

  /**
   * Discord bot token.  For production, prefer storing in global config
   * and referencing by key; this inline field is convenient for quick setup.
   */
  discordBotToken?: string;

  /** Restrict the trigger to a specific Discord guild (server) by ID. */
  discordGuildId?: string;

  /** Channel IDs the trigger listens to.  Empty = all visible channels. */
  discordChannelIds?: string[];

  /**
   * When true, the trigger only fires when the bot is @mentioned.
   * When false (default), every message in the watched channels fires.
   */
  discordMentionOnly?: boolean;

  /**
   * Discord operating mode:
   *  - `"trigger"` — each matching Discord message spawns an independent
   *    autonomous run (one-shot, no memory between invocations).
   *  - `"bridge"` — the Discord channel acts as a chat proxy for the agent,
   *    maintaining full conversation history across messages.
   *
   * Default is `"trigger"`.
   */
  discordMode?: "trigger" | "bridge";

  createdAt: number;
  updatedAt: number;
}

/**
 * Runtime record of a single trigger invocation.
 */
export interface TriggerRun {
  id: string;
  triggerId: string;
  triggerName: string;
  agentName: string;
  status: "running" | "completed" | "failed";
  event: TriggerEvent;
  result?: PipelineResult;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface PipelineConfig {
  steps: PipelineStepConfig[];
}

export interface PipelineStepConfig {
  skill?: string;
  tool?: string;
  input?: unknown;
}

// ── Discord ────────────────────────────────────────────────────────────

/**
 * Persistent configuration for a Discord bridge (chat-proxy mode).
 *
 * Stored per-agent at ~/.solix/agents/<name>/discord-bridge.json.
 * Follows the channel-adapter pattern from OpenClaw and Anthropic's
 * multi-channel assistant architecture.
 */
export interface DiscordBridgeConfig {
  /** Discord bot token (required). */
  botToken: string;
  /** Agent this bridge is attached to. */
  agentName: string;
  /** Guild (server) ID to restrict to (optional). */
  guildId?: string;
  /** Channel IDs this bridge listens on.  Empty = all visible channels. */
  channelIds?: string[];
  /** Only respond when the bot is @mentioned. */
  mentionOnly?: boolean;
  /** Whether the bridge is active. */
  enabled: boolean;
  /** Provider override for bridge conversations. */
  provider?: string;
  /** Model override for bridge conversations. */
  model?: string;
}

/**
 * Global Discord configuration stored in the user's top-level config.
 *
 * A single "global bot" can serve ALL agents that don't have their own
 * per-agent discord-bridge.json.  Messages must be prefixed with the
 * agent name to be routed correctly — e.g. `@AgentName do a task` or
 * `AgentName: do a task`.  Agents that have their own bot token configured
 * in their per-agent discord-bridge.json can be messaged directly without
 * any name prefix.
 */
export interface GlobalDiscordConfig {
  /** Discord bot token for the shared global bot. */
  botToken: string;
  /** Restrict to a specific guild ID (optional). */
  guildId?: string;
  /** Channel IDs to listen on.  Empty = all visible channels. */
  channelIds?: string[];
  /** Whether the global bridge is active. */
  enabled: boolean;
  /**
   * Conversation mode for agents routed through the global bot:
   *  - `"bridge"` — persistent chat session per channel per agent (default).
   *  - `"trigger"` — one-shot autonomous run per message, no history.
   */
  mode?: "trigger" | "bridge";
  /**
   * Optional channel-to-agent routing map.
   * Key = Discord channel **name** (e.g. `"codi"`) or channel **ID** (e.g. `"987654321"`), value = agent name.
   * Lookup is attempted by ID first, then by name (case-insensitive, leading "#" stripped).
   * Messages sent in a mapped channel are routed directly to that agent
   * without requiring any name prefix — the bot acts as if it owns that channel.
   * Mapped channels are implicitly whitelisted even if they are not in channelIds.
   */
  channelAgentMap?: Record<string, string>;
}

// ── Control ────────────────────────────────────────────────────────────

export type ControlAction = "cancel" | "stop";
