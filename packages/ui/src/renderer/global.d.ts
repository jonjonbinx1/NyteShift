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
  localPath: string;
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
  description?: string;
  /** The provider this model belongs to (populated by providers:listModels). */
  provider?: string;
}

export interface ChatMessageInfo {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  thinking?: string;
  ts: number;
  steps?: Array<{ index: number; action: string; output: unknown; thinking?: string }>;
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

export type TriggerType = "cron" | "webhook" | "manual" | "discord";

// ── Configurable Field Contract ─────────────────────────────────────

export interface ConfigFieldDefinitionInfo {
  key: string;
  label: string;
  type: "string" | "secret" | "number" | "boolean" | "select" | "multiselect" | "textarea";
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

export interface TriggerDefinitionInfo {
  id: string;
  name: string;
  type: TriggerType;
  agentName: string;
  enabled: boolean;
  schedule?: string;
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
  listTools(): Promise<Array<{ name: string; contributor: string; description: string; config?: ConfigFieldDefinitionInfo[] }>>;
  // Providers
  listProviders(): Promise<Array<{ id: string }>>;
  /** Fetch models from a specific provider (or all if omitted). */
  listProviderModels(providerId?: string): Promise<ModelInfo[]>;
  runAutonomous(name: string, task: string, opts?: { provider?: string; model?: string; temperature?: number; maxTokens?: number; maxSteps?: number; sessionId?: string; chatHistory?: Array<{ role: "user" | "assistant"; content: string }> }): Promise<{
    finalOutput: string;
    thinking?: string;
    steps: Array<{ index: number; action: string; output: unknown; thinking?: string }>;
    aborted: boolean;
  }>;
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
  marketplaceInstall(item: { category: string; contributor: string; name: string; localPath: string }): Promise<{ installed: boolean; path: string; message: string }>;
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
  memorySearch(agentName: string, query: string): Promise<MemoryEntryInfo[]>;}

declare global {
  interface Window {
    solixApi: SolixApi | undefined;
  }
}
