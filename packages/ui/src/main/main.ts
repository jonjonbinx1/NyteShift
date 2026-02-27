import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import {
  listAgents,
  createAgent,
  deleteAgent,
  loadAgentConfig,
  writeAgentConfig,
  readGlobalConfig,
  writeGlobalConfig,
  readSoul,
  writeSoul,
  listSkills,
  listTools,
  listProviders,
  listAllModels,
  whenUserProvidersLoaded,
  runAutonomousTask,
  ensureSolixDirs,
  // Chat sessions
  listChatSessions,
  loadChatSession,
  saveChatSession,
  deleteChatSession,
  deleteAllChatSessions,
  // Marketplace
  syncAllMarketplaces,
  browseMarketplace,
  listMarketplaceCategories,
  installMarketplaceItem,
  uninstallMarketplaceItem,
  readMarketplaceConfig,
  writeMarketplaceConfig,
  addMarketplaceSource,
  removeMarketplaceSource,
  toggleMarketplaceSource,
} from "@solix/core";
import type { ChatSession } from "@solix/core";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // prefer preload.js when available (build now outputs .js)
  let preloadPath = join(__dirname, "../preload/preload.js");
  if (!require("fs").existsSync(preloadPath)) {
    preloadPath = join(__dirname, "../preload/preload.mjs");
  }
  console.log("[main] __dirname=", __dirname);
  console.log("[main] preload path=", preloadPath);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "SolixAI",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Automatically open devtools for easier debugging when running in
  // development mode.  They can be disabled by setting the
  // `SOLIX_DEVTOOLS=false` environment variable (useful for CI or when the
  // console is distracting).
  if (process.env.ELECTRON_RENDERER_URL && process.env.SOLIX_DEVTOOLS !== "false") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // In dev, load Vite dev server; in prod, load the built file.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ── IPC Handlers ───────────────────────────────────────────────────────

