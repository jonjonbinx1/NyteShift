/** Type declarations for the preload-exposed API. */

export interface MarketplaceSourceConfig {
  name: string;
  url: string;
  branch?: string;
  enabled: boolean;
}

export interface MarketplaceItemInfo {
  source: string;
  category: string;
  contributor: string;
  name: string;
  /** Path inside the remote repo (e.g. "skills/contributor/name"). Present for remote items. */
  remotePath?: string;
  /** @deprecated No longer populated for remote items. */
  localPath?: string;
  installed: boolean;
  description: string;
  version?: string;
  autoUpdate?: boolean;
  needsUpdate?: boolean;
}

export interface MarketplaceSyncResultInfo {
  source: string;
  status: "cloned" | "updated" | "error" | "disabled";
  message: string;
}

export interface ModelInfo {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  description: string;
  /** The provider this model belongs to (populated by providers:listModels). */
  provider?: string;
}

export interface ToolInfo {
  name: string;
  contributor: string;
  description?: string;
  /** Optional declarative config fields (legacy) */
  config?: ConfigFieldDefinitionInfo[];
  /** Optional formal spec describing input/output JSON schemas */
  spec?: {
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    [k: string]: unknown;
  };
}

// ── Sub-Agent Delegation ──────────────────────────────────────────

/**
 * Lightweight record of a completed sub-agent delegation.
 * Mirrors the core SubAgentResult type for renderer consumption.
 */
export interface SubAgentResultInfo {
  agentName: string;
  task: string;
  finalOutput: string;
  stepCount: number;
  elapsedMs: number;
  aborted: boolean;
  depth: number;
  steps?: Array<{ index: number; action: string; output: unknown; thinking?: string; subAgentResult?: SubAgentResultInfo }>;
  children?: SubAgentResultInfo[];
  /** True when the sub-agent was launched asynchronously. */
  isAsync?: boolean;
  /** Stable run identifier for async runs (used with sub_agent_collect). */
  runId?: string;
  /** Lifecycle state. Sync runs always arrive as "completed". */
  status?: "running" | "completed" | "failed";
  /** Error description when status is "failed". */
  error?: string;
}

export interface ChatMessageInfo {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  thinking?: string;
  ts: number;
  steps?: Array<{ index: number; action: string; output: unknown; thinking?: string; subAgentResult?: SubAgentResultInfo }>;
}

export interface ChatSessionInfo {
  id: string;
  agentName: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessageInfo[];
}

export interface ChatSessionSummaryInfo {
  id: string;
  agentName: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
}
// ── Memory ────────────────────────────────────────────────

export interface MemoryEntryInfo {
  key: string;
  value: string;
  category?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}
// ── Triggers ────────────────────────────────────────────────────────

export type TriggerType = "cron" | "webhook" | "manual" | "discord" | "oneoff" | "monthly";

// ── Configurable Field Contract ─────────────────────────────────────

export interface ConfigFieldDefinitionInfo {
  key: string;
  label: string;
  type: "string" | "secret" | "number" | "boolean" | "select" | "multiselect" | "textarea" | "action";
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  actionLabel?: string;
  actionConfirmText?: string;
  actionCode?: string;
}

export interface TriggerDefinitionInfo {
  id: string;
  name: string;
  type: TriggerType;
  agentName: string;
  enabled: boolean;
  schedule?: string;
  /** Unix timestamp (ms) for one-off triggers. */
  runAt?: number;
  /** Monthly trigger sub-type. */
  monthlyType?: "day" | "ordinal";
  /** Day of month 1–31 for monthlyType "day". */
  monthlyDay?: number;
  monthlyOrdinal?: "first" | "second" | "third" | "fourth" | "last";
  /** 0–6 (Sun–Sat) | -1 (day) | -2 (weekday) | -3 (weekend day). */
  monthlyWeekday?: number;
  monthlyHour?: number;
  monthlyMinute?: number;
  webhookPath?: string;
  webhookSecret?: string;
  taskTemplate: string;
  provider?: string;
  model?: string;
  maxSteps?: number;
  // Discord-specific fields
  discordBotToken?: string;
  discordGuildId?: string;
  discordChannelIds?: string[];
  discordMentionOnly?: boolean;
  discordMode?: "trigger" | "bridge";
  createdAt: number;
  updatedAt: number;
}

