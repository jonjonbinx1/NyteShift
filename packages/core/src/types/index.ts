// ── NyteShift Core Type Definitions ──────────────────────────────────────

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

export interface NyteShiftProvider {
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
  type: "string" | "secret" | "number" | "boolean" | "select" | "multiselect" | "textarea" | "action";
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
  // ── Action-type extras ────────────────────────────────────────────
  /** Label shown on the action button (falls back to label). */
  actionLabel?: string;
  /**
   * Message shown in the confirmation dialog before the action executes.
   * Defaults to a generic "Run <label>?" prompt.
   */
  actionConfirmText?: string;
  /**
   * Human-readable source snippet displayed when the user expands
   * "Review code" in the confirmation dialog.  For transparency only —
   * the actual implementation lives in the tool\'s configAction() method.
   */
  actionCode?: string;
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
  /**
   * Optional handler for config fields of type "action".
   * Called with the field\'s `key` when the user confirms the action in the
   * UI.  Should return a human-readable result string or
   * `{ ok: boolean; message: string }` on completion.
   */
  configAction?(key: string): Promise<unknown>;
  run(ctx: ToolRunContext): Promise<unknown>;
}

// ── Agent ──────────────────────────────────────────────────────────────

/**
 * Per-agent Discord channel access control.
 *
 * Controls whether and from where this agent can be addressed via Discord.
 * Applied by both per-agent bridges and the global shared bridge.
 *
 * When unset the agent is treated as `{ mode: "disabled" }` — it will not
 * respond to any Discord messages until this is explicitly configured.
 */
export interface DiscordAccessConfig {
  /**
   * "disabled"   — agent never responds to Discord messages (default).
   * "global"     — agent responds in any visible channel or server.
   * "restricted" — agent only responds in channels that pass all filters below.
   */
  mode: "disabled" | "global" | "restricted";

  /**
   * Discord server (guild) IDs to restrict to.
   * When set, channel filters only apply within these servers — messages from
   * every other server are ignored entirely.
   * Only evaluated when mode === "restricted".
   */
  serverIds?: string[];

  /**
   * Discord channel IDs to allow (more secure — IDs are stable and globally
   * unique; they cannot be changed by server admins).
   * Only evaluated when mode === "restricted".
   */
  channelIds?: string[];

  /**
   * Discord channel names to allow (less secure — names can be changed by
   * server admins and are not globally unique across servers).
   * Leading "#" is stripped; matching is case-insensitive.
   * Only evaluated when mode === "restricted".
   */
  channelNames?: string[];
}

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
  /**
   * When true the ReAct loop has no fixed step budget — it continues
   * until the model signals completion or the AbortSignal is fired.
   * Use with caution: an unbounded run will consume API credits until
   * cancelled or until the model decides it is done.
   */
  unbounded?: boolean;
  /**
   * Discord channel access control for this agent.
   * Defaults to `{ mode: "disabled" }` — the agent will not respond to any
   * Discord messages until explicitly configured.
   */
  discordAccess?: DiscordAccessConfig;
  /**
   * Per-channel access control for marketplace-installed channels.
   * Keys are the channel's qualified name (`contributor/name`).
   */
  channelAccess?: Record<string, ChannelAccessConfig>;
  [key: string]: unknown;
}

// ── Config Hierarchy ───────────────────────────────────────────────────

export interface NyteShiftConfig {
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
  /** Run retention and persistence settings for saved runs */
  runRetention?: RunRetentionSettings;
  [key: string]: unknown;
}