function registerIpc(): void {
  // forward renderer console logs into main terminal
  ipcMain.on("renderer:log", (_e, ...args: unknown[]) => console.log("[renderer]", ...args));
  ipcMain.on("renderer:warn", (_e, ...args: unknown[]) => console.warn("[renderer]", ...args));
  ipcMain.on("renderer:error", (_e, ...args: unknown[]) => console.error("[renderer]", ...args));

  // Agents
  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:create", (_e, name: string) => createAgent(name));
  ipcMain.handle("agents:delete", (_e, name: string) => deleteAgent(name));
  ipcMain.handle("agents:config", (_e, name: string) => loadAgentConfig(name));
  ipcMain.handle("agents:config:write", (_e, name: string, cfg: unknown) => writeAgentConfig(name, cfg as any));

  // Config
  ipcMain.handle("config:read", () => readGlobalConfig());
  ipcMain.handle("config:write", (_e, cfg: unknown) => writeGlobalConfig(cfg as any));

  // Soul
  ipcMain.handle("soul:read", (_e, name: string) => readSoul(name));
  ipcMain.handle("soul:write", (_e, name: string, content: string) => writeSoul(name, content));

  // Skills & Tools
  ipcMain.handle("skills:list", () => listSkills());
  ipcMain.handle("tools:list", async () => {
    // `listTools` returns full contracts including the `run` function, which
    // cannot be sent over Electron IPC (structured cloning fails).  Only
    // return the serializable metadata that the renderer actually needs.
    const tools = await listTools();
    return tools.map(({ name, version, contributor, description }) => ({
      name,
      version,
      contributor,
      description,
    }));
  });

  // Providers
  ipcMain.handle("providers:list", () =>
    listProviders().map((p) => ({ id: p.id })),
  );

  ipcMain.handle("providers:listModels", async (_e, providerId?: string) => {
    const all = await listAllModels();
    if (!providerId) return all;
    return all.filter((m) => m.provider === providerId);
  });

  // ── Background Run Tracker ──────────────────────────────────────────
  // Keeps running tasks alive even when the renderer navigates away from
  // the agent detail page.  The renderer can poll for status.
  const activeRuns = new Map<string, {
    agentName: string;
    sessionId: string;
    status: "running" | "done" | "error";
    result?: any;
    error?: string;
    startedAt: number;
  }>();

  // Run
  ipcMain.handle("run:autonomous", async (_e, name: string, task: string, opts?: { provider?: string; model?: string; temperature?: number; maxTokens?: number; sessionId?: string; chatHistory?: Array<{ role: "user" | "assistant"; content: string }> }) => {
    console.log(`[IPC] run:autonomous — agent="${name}" task="${task.slice(0, 80)}" opts=${JSON.stringify({ ...opts, chatHistory: opts?.chatHistory ? `[${opts.chatHistory.length} msgs]` : undefined })}`);
    const sessionId = opts?.sessionId || "";
    const runId = `${name}:${sessionId || Date.now()}`;

    activeRuns.set(runId, {
      agentName: name,
      sessionId,
      status: "running",
      startedAt: Date.now(),
    });

    try {
      const result = await runAutonomousTask(name, task, opts || {});
      activeRuns.set(runId, {
        agentName: name,
        sessionId,
        status: "done",
        result,
        startedAt: activeRuns.get(runId)?.startedAt || Date.now(),
      });
      // Notify renderer that a run completed (useful if user navigated away)
      // include the full result so the UI can record the output when it isn't
      // currently visible.
      try { mainWindow?.webContents.send("run:completed", { runId, agentName: name, sessionId, result }); } catch {}
      return result;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      activeRuns.set(runId, {
        agentName: name,
        sessionId,
        status: "error",
        error: msg,
        startedAt: activeRuns.get(runId)?.startedAt || Date.now(),
      });
      try { mainWindow?.webContents.send("run:completed", { runId, agentName: name, sessionId, error: msg }); } catch {}
      throw err;
    }
  });

  // Check if any run is active for a given agent
  ipcMain.handle("run:status", (_e, agentName: string) => {
    const runs: any[] = [];
    for (const [runId, info] of activeRuns) {
      if (info.agentName === agentName) {
        runs.push({ runId, ...info });
      }
    }
    return runs;
  });

  // Clear completed runs from tracker
  ipcMain.handle("run:clear", (_e, runId: string) => {
    activeRuns.delete(runId);
  });

  // ── Chat Sessions ─────────────────────────────────────────────────────
  ipcMain.handle("chats:list", (_e, agentName: string) =>
    listChatSessions(agentName),
  );
  ipcMain.handle("chats:load", (_e, agentName: string, sessionId: string) =>
    loadChatSession(agentName, sessionId),
  );
  ipcMain.handle("chats:save", (_e, session: ChatSession) =>
    saveChatSession(session),
  );
  ipcMain.handle("chats:delete", (_e, agentName: string, sessionId: string) =>
    deleteChatSession(agentName, sessionId),
  );
  ipcMain.handle("chats:deleteAll", (_e, agentName: string) =>
    deleteAllChatSessions(agentName),
  );

  // Marketplace
  ipcMain.handle("marketplace:sync", async () => {
    console.log("[IPC] marketplace:sync — starting");
    try {
      const results = await syncAllMarketplaces();
      console.log("[IPC] marketplace:sync — done:", JSON.stringify(results));
      return results;
    } catch (err) {
      console.error("[IPC] marketplace:sync — ERROR:", err);
      throw err;
    }
  });
  ipcMain.handle("marketplace:browse", async (_e, opts?: { category?: string; search?: string }) => {
    console.log("[IPC] marketplace:browse — opts:", opts);
    try {
      const items = await browseMarketplace(opts);
      console.log(`[IPC] marketplace:browse — returned ${items.length} item(s)`);
      return items;
    } catch (err) {
      console.error("[IPC] marketplace:browse — ERROR:", err);
      throw err;
    }
  });
  ipcMain.handle("marketplace:categories", async () => {
    console.log("[IPC] marketplace:categories — called");
    try {
      const cats = await listMarketplaceCategories();
      console.log("[IPC] marketplace:categories — result:", cats);
      return cats;
    } catch (err) {
      console.error("[IPC] marketplace:categories — ERROR:", err);
      throw err;
    }
  });
  ipcMain.handle("marketplace:install", async (_e, item: { category: string; contributor: string; name: string; localPath: string }) => {
    console.log("[IPC] marketplace:install —", item);
    try {
      const res = await installMarketplaceItem(item);
      console.log("[IPC] marketplace:install — result:", res);
      return res;
    } catch (err) {
      console.error("[IPC] marketplace:install — ERROR:", err);
      throw err;
    }
  });
  ipcMain.handle("marketplace:uninstall", async (_e, item: { category: string; contributor: string; name: string }) => {
    console.log("[IPC] marketplace:uninstall —", item);
    try {
      const res = await uninstallMarketplaceItem(item);
      console.log("[IPC] marketplace:uninstall — result:", res);
      return res;
    } catch (err) {
      console.error("[IPC] marketplace:uninstall — ERROR:", err);
      throw err;
    }
  });
  ipcMain.handle("marketplace:config:read", async () => {
    console.log("[IPC] marketplace:config:read — called");
    try {
      const cfg = await readMarketplaceConfig();
      console.log("[IPC] marketplace:config:read — sources:", cfg.sources.map(s => `${s.name} (${s.enabled ? "enabled" : "disabled"})${s.url ? " " + s.url : ""}`));
      return cfg;
    } catch (err) {
      console.error("[IPC] marketplace:config:read — ERROR:", err);
      throw err;
    }
  });
  ipcMain.handle("marketplace:config:write", (_e, cfg: unknown) => writeMarketplaceConfig(cfg as any));
  ipcMain.handle("marketplace:source:add", (_e, source: { name: string; url: string; branch?: string; enabled: boolean }) =>
    addMarketplaceSource(source),
  );
  ipcMain.handle("marketplace:source:remove", (_e, name: string) => removeMarketplaceSource(name));
  ipcMain.handle("marketplace:source:toggle", (_e, name: string, enabled: boolean) =>
    toggleMarketplaceSource(name, enabled),
  );
}

// ── App lifecycle ──────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Always ensure ~/.solix directory tree exists before anything else.
  try {
    await ensureSolixDirs();
    console.log("[SolixAI] ~/.solix dirs ready at:", join(homedir(), ".solix"));
  } catch (err) {
    // Fallback: create dirs directly without core dependency
    console.error("[SolixAI] ensureSolixDirs from core failed, using fallback:", err);
    try {
      const base = join(homedir(), ".solix");
      for (const sub of ["", "agents", "skills", "tools", "triggers"]) {
        await mkdir(join(base, sub), { recursive: true });
      }
      console.log("[SolixAI] ~/.solix dirs created via fallback at:", join(homedir(), ".solix"));
    } catch (fallbackErr) {
      console.error("[SolixAI] fallback dir creation also failed:", fallbackErr);
    }
  }
  registerIpc();
  createWindow();

  // Notify renderer when user providers finish loading so UI can refresh lists
  try {
    whenUserProvidersLoaded().then(() => {
      try {
        mainWindow?.webContents.send("providers:changed");
      } catch (err) {
        console.error("failed to send providers:changed:", err);
      }
    }).catch((err) => {
      console.error("whenUserProvidersLoaded error:", err);
    });
  } catch (err) {
    console.error("whenUserProvidersLoaded hook setup failed:", err);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
