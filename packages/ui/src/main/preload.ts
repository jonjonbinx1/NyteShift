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

  // Run
  runAutonomous: (name: string, task: string, opts?: { provider?: string; model?: string; temperature?: number; maxTokens?: number; sessionId?: string }) =>
    ipcRenderer.invoke("run:autonomous", name, task, opts),
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
  marketplaceInstall: (item: { category: string; contributor: string; name: string; localPath: string }) =>
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

  // notifications
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
});