export interface ProviderSettings {
  apiKey?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface RunRetentionSettings {
  enabled?: boolean;
  /** Schedule string controlling recurring pruning. Examples:
   *  - "daily@00:00" (default) — every day at midnight
   *  - "weekly@mon@02:30" — every Monday at 02:30
   *  - "monthly@1@00:00" — 1st of month at midnight
   *  - cron expression (5 fields) — e.g. "0 0 * * *"
   *  - interval shorthand: "24h", "7d", "60m"
   */
  pruneSchedule?: string;

  graph?: { maxAgeDays?: number; maxItems?: number };
  triggers?: { maxAgeDays?: number; maxItems?: number };
}

// ── Pipeline ───────────────────────────────────────────────────────────

export interface AutonomousTaskOptions {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  /** When true the step budget is ignored; the loop runs until the model
   *  finishes or the AbortSignal fires. */
  unbounded?: boolean;
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
  /** Whether this trigger targets an agent or a graph. Defaults to agent. */
  targetType?: "agent" | "graph";
  /** When `targetType` is "graph", the graph ID to invoke. */
  targetId?: string;
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

// ── Channel ────────────────────────────────────────────────────────────

/**
 * Normalized inbound message from any messaging channel.
 *
 * Every channel adapter converts platform-specific events into this shape
 * before handing them to the agent runtime.
 */
export interface ChannelMessage {
  /** Which channel produced this message (e.g. "discord", "slack", "facebook-messenger"). */
  channel: string;
  /** Platform-specific conversation / thread identifier. */
  conversationId: string;
  /** Platform-specific unique message identifier (used for dedup). */
  messageId: string;
  /** Platform-specific user / sender identifier. */
  userId: string;
  /** Display name of the sender, if available. */
  userName?: string;
  /** Plain-text content of the message. */
  text: string;
  /** Optional file / media attachments. */
  attachments?: ChannelAttachment[];
  /** Unix timestamp (ms) when the message was sent. */
  timestamp: number;
  /** Arbitrary platform-specific metadata (guild ID, page ID, thread ts, etc.). */
  metadata?: Record<string, unknown>;
}

export interface ChannelAttachment {
  /** MIME type (e.g. "image/png", "application/pdf"). */
  mimeType: string;
  /** Download / CDN URL. */
  url: string;
  /** Optional filename. */
  name?: string;
  /** Size in bytes, if known. */
  size?: number;
}

/**
 * Outbound reply sent back through a channel adapter.
 */
export interface ChannelReply {
  /** Platform conversation / thread to reply in. */
  conversationId: string;
  /** Plain-text reply body. */
  text: string;
  /** Optional structured payload (quick replies, templates, embeds, etc.). */
  richPayload?: Record<string, unknown>;
}

/**
 * Contract that every channel adapter must implement.
 *
 * Channel adapters live at `~/.nyteshift/channels/<contributor>/<name>/channel.js`
 * and are discovered by the channel loader the same way tools are.
 *
 * The built-in Discord channel ships with the product.  Additional channels
 * (Slack, Facebook Messenger, WhatsApp, Telegram, etc.) can be installed
 * from the marketplace under the `channels` category.
 */
export interface ChannelContract {
  /** Human-readable channel name (e.g. "Discord", "Slack"). */
  name: string;
  /** SemVer version string. */
  version: string;
  /** Author / organisation. */
  contributor: string;
  /** Short description shown in the UI and marketplace. */
  description: string;

  /**
   * Whether this channel requires a persistent background process (bridge)
   * to stay connected (like Discord gateway or Slack Socket Mode).
   * When true the UI shows Start / Stop controls and a live status indicator.
   * Defaults to false (webhook-based channels that don't need a bridge).
   */
  requiresBridge?: boolean;

  /**
   * How this channel receives inbound messages.
   * - "persistent"  — WebSocket / long-lived connection (needs a running bridge).
   * - "webhook"     — HTTP callbacks; the trigger engine webhook server handles delivery.
   * - "oauth"       — Requires an OAuth install flow before use.
   * Defaults to "webhook".
   */
  connectionMode?: "persistent" | "webhook" | "oauth";

  /**
   * URL to platform-specific setup documentation (creating the app,
   * required scopes / permissions, admin consent, etc.).
   * Rendered as a clickable link in the settings panel.
   */
  docsUrl?: string;

  /**
   * Configurable fields this channel requires (bot tokens, webhook URLs,
   * page access tokens, signing secrets, etc.).
   * Rendered by the UI exactly like tool / skill config fields.
   */
  config?: ConfigFieldDefinition[];

  /**
   * Optional handler for config fields of type "action" (e.g. OAuth flow).
   */
  configAction?(key: string): Promise<unknown>;

  /**
   * Start listening for inbound messages.
   *
   * The adapter MUST call `onMessage` for every normalised inbound message.
   * This is where the adapter connects to the platform (WebSocket, webhook
   * server, long-poll, etc.).
   *
   * @param onMessage  callback the runtime provides; the adapter calls it
   *                   with each inbound {@link ChannelMessage}.
   * @param config     resolved config values (secrets are already decrypted).
   */
  start(
    onMessage: (msg: ChannelMessage) => void | Promise<void>,
    config: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Send a reply back through the channel.
   */
  send(reply: ChannelReply, config: Record<string, unknown>): Promise<void>;

  /**
   * Gracefully disconnect / clean up.
   */
  stop(): Promise<void>;
}

/**
 * Per-agent channel access control — generalises DiscordAccessConfig to
 * any installed channel.
 */
export interface ChannelAccessConfig {
  /**
   * "disabled"   — agent does not accept messages from this channel.
   * "global"     — agent responds to all conversations on this channel.
   * "restricted" — agent only responds in conversations matching the filters below.
   */
  mode: "disabled" | "global" | "restricted";

