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
  listSkills(): Promise<Array<{ frontmatter: { name: string; contributor: string; description: string } }>>;
  listTools(): Promise<Array<{ name: string; contributor: string; description: string }>>;
  // Providers
  listProviders(): Promise<Array<{ id: string }>>;
  /** Fetch models from a specific provider (or all if omitted). */
  listProviderModels(providerId?: string): Promise<ModelInfo[]>;
  runAutonomous(name: string, task: string, opts?: { provider?: string; model?: string; temperature?: number; maxTokens?: number; sessionId?: string; chatHistory?: Array<{ role: "user" | "assistant"; content: string }> }): Promise<{
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

  // Change notifications
  onToolsChanged(cb: () => void): void;
  notifyToolsChanged(): void;
  onProvidersChanged(cb: () => void): void;
  notifyProvidersChanged(): void;
}

declare global {
  interface Window {
    solixApi: SolixApi | undefined;
  }
}