export interface TriggerRunInfo {
  id: string;
  triggerId: string;
  triggerName: string;
  agentName: string;
  status: "running" | "completed" | "failed";
  event: { type: string; payload: Record<string, unknown>; timestamp: number };
  result?: { finalOutput: string; aborted: boolean; steps: number };
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface SolixApi {
  listAgents(): Promise<string[]>;
  createAgent(name: string): Promise<{ name: string }>;
  deleteAgent(name: string): Promise<void>;
  getAgentConfig(name: string): Promise<Record<string, unknown>>;
  writeAgentConfig(name: string, cfg: Record<string, unknown>): Promise<void>;
  readConfig(): Promise<Record<string, unknown>>;
  writeConfig(cfg: unknown): Promise<void>;
  readSoul(name: string): Promise<string>;
  writeSoul(name: string, content: string): Promise<void>;
  listSkills(): Promise<Array<{ frontmatter: { name: string; contributor: string; description: string; config?: ConfigFieldDefinitionInfo[] } }>>;
  listTools(): Promise<ToolInfo[]>;
  // Providers
  listProviders(): Promise<Array<{ id: string }>>;
  /** Fetch models from a specific provider (or all if omitted). */
  listProviderModels(providerId?: string): Promise<ModelInfo[]>;
  /** Direct single-turn chat — bypasses the ReAct pipeline. */
  chat(opts: { systemPrompt: string; messages: Array<{ role: "user" | "assistant"; content: string }>; provider?: string; model?: string; temperature?: number; maxTokens?: number }): Promise<{ output: string }>;
  /** Run a config action declared by a tool (type: "action" fields). Requires user confirmation in the UI first. */
  toolRunConfigAction(qualifiedName: string, key: string): Promise<unknown>;
  runAutonomous(name: string, task: string, opts?: { provider?: string; model?: string; temperature?: number; maxTokens?: number; maxSteps?: number; sessionId?: string; chatHistory?: Array<{ role: "user" | "assistant"; content: string }> }): Promise<{
    finalOutput: string;
    thinking?: string;
    steps: Array<{ index: number; action: string; output: unknown; thinking?: string; subAgentResult?: SubAgentResultInfo }>;
    aborted: boolean;
    subAgentRuns?: SubAgentResultInfo[];
    depth?: number;
    parentAgent?: string;
  }>;
  /** Request cancellation of a running agent for the given agent/session. */
  cancelRun(agentName: string, sessionId: string): Promise<{ cancelled: number }>;
  getRunStatus(agentName: string): Promise<Array<{ runId: string; agentName: string; sessionId: string; status: string; result?: any; error?: string }>>;
  clearRun(runId: string): Promise<void>;
  onRunCompleted(cb: (data: { runId: string; agentName: string; sessionId: string; error?: string; result?: any }) => void): void; // result is the PipelineResult when available

  // Chat Sessions
  listChatSessions(agentName: string): Promise<ChatSessionSummaryInfo[]>;
  loadChatSession(agentName: string, sessionId: string): Promise<ChatSessionInfo | null>;
  saveChatSession(session: ChatSessionInfo): Promise<void>;
  deleteChatSession(agentName: string, sessionId: string): Promise<void>;
  deleteAllChatSessions(agentName: string): Promise<void>;

  // Marketplace
  marketplaceSync(): Promise<MarketplaceSyncResultInfo[]>;
  marketplaceBrowse(opts?: { category?: string; search?: string }): Promise<MarketplaceItemInfo[]>;
  marketplaceCategories(): Promise<string[]>;
  marketplaceInstall(item: { category: string; contributor: string; name: string; remotePath?: string; localPath?: string; source?: string }): Promise<{ installed: boolean; path: string; message: string }>;
  marketplaceUninstall(item: { category: string; contributor: string; name: string }): Promise<{ message: string }>;
  marketplaceConfigRead(): Promise<{ sources: MarketplaceSourceConfig[] }>;
  marketplaceConfigWrite(cfg: { sources: MarketplaceSourceConfig[] }): Promise<void>;
  marketplaceSourceAdd(source: MarketplaceSourceConfig): Promise<{ sources: MarketplaceSourceConfig[] }>;
  marketplaceSourceRemove(name: string): Promise<{ sources: MarketplaceSourceConfig[] }>;
  marketplaceSourceToggle(name: string, enabled: boolean): Promise<{ sources: MarketplaceSourceConfig[] }>;

  // auto-update and updates
  marketplaceCheckUpdates(): Promise<Array<{ item: { category: string; contributor: string; name: string; hash: string }; updated: boolean; message: string }>>;
  marketplaceUpdate(item?: { category: string; contributor: string; name: string }): Promise<any>;
  marketplaceSetAutoUpdate(item: { category: string; contributor: string; name: string }, enabled: boolean): Promise<void>;
  marketplaceSetGlobalAutoUpdate(enabled: boolean): Promise<void>;
  marketplaceInstalled(): Promise<{ globalAutoUpdate?: boolean; items: Array<{ category: string; contributor: string; name: string; version?: string; hash: string; autoUpdate?: boolean }> }>;

  // Change notifications
  onToolsChanged(cb: () => void): void;
  notifyToolsChanged(): void;
  onProvidersChanged(cb: () => void): void;
  notifyProvidersChanged(): void;

  // ── Triggers ──────────────────────────────────────────────────────
  triggersListAll(): Promise<TriggerDefinitionInfo[]>;
  triggersListForAgent(agentName: string): Promise<TriggerDefinitionInfo[]>;
  triggersCreate(params: {
    name: string;
    agentName: string;
    type: TriggerType;
    enabled: boolean;
    taskTemplate: string;
    schedule?: string;
    runAt?: number;
    monthlyType?: "day" | "ordinal";
    monthlyDay?: number;
    monthlyOrdinal?: "first" | "second" | "third" | "fourth" | "last";
    monthlyWeekday?: number;
    monthlyHour?: number;
    monthlyMinute?: number;
    webhookPath?: string;
    webhookSecret?: string;
    provider?: string;
    model?: string;
    maxSteps?: number;
    // Discord fields
    discordBotToken?: string;
    discordGuildId?: string;
    discordChannelIds?: string[];
    discordMentionOnly?: boolean;
    discordMode?: "trigger" | "bridge";
  }): Promise<TriggerDefinitionInfo>;

  // ── Discord Bridge ──────────────────────────────────────────────
  discordBridgeStart(agentName: string): Promise<{ running: boolean }>;
  discordBridgeStop(agentName: string): Promise<{ running: boolean }>;
  discordBridgeStatus(agentName: string): Promise<{ running: boolean }>;
  discordBridgeConfigRead(agentName: string): Promise<{
    botToken: string;
    agentName: string;
    guildId?: string;
    channelIds?: string[];
    mentionOnly?: boolean;
    enabled: boolean;
    provider?: string;
    model?: string;
  } | null>;
  discordBridgeConfigWrite(agentName: string, config: {
    botToken: string;
    agentName: string;
    guildId?: string;
    channelIds?: string[];
    mentionOnly?: boolean;
    enabled: boolean;
    provider?: string;
    model?: string;
  }): Promise<void>;

  // ── Global Discord Bridge ───────────────────────────────────────
  /** Start the global Discord bridge using the stored config. */
  discordGlobalStart(): Promise<{ running: boolean }>;
  /** Stop the global Discord bridge. */
  discordGlobalStop(): Promise<{ running: boolean }>;
  /** Whether the global Discord bridge is currently running. */
  discordGlobalStatus(): Promise<{ running: boolean }>;
  /** Read the global Discord config from ~/.solix/config.json. */
  discordGlobalConfigRead(): Promise<{
    botToken: string;
    guildId?: string;
    channelIds?: string[];
    enabled: boolean;
    mode?: "trigger" | "bridge";
    channelAgentMap?: Record<string, string>;
  } | null>;
  /** Write the global Discord config to ~/.solix/config.json. */
  discordGlobalConfigWrite(config: {
    botToken: string;
    guildId?: string;
    channelIds?: string[];
    enabled: boolean;
    mode?: "trigger" | "bridge";
    channelAgentMap?: Record<string, string>;
  }): Promise<void>;
  triggersUpdate(triggerId: string, updates: Partial<TriggerDefinitionInfo>): Promise<TriggerDefinitionInfo | null>;
  triggersDelete(triggerId: string): Promise<boolean>;
  triggersFire(triggerId: string, payload?: Record<string, unknown>): Promise<TriggerRunInfo>;
  triggersEngineStart(): Promise<{ running: boolean }>;
  triggersEngineStop(): Promise<{ running: boolean }>;
  triggersEngineStatus(): Promise<{ running: boolean }>;
  triggersRuns(filter?: { agentName?: string; triggerId?: string }): Promise<TriggerRunInfo[]>;
  onTriggerRunUpdate(cb: (run: TriggerRunInfo) => void): void;

  // ── Skill / Tool Config ────────────────────────────────────────────
  /** Read resolved config values for a skill or tool (global → agent merge). */
  skillToolConfigRead(kind: "skill" | "tool", qualifiedName: string, agentName?: string): Promise<Record<string, unknown>>;
  /** Write config values at global or agent scope. */
  skillToolConfigWrite(kind: "skill" | "tool", qualifiedName: string, values: Record<string, unknown>, agentName?: string): Promise<void>;
  // ── Memory ───────────────────────────────────────────────
  /**
   * Store or update a persistent memory for an agent.
   * Memories survive across chat sessions and are only retrieved when the
   * agent explicitly calls memory_read / memory_list / memory_search.
   */
  memoryWrite(agentName: string, key: string, value: string, category?: string, note?: string): Promise<MemoryEntryInfo>;
  /** Retrieve a single memory by key (null if not found). */
  memoryRead(agentName: string, key: string): Promise<MemoryEntryInfo | null>;
  /** List all memories, optionally filtered by category. */
  memoryList(agentName: string, category?: string): Promise<MemoryEntryInfo[]>;
  /** Delete a single memory by key. */
  memoryDelete(agentName: string, key: string): Promise<void>;
  /** Delete ALL memories for an agent (agent reset). */
  memoryClear(agentName: string): Promise<void>;
  /** Keyword search across all memory fields. */
  memorySearch(agentName: string, query: string): Promise<MemoryEntryInfo[]>;

  // ── Agent Graph ────────────────────────────────────────────────────
  graphList(): Promise<GraphDefinitionInfo[]>;
  graphLoad(id: string): Promise<GraphDefinitionInfo | null>;
  graphSave(graph: GraphDefinitionInfo): Promise<void>;
  graphDelete(id: string): Promise<void>;
  graphValidate(graph: GraphDefinitionInfo): Promise<{ valid: boolean; errors: GraphValidationErrorInfo[] }>;
  /** Start a graph run — returns immediately with a runId. The run progresses asynchronously. */
  graphRun(graphOrId: string | GraphDefinitionInfo, opts?: { input?: Record<string, unknown>; provider?: string; model?: string }): Promise<{ runId: string }>;
  graphRunStatus(runId: string): Promise<GraphRunStatusInfo | null>;
  graphRuns(): Promise<Array<{ runId: string; status: "running" | "done" | "error"; result?: GraphExecutionResultInfo; error?: string; nodeProgress: NodeOutputInfo[]; graphId?: string; startedAt?: number }>>;
  graphRunCancel(runId: string): Promise<void>;
  onGraphNodeStart(cb: (data: { runId: string; nodeId: string; nodeName: string }) => void): void;
  onGraphNodeComplete(cb: (data: { runId: string; nodeOutput: NodeOutputInfo }) => void): void;
  onGraphRunComplete(cb: (data: { runId: string; result?: GraphExecutionResultInfo; error?: string }) => void): void;
}

// ── Agent Graph Types ──────────────────────────────────────────────────

export interface ConditionPredicateInfo {
  ref: string;
  operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "not_contains" | "starts_with" | "ends_with" | "exists" | "not_exists" | "matches";
  value?: unknown;
  /** How the comparison value should be interpreted in the UI/runtime */
  valueType?: "auto" | "string" | "number" | "boolean" | "json";
}

export interface ErrorPolicyInfo {
  type: "halt" | "retry" | "skip" | "fallback";
  maxRetries?: number;
  retryDelayMs?: number;
  retryBackoffMultiplier?: number;
  fallbackValue?: unknown;
}

export interface OperationActionInfo {
  op: "set" | "inc" | "dec" | "copy" | "toggle" | "append";
  varName: string;
  value?: unknown;
  fromRef?: string;
  amount?: number;
}

export interface GraphNodeInfo {
  id: string;
  name: string;
  type: "input" | "output" | "llm" | "agent" | "tool" | "condition" | "operation";
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  promptTemplate?: string;
  agentName?: string;
  maxSteps?: number;
  skills?: string[];
  tools?: string[];
  toolName?: string;
  toolInput?: Record<string, unknown>;
  branches?: Array<{ label: string; condition: ConditionPredicateInfo; target: string }>;
  defaultTarget?: string;
  operationAction?: OperationActionInfo;
  outputKey?: string;
  errorPolicy?: ErrorPolicyInfo;
  position?: { x: number; y: number };
}

export interface GraphEdgeInfo {
  id: string;
  source: string;
  target: string;
  condition?: ConditionPredicateInfo;
  label?: string;
}

export interface GraphDefinitionInfo {
  id: string;
  name: string;
  description?: string;
  version: string;
  nodes: GraphNodeInfo[];
  edges: GraphEdgeInfo[];
  defaultProvider?: string;
  defaultModel?: string;
  errorPolicy?: ErrorPolicyInfo;
  initVars?: Record<string, unknown>;
  maxIterations?: number;
  createdAt: number;
  updatedAt: number;
}

export interface NodeOutputInfo {
  nodeId: string;
  nodeName: string;
  output: unknown;
  rawOutput?: string;
  metadata: {
    provider?: string;
    model?: string;
    tokens?: { prompt: number; completion: number };
    elapsedMs: number;
    toolCalls?: Array<{ name: string; input: unknown; output: unknown }>;
    agentSteps?: number;
    iteration?: number;
  };
  status: "success" | "error" | "skipped";
  error?: string;
  timestamp: number;
}

export interface GraphExecutionResultInfo {
  graphId: string;
  graphName: string;
  traceId: string;
  nodeResults: NodeOutputInfo[];
  finalOutput: unknown;
  status: "completed" | "failed" | "aborted";
  error?: string;
  elapsedMs: number;
  startedAt: number;
  completedAt: number;
}

export interface GraphValidationErrorInfo {
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}

export interface GraphRunStatusInfo {
  status: "running" | "done" | "error";
  result?: GraphExecutionResultInfo;
  error?: string;
  nodeProgress: NodeOutputInfo[];
}

/** Live state of a single node during or after a graph run. */
export interface NodeRunState {
  status: "running" | "success" | "error" | "skipped";
  /** Loop iteration index (0-based), set for nodes inside SCC loops. */
  iteration?: number;
  /** Execution elapsed time in ms (available after completion). */
  elapsedMs?: number;
  /** Client-side timestamp (ms) when this node began executing. */
  startedAt: number;
  /** The node's output value (available after completion). */
  output?: unknown;
  /** Error message if status is "error". */
  error?: string;
}

/** A single entry in the run execution log timeline. */
export interface NodeRunEvent {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  /** Loop iteration index (0-based). */
  iteration?: number;
  /** Client-side timestamp when execution started. */
  startedAt: number;
  /** Client-side timestamp when execution finished. */
  endedAt?: number;
  /** Milliseconds taken (available after completion). */
  elapsedMs?: number;
  status: "running" | "success" | "error" | "skipped";
  output?: unknown;
  error?: string;
}

declare global {
  interface Window {
    solixApi: SolixApi | undefined;
  }
}