  /** Platform-specific server / workspace IDs to whitelist. */
  serverIds?: string[];

  /** Platform-specific conversation / channel IDs to whitelist. */
  channelIds?: string[];

  /** Human-readable channel names to whitelist (case-insensitive). */
  channelNames?: string[];
}

// ── Trigger ────────────────────────────────────────────────────────────

export type TriggerType = "cron" | "webhook" | "manual" | "discord" | "oneoff" | "monthly" | "channel";

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

  /**
   * Unix timestamp (ms) for one-off triggers.  The trigger fires once when this
   * moment is reached, then automatically disables itself.
   */
  runAt?: number;

  // ── Monthly trigger fields ─────────────────────────────────────────────

  /**
   * Whether a monthly trigger fires on a specific calendar day or on an
   * ordinal weekday (e.g. "first Monday").
   */
  monthlyType?: "day" | "ordinal";

  /** Day of month 1–31 for monthlyType "day". */
  monthlyDay?: number;

  /**
   * Ordinal position for monthlyType "ordinal".
   * Corresponds to "first" | "second" | "third" | "fourth" | "last".
   */
  monthlyOrdinal?: "first" | "second" | "third" | "fourth" | "last";

  /**
   * Target weekday for monthlyType "ordinal".
   *  0–6  → Sun–Sat (matches JS Date.getDay())
   * -1    → any day
   * -2    → weekday (Mon–Fri)
   * -3    → weekend day (Sat–Sun)
   */
  monthlyWeekday?: number;

  /** Hour (0–23) to fire monthly / one-off triggers. */
  monthlyHour?: number;

  /** Minute (0–59) to fire monthly / one-off triggers. */
  monthlyMinute?: number;

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

  /** Optional structured input forwarded to a graph when `targetType === 'graph'`. */
  triggerInput?: Record<string, unknown>;

  // ── Discord-specific fields ─────────────────────────────────────────

  /**
   * Discord bot token.
   * @deprecated Store via `nyteshift secret set trigger:<id>:discordBotToken <token>`.
   * Any plaintext value here is automatically migrated to the secret store on
   * first read and removed from triggers.json.
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

  /**
   * When set, the trigger can be invoked from Discord by typing
   * `/<command>` in any allowed channel, using the GlobalDiscordBridge.
   * No per-trigger bot token is required — the shared global bot handles
   * routing.  The reserved keywords `help`, `newchat`, and `cancel` are
   * not allowed as command names.
   */
  discordCommand?: string;

  /**
   * How the slash-command arguments (text after `/command`) are mapped
   * to the trigger / graph input:
   *  - `"none"`  — args are ignored; the static `triggerInput` is used.
   *  - `"text"`  — args are passed as `input.text` (default).
   *  - `"json"`  — args are JSON-parsed and passed as `input`.
   */
  discordCommandInput?: "none" | "text" | "json";

  /**
   * When true, suppress the "🚀 Command started" acknowledgement message
   * that is normally sent to Discord when a slash-command trigger fires.
   * Useful when the graph itself sends a reply and a double-reply would
   * be noisy or confusing.
   */
  discordSilentStart?: boolean;

  // ── Channel-adapter trigger fields ──────────────────────────────────

  /**
   * Qualified name of the marketplace channel adapter to use for this
   * trigger, e.g. "nyteshift/facebook-messenger".  Only relevant when
   * `type === "channel"`.
   */
  channelName?: string;

  /**
   * Operating mode for channel triggers:
   *  - `"trigger"` — each inbound message spawns an independent autonomous
   *    run (one-shot, no memory between invocations).
   *  - `"bridge"` — the channel acts as a persistent chat proxy, keeping
   *    full conversation history across messages.
   */
  channelMode?: "trigger" | "bridge";

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
  result?: PipelineResult | unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  /** Graph run ID when this trigger targeted a graph. Populated after the run starts. */
  graphRunId?: string;
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
 * Stored per-agent at ~/.nyteshift/agents/<name>/discord-bridge.json.
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
