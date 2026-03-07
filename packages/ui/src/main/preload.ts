import { contextBridge, ipcRenderer } from "electron";

/**
 * Expose a safe API to the renderer process via `window.solixApi`.
 */
// Forward renderer console output to main process for easier debugging
const forward = (level: "log" | "warn" | "error", args: unknown[]) => {
  try {
    ipcRenderer.send(`renderer:${level}`, ...args);
  } catch {
    // ignore if main not listening yet
  }
};
["log", "warn", "error"].forEach((lvl) => {
  const orig = console[lvl as "log" | "warn" | "error"].bind(console);
  console[lvl as "log" | "warn" | "error"] = (...args: unknown[]) => {
    forward(lvl as any, args);
    orig(...args);
  };
});

// signal that preload script has executed
console.log("[preload] loaded");
// also log again after a tick in case ipcRenderer isn't ready immediately
setTimeout(() => console.log("[preload] loaded (delayed)"), 0);

// mark that preload script has executed (for debugging)
try {
  (window as any).__preload_executed = true;
} catch {}

contextBridge.exposeInMainWorld("solixApi", {
  // Agents
  listAgents: (): Promise<string[]> => ipcRenderer.invoke("agents:list"),
  createAgent: (name: string) => ipcRenderer.invoke("agents:create", name),
  deleteAgent: (name: string) => ipcRenderer.invoke("agents:delete", name),
  getAgentConfig: (name: string) => ipcRenderer.invoke("agents:config", name),
  writeAgentConfig: (name: string, cfg: unknown) => ipcRenderer.invoke("agents:config:write", name, cfg),

  // Config
  readConfig: () => ipcRenderer.invoke("config:read"),
  writeConfig: (cfg: unknown) => ipcRenderer.invoke("config:write", cfg),

  // Soul
  readSoul: (name: string): Promise<string> => ipcRenderer.invoke("soul:read", name),
  writeSoul: (name: string, content: string) => ipcRenderer.invoke("soul:write", name, content),

  // Skills & Tools
  listSkills: () => ipcRenderer.invoke("skills:list"),
  listTools: () => ipcRenderer.invoke("tools:list"),

  // Providers
  listProviders: () => ipcRenderer.invoke("providers:list"),
  listProviderModels: (providerId: string) => ipcRenderer.invoke("providers:listModels", providerId),

  // Direct single-turn chat (no ReAct wrapping)
  chat: (opts: { systemPrompt: string; messages: Array<{ role: "user" | "assistant"; content: string }>; provider?: string; model?: string; temperature?: number; maxTokens?: number }) =>
    ipcRenderer.invoke("chat:complete", opts),

  // Tool config actions
  toolRunConfigAction: (qualifiedName: string, key: string) =>
    ipcRenderer.invoke("tool:configAction", qualifiedName, key),

  // Run
  runAutonomous: (name: string, task: string, opts?: { provider?: string; model?: string; temperature?: number; maxTokens?: number; maxSteps?: number; sessionId?: string; chatHistory?: Array<{ role: "user" | "assistant"; content: string }> }) =>
    ipcRenderer.invoke("run:autonomous", name, task, opts),
  // Control
  cancelRun: (agentName: string, sessionId: string) => ipcRenderer.invoke("run:cancel", agentName, sessionId),
  getRunStatus: (agentName: string) => ipcRenderer.invoke("run:status", agentName),
  clearRun: (runId: string) => ipcRenderer.invoke("run:clear", runId),
  onRunCompleted: (cb: (data: { runId: string; agentName: string; sessionId: string; error?: string; result?: any }) => void) => {
    ipcRenderer.on("run:completed", (_e, data) => cb(data));
  },

  // Chat Sessions
  listChatSessions: (agentName: string) => ipcRenderer.invoke("chats:list", agentName),
  loadChatSession: (agentName: string, sessionId: string) => ipcRenderer.invoke("chats:load", agentName, sessionId),
  saveChatSession: (session: any) => ipcRenderer.invoke("chats:save", session),
  deleteChatSession: (agentName: string, sessionId: string) => ipcRenderer.invoke("chats:delete", agentName, sessionId),
  deleteAllChatSessions: (agentName: string) => ipcRenderer.invoke("chats:deleteAll", agentName),

  // Marketplace
  marketplaceSync: () => ipcRenderer.invoke("marketplace:sync"),
  marketplaceBrowse: (opts?: { category?: string; search?: string }) =>
    ipcRenderer.invoke("marketplace:browse", opts),
  marketplaceCategories: () => ipcRenderer.invoke("marketplace:categories"),
  marketplaceInstall: (item: { category: string; contributor: string; name: string; remotePath?: string; localPath?: string; source?: string }) =>
    ipcRenderer.invoke("marketplace:install", item),
  marketplaceUninstall: (item: { category: string; contributor: string; name: string }) =>
    ipcRenderer.invoke("marketplace:uninstall", item),
  marketplaceConfigRead: () => ipcRenderer.invoke("marketplace:config:read"),
  marketplaceConfigWrite: (cfg: unknown) => ipcRenderer.invoke("marketplace:config:write", cfg),
  marketplaceSourceAdd: (source: { name: string; url: string; branch?: string; enabled: boolean }) =>
    ipcRenderer.invoke("marketplace:source:add", source),
  marketplaceSourceRemove: (name: string) => ipcRenderer.invoke("marketplace:source:remove", name),
  marketplaceSourceToggle: (name: string, enabled: boolean) =>
    ipcRenderer.invoke("marketplace:source:toggle", name, enabled),
  // Installed index, updates and auto-update
  marketplaceInstalled: () => ipcRenderer.invoke("marketplace:installed"),
  marketplaceUpdate: (item?: { category: string; contributor: string; name: string }) =>
    ipcRenderer.invoke("marketplace:update", item),
  marketplaceSetAutoUpdate: (item: { category: string; contributor: string; name: string }, enabled: boolean) =>
    ipcRenderer.invoke("marketplace:setAutoUpdate", item, enabled),
  marketplaceSetGlobalAutoUpdate: (enabled: boolean) =>
    ipcRenderer.invoke("marketplace:setGlobalAutoUpdate", enabled),

  // Change notifications
  onToolsChanged: (cb: () => void) => {
    ipcRenderer.on("tools:changed", () => cb());
  },
  onProvidersChanged: (cb: () => void) => {
    ipcRenderer.on("providers:changed", () => cb());
  },
  // helper to notify other pages that tools storage changed
  notifyToolsChanged: () => {
    ipcRenderer.send("tools:changed");
  },
  notifyProvidersChanged: () => {
    ipcRenderer.send("providers:changed");
  },

  // ── Triggers ──────────────────────────────────────────────────────────
  triggersListAll: () => ipcRenderer.invoke("triggers:listAll"),
  triggersListForAgent: (agentName: string) => ipcRenderer.invoke("triggers:listForAgent", agentName),
  triggersCreate: (params: {
    name: string;
    agentName: string;
    type: string;
    enabled: boolean;
    taskTemplate: string;
    schedule?: string;
    runAt?: number;
    monthlyType?: string;
    monthlyDay?: number;
    monthlyOrdinal?: string;
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
  }) => ipcRenderer.invoke("triggers:create", params),
  triggersUpdate: (triggerId: string, updates: Record<string, unknown>) =>
    ipcRenderer.invoke("triggers:update", triggerId, updates),
  triggersDelete: (triggerId: string) => ipcRenderer.invoke("triggers:delete", triggerId),
  triggersFire: (triggerId: string, payload?: Record<string, unknown>) =>
    ipcRenderer.invoke("triggers:fire", triggerId, payload),
  triggersEngineStart: () => ipcRenderer.invoke("triggers:engine:start"),
  triggersEngineStop: () => ipcRenderer.invoke("triggers:engine:stop"),
  triggersEngineStatus: () => ipcRenderer.invoke("triggers:engine:status"),
  triggersRuns: (filter?: { agentName?: string; triggerId?: string }) =>
    ipcRenderer.invoke("triggers:runs", filter),
  onTriggerRunUpdate: (cb: (run: any) => void) => {
    ipcRenderer.on("triggers:runUpdate", (_e, run) => cb(run));
  },

  // ── Discord Bridge ──────────────────────────────────────────────────
  discordBridgeStart: (agentName: string) => ipcRenderer.invoke("discord:bridge:start", agentName),
  discordBridgeStop: (agentName: string) => ipcRenderer.invoke("discord:bridge:stop", agentName),
  discordBridgeStatus: (agentName: string) => ipcRenderer.invoke("discord:bridge:status", agentName),
  discordBridgeConfigRead: (agentName: string) => ipcRenderer.invoke("discord:bridge:config:read", agentName),
  discordBridgeConfigWrite: (agentName: string, config: any) => ipcRenderer.invoke("discord:bridge:config:write", agentName, config),

  // ── Global Discord Bridge ───────────────────────────────────────────
  discordGlobalStart: () => ipcRenderer.invoke("discord:global:start"),
  discordGlobalStop: () => ipcRenderer.invoke("discord:global:stop"),
  discordGlobalStatus: () => ipcRenderer.invoke("discord:global:status"),
  discordGlobalConfigRead: () => ipcRenderer.invoke("discord:global:config:read"),
  discordGlobalConfigWrite: (config: any) => ipcRenderer.invoke("discord:global:config:write", config),

  // ── Skill / Tool Config ────────────────────────────────────────────
  skillToolConfigRead: (kind: "skill" | "tool", qualifiedName: string, agentName?: string) =>
    ipcRenderer.invoke("skillToolConfig:read", kind, qualifiedName, agentName),
  skillToolConfigWrite: (kind: "skill" | "tool", qualifiedName: string, values: Record<string, unknown>, agentName?: string) =>
    ipcRenderer.invoke("skillToolConfig:write", kind, qualifiedName, values, agentName),
  // ── Memory ─────────────────────────────────────────────────
  memoryWrite: (agentName: string, key: string, value: string, category?: string, note?: string) =>
    ipcRenderer.invoke("memory:write", agentName, key, value, category, note),
  memoryRead: (agentName: string, key: string) =>
    ipcRenderer.invoke("memory:read", agentName, key),
  memoryList: (agentName: string, category?: string) =>
    ipcRenderer.invoke("memory:list", agentName, category),
  memoryDelete: (agentName: string, key: string) =>
    ipcRenderer.invoke("memory:delete", agentName, key),
  memoryClear: (agentName: string) =>
    ipcRenderer.invoke("memory:clear", agentName),
  memorySearch: (agentName: string, query: string) =>
    ipcRenderer.invoke("memory:search", agentName, query),});
