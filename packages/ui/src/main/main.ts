import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { fork } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  listChannels,
  listProviders,
  listAllModels,
  whenUserProvidersLoaded,
  callProvider,
  runAutonomousTask,
  ensureNyteShiftDirs,
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
  // Triggers
  listAllTriggers,
  readAgentTriggers,
  createTriggerDefinition,
  updateTriggerDefinition,
  deleteTriggerDefinition,
  getTriggerEngine,
  listPersistedGraphRuns,
  listPersistedTriggerRuns,
  prunePersistedRuns,
  // Skill / Tool Config
  readSkillToolConfig,
  writeSkillToolConfig,
  // Secret Store
  getSecret,
  setSecret,
  deleteSecret,
  listSecretKeys,
  // Memory
  writeMemory,
  readMemory,
  listMemories,
  deleteMemory,
  clearAllMemories,
  searchMemories,
  // Agent Graph
  listGraphs,
  loadGraph,
  saveGraph,
  deleteGraph,
  validateGraph,
  runGraphTracked,
  resumePausedRun,
  graphRunRegistry,
  // Graph marketplace
  fetchMarketplaceGraphDef,
  installMarketplaceGraph,
  checkGraphDeps,
} from "@nyteshift/core";
import type { ChatSession, TriggerType } from "@nyteshift/core";

// On Windows, set an AppUserModelId so the taskbar and notifications
// correctly associate with our app and its icon.
if (process.platform === "win32") {
  try {
    app.setAppUserModelId("com.nyteshift.app");
  } catch (err) {
    console.warn("app.setAppUserModelId failed:", err);
  }
}

let mainWindow: BrowserWindow | null = null;

/**
 * True only while the renderer frame is fully loaded and able to receive IPC.
 * Flips to false during navigation/reload (will-navigate) and back to
 * true when the DOM is ready (dom-ready).  This prevents the "Render frame
 * was disposed before WebFrameMain could be accessed" Electron error that
 * occurs when background events (registry, trigger engine) fire mid-reload.
 */
let rendererFrameReady = false;

/**
 * Send an IPC message to the renderer only when the window, its webContents,
 * and the render frame are all alive and ready.
 */
function safeSend(channel: string, ...args: unknown[]): void {
  if (!rendererFrameReady) {
    if (process.env.NYTESHIFT_DEBUG_IPC === "true") {
      console.warn(`[IPC] dropping "${channel}" — rendererFrameReady=false`);
    }
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (process.env.NYTESHIFT_DEBUG_IPC === "true") {
      console.warn(`[IPC] dropping "${channel}" — mainWindow destroyed`);
    }
    return;
  }
  const wc = mainWindow.webContents;
  if (!wc || wc.isDestroyed()) {
    if (process.env.NYTESHIFT_DEBUG_IPC === "true") {
      console.warn(`[IPC] dropping "${channel}" — webContents destroyed`);
    }
    return;
  }
  try {
    wc.send(channel, ...args);
  } catch (err) {
    console.warn(`[IPC] safeSend "${channel}" failed:`, (err as Error).message);
  }
}

function createWindow(): void {
  // prefer preload.js when available (build now outputs .js)
  let preloadPath = join(__dirname, "../preload/preload.js");
  if (!require("fs").existsSync(preloadPath)) {
    preloadPath = join(__dirname, "../preload/preload.mjs");
  }
  console.log("[main] __dirname=", __dirname);
  console.log("[main] preload path=", preloadPath);
  // Prefer a Windows `.ico` when present; fall back to the PNG for other
  // platforms or when the .ico is not available.
  const rendererRoot = join(__dirname, "../renderer");
  let iconFile = join(rendererRoot, "nyteshift_logo.png");
  if (process.platform === "win32") {
    const icoCandidate = join(rendererRoot, "nyteshift_logo.ico");
    try { if (existsSync(icoCandidate)) iconFile = icoCandidate; } catch {}
  }

  // Debug: log which icon file we will attempt to use (helps diagnose path
  // and packaging issues on Windows).
  try {
    console.log("[main] resolved iconFile=", iconFile, "exists=", existsSync(iconFile));
  } catch (err) {
    console.warn("[main] icon existence check failed:", err);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "NyteShift",
    icon: iconFile,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Automatically open devtools for easier debugging when running in
  // development mode.  They can be disabled by setting the
  // `NYTESHIFT_DEVTOOLS=false` environment variable (useful for CI or when the
  // console is distracting).
  if (process.env.ELECTRON_RENDERER_URL && process.env.NYTESHIFT_DEVTOOLS !== "false") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Track render-frame readiness so safeSend never fires into a disposed frame.
  // will-navigate fires only on real document navigations/reloads (NOT on SPA
  // client-side routing or subresource loads).  did-start-loading was the
  // previous choice but it fires for favicon/font/image fetches too, causing
  // rendererFrameReady to flip false mid-run and drop all live IPC events.
  mainWindow.webContents.on("will-navigate", () => { rendererFrameReady = false; });
  mainWindow.webContents.on("dom-ready", () => { rendererFrameReady = true; });
  // Belt-and-suspenders: did-finish-load fires after dom-ready and ensures the
  // flag is true even if dom-ready races with a brief sub-navigation.
  mainWindow.webContents.on("did-finish-load", () => { rendererFrameReady = true; });
  mainWindow.on("closed", () => {
    rendererFrameReady = false;
    mainWindow = null;
  });

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
  ipcMain.handle("skills:list", async () => {
    const skills = await listSkills();
    return skills.map((s) => ({
      frontmatter: {
        name: s.frontmatter.name,
        contributor: s.frontmatter.contributor,
        description: s.frontmatter.description,
        config: s.frontmatter.config ?? undefined,
        version: (s.frontmatter as any).version,
      },
      autoUpdate: (s as any).autoUpdate,
    }));
  });
  ipcMain.handle("skills:get", async (_e, qualifiedName: string) => {
    try {
      // Try to call a direct getSkill export if present; otherwise fall back to listSkills
      let s: any | undefined = undefined;
      try {
        const core = await import("@nyteshift/core");
        if (typeof (core as any).getSkill === "function") {
          s = await (core as any).getSkill(qualifiedName);
        }
      } catch (e) {
        // ignore — fallback below
      }

      if (!s) {
        // Fall back to listSkills (already exported) and find the matching entry
        try {
          const all = await listSkills();
          s = (all || []).find((sk: any) => `${sk.frontmatter.contributor}/${sk.frontmatter.name}` === qualifiedName);
        } catch (e) {
          // nothing
        }
      }

      if (!s) return null;
      return {
        frontmatter: {
          name: s.frontmatter.name,
          contributor: s.frontmatter.contributor,
          description: s.frontmatter.description,
          config: s.frontmatter.config ?? undefined,
          version: (s.frontmatter as any).version,
          tags: (s.frontmatter as any).tags ?? undefined,
          schema: (s.frontmatter as any).schema ?? undefined,
        },
        body: s.body,
        autoUpdate: (s as any).autoUpdate,
        hash: (s as any).hash,
      };
    } catch (err) {
      console.error('[IPC] skills:get — ERROR fetching', qualifiedName, err);
      throw err;
    }
  });
  ipcMain.handle("tools:list", async () => {
    // `listTools` returns full contracts including the `run` function, which
    // cannot be sent over Electron IPC (structured cloning fails).  Only
    // return the serializable metadata that the renderer actually needs.
    const tools = await listTools();
    return tools.map((t) => ({
      name: t.name,
      version: t.version,
      contributor: t.contributor,
      description: t.description,
      config: t.config ?? undefined,
      spec: (t as any).spec ?? undefined,
      autoUpdate: (t as any).autoUpdate,
    }));
  });

  // Channels
  ipcMain.handle("channels:list", async () => {
    const channels = await listChannels();
    return channels.map((ch) => ({
      name: ch.name,
      version: ch.version,
      contributor: ch.contributor,
      description: ch.description,
      config: ch.config ?? undefined,
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
  // Controllers for active runs so the UI can request cancellation.
  const runControllers = new Map<string, AbortController>();

  // Direct single-turn chat (bypasses the full ReAct pipeline).
  // Used by the built-in HelperChat assistant so it doesn't get confused
  // by the ReAct system-prompt wrapping.
  ipcMain.handle("chat:complete", async (_e, opts: {
    systemPrompt: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }) => {
    const config = await readGlobalConfig();
    const providerId = opts.provider ?? (config.defaultProvider as string | undefined) ?? "openai";
    const model      = opts.model      ?? (config.defaultModel      as string | undefined) ?? "gpt-4o";
    const allMsgs: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: opts.systemPrompt },
      ...opts.messages,
    ];
    const result = await callProvider(providerId, {
      model,
      messages: allMsgs,
      temperature: opts.temperature ?? 0.7,
      maxTokens:   opts.maxTokens   ?? 2048,
    });
    return { output: result.output };
  });

  // Run
  ipcMain.handle("run:autonomous", async (_e, name: string, task: string, opts?: { provider?: string; model?: string; temperature?: number; maxTokens?: number; maxSteps?: number; sessionId?: string; chatHistory?: Array<{ role: "user" | "assistant"; content: string }> }) => {
    console.log(`[IPC] run:autonomous — agent="${name}" task="${task.slice(0, 80)}" opts=${JSON.stringify({ ...opts, chatHistory: opts?.chatHistory ? `[${opts.chatHistory.length} msgs]` : undefined })}`);
    const sessionId = opts?.sessionId || "";
    const runId = `${name}:${sessionId || Date.now()}`;

    activeRuns.set(runId, {
      agentName: name,
      sessionId,
      status: "running",
      startedAt: Date.now(),
    });

    // Create an AbortController so the renderer can request cancellation.
    const controller = new AbortController();
    runControllers.set(runId, controller);

    try {
      const runOptions = {
        ...(opts || {}),
        signal: controller.signal,
        onStep: (step: any) => {
          safeSend("run:step", { runId, agentName: name, sessionId, step });
        },
      } as any;
      const result = await runAutonomousTask(name, task, runOptions);
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
      safeSend("run:completed", { runId, agentName: name, sessionId, result });
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
      safeSend("run:completed", { runId, agentName: name, sessionId, error: msg });
      throw err;
    } finally {
      runControllers.delete(runId);
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

  // Cancel active runs for an agent/session. Returns number of runs cancelled.
  ipcMain.handle("run:cancel", (_e, agentName: string, sessionId: string) => {
    let cancelled = 0;
    for (const [runId, controller] of runControllers) {
      if (runId.startsWith(`${agentName}:${sessionId}`)) {
        try { controller.abort(); } catch {}
        cancelled++;
      }
    }
    return { cancelled };
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

  // ── Memory ───────────────────────────────────────────────
  // Persistent external memory for agents (read/write from UI and from
  // agent tool calls in the autonomous pipeline).
  ipcMain.handle("memory:write",
    (_e, agentName: string, key: string, value: string, category?: string, note?: string) =>
      writeMemory(agentName, key, value, category, note),
  );
  ipcMain.handle("memory:read",
    (_e, agentName: string, key: string) =>
      readMemory(agentName, key),
  );
  ipcMain.handle("memory:list",
    (_e, agentName: string, category?: string) =>
      listMemories(agentName, category),
  );
  ipcMain.handle("memory:delete",
    (_e, agentName: string, key: string) =>
      deleteMemory(agentName, key),
  );
  ipcMain.handle("memory:clear",
    (_e, agentName: string) =>
      clearAllMemories(agentName),
  );
  ipcMain.handle("memory:search",
    (_e, agentName: string, query: string) =>
      searchMemories(agentName, query),
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
  ipcMain.handle("marketplace:install", async (_e, item: { category: string; contributor: string; name: string; remotePath?: string; localPath?: string; source?: string }) => {
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

  // Updates & auto‑update configuration
  ipcMain.handle("marketplace:checkUpdates", async () => {
    const { autoUpdateInstalledItems } = await import("@nyteshift/core");
    return autoUpdateInstalledItems();
  });

  ipcMain.handle("marketplace:update", async (_e, item?: { category: string; contributor: string; name: string }) => {
    const core = await import("@nyteshift/core");
    if (item) {
      return core.checkAndUpdateItem(item.category, item.contributor, item.name);
    }
    // run full scan
    return (await core.autoUpdateInstalledItems()).map((r: any) => ({
      item: r.item,
      updated: r.updated,
      message: r.message,
    }));
  });

  ipcMain.handle("marketplace:setAutoUpdate", async (_e, item: { category: string; contributor: string; name: string }, enabled: boolean) => {
    const { setItemAutoUpdate } = await import("@nyteshift/core");
    return setItemAutoUpdate(item.category, item.contributor, item.name, enabled);
  });

  ipcMain.handle("marketplace:setGlobalAutoUpdate", async (_e, enabled: boolean) => {
    const { setGlobalAutoUpdate } = await import("@nyteshift/core");
    return setGlobalAutoUpdate(enabled);
  });

  ipcMain.handle("marketplace:installed", async () => {
    const { readInstalledIndex } = await import("@nyteshift/core");
    return readInstalledIndex();
  });

  // ── Triggers ──────────────────────────────────────────────────────────
  ipcMain.handle("triggers:listAll", async () => {
    console.log("[IPC] triggers:listAll — called");
    try {
      const triggers = await listAllTriggers();
      console.log(`[IPC] triggers:listAll — returned ${triggers.length} trigger(s)`);
      return triggers;
    } catch (err) {
      console.error("[IPC] triggers:listAll — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("triggers:listForAgent", async (_e, agentName: string) => {
    console.log(`[IPC] triggers:listForAgent — agent="${agentName}"`);
    try {
      const triggers = await readAgentTriggers(agentName);
      console.log(`[IPC] triggers:listForAgent — returned ${triggers.length} trigger(s)`);
      return triggers;
    } catch (err) {
      console.error("[IPC] triggers:listForAgent — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("triggers:create", async (_e, params: {
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
    discordCommand?: string;
    discordCommandInput?: "none" | "text" | "json";
  }) => {
    console.log("[IPC] triggers:create —", params.name, "→", params.agentName);
    try {
      const trigger = await createTriggerDefinition(params);
      // Hot-reload into engine.
      try {
        const engine = getTriggerEngine();
        if (engine.isRunning) engine.addTrigger(trigger);
      } catch {}
      return trigger;
    } catch (err) {
      console.error("[IPC] triggers:create — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("triggers:update", async (_e, triggerId: string, updates: Record<string, unknown>) => {
    console.log("[IPC] triggers:update —", triggerId);
    try {
      const updated = await updateTriggerDefinition(triggerId, updates as any);
      if (updated) {
        try {
          const engine = getTriggerEngine();
          if (engine.isRunning) {
            engine.removeTrigger(triggerId);
            if (updated.enabled) engine.addTrigger(updated);
          }
        } catch {}
      }
      return updated;
    } catch (err) {
      console.error("[IPC] triggers:update — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("triggers:delete", async (_e, triggerId: string) => {
    console.log("[IPC] triggers:delete —", triggerId);
    try {
      const deleted = await deleteTriggerDefinition(triggerId);
      if (deleted) {
        try {
          const engine = getTriggerEngine();
          if (engine.isRunning) engine.removeTrigger(triggerId);
        } catch {}
      }
      return deleted;
    } catch (err) {
      console.error("[IPC] triggers:delete — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("triggers:fire", async (_e, triggerId: string, payload?: Record<string, unknown>) => {
    console.log("[IPC] triggers:fire —", triggerId);
    try {
      const engine = getTriggerEngine();
      if (!engine.isRunning) await engine.start();
      const run = await engine.fireManual(triggerId, payload ?? {});
      // Engine emits run events; renderer will be notified via engine listeners.
      return run;
    } catch (err) {
      console.error("[IPC] triggers:fire — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("triggers:engine:start", async () => {
    console.log("[IPC] triggers:engine:start");
    try {
      const engine = getTriggerEngine();
      if (!engine.isRunning) await engine.start();
      return { running: true };
    } catch (err) {
      console.error("[IPC] triggers:engine:start — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("triggers:engine:stop", async () => {
    console.log("[IPC] triggers:engine:stop");
    try {
      const engine = getTriggerEngine();
      if (engine.isRunning) await engine.stop();
      return { running: false };
    } catch (err) {
      console.error("[IPC] triggers:engine:stop — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("triggers:engine:status", () => {
    try {
      const engine = getTriggerEngine();
      return { running: engine.isRunning };
    } catch {
      return { running: false };
    }
  });

  ipcMain.handle("triggers:runs", async (_e, filter?: { agentName?: string; triggerId?: string }) => {
    try {
      const engine = getTriggerEngine();
      const runs = engine.getRuns(filter);
      // Strip large result bodies for IPC serialisation safety.
      return runs.map((r) => ({
        ...r,
        result: r.result ? {
          finalOutput: (r.result as any).finalOutput,
          aborted: (r.result as any).aborted,
          steps: (r.result as any).steps?.length ?? 0,
        } : undefined,
      }));
    } catch {
      return [];
    }
  });

  // ── Discord Bridge IPC ──────────────────────────────────────────────

  ipcMain.handle("discord:bridge:start", async (_e, agentName: string) => {
    console.log("[IPC] discord:bridge:start —", agentName);
    try {
      const { startBridge } = await import("@nyteshift/core");
      await startBridge(agentName);
      return { running: true };
    } catch (err) {
      console.error("[IPC] discord:bridge:start — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:bridge:stop", async (_e, agentName: string) => {
    console.log("[IPC] discord:bridge:stop —", agentName);
    try {
      const { stopBridge } = await import("@nyteshift/core");
      await stopBridge(agentName);
      return { running: false };
    } catch (err) {
      console.error("[IPC] discord:bridge:stop — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:bridge:status", async (_e, agentName: string) => {
    try {
      const { isBridgeRunning } = await import("@nyteshift/core");
      return { running: isBridgeRunning(agentName) };
    } catch {
      return { running: false };
    }
  });

  ipcMain.handle("discord:bridge:config:read", async (_e, agentName: string) => {
    try {
      const { readBridgeConfig } = await import("@nyteshift/core");
      return await readBridgeConfig(agentName);
    } catch {
      return null;
    }
  });

  ipcMain.handle("discord:bridge:config:write", async (_e, agentName: string, config: any) => {
    try {
      const { writeBridgeConfig } = await import("@nyteshift/core");
      await writeBridgeConfig(agentName, config);
    } catch (err) {
      console.error("[IPC] discord:bridge:config:write — ERROR:", err);
      throw err;
    }
  });

  // ── Global Discord Bridge IPC ───────────────────────────────────────

  ipcMain.handle("discord:global:start", async () => {
    console.log("[IPC] discord:global:start");
    try {
      const { startGlobalBridge } = await import("@nyteshift/core");
      await startGlobalBridge();
      return { running: true };
    } catch (err) {
      console.error("[IPC] discord:global:start — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:global:stop", async () => {
    console.log("[IPC] discord:global:stop");
    try {
      const { stopGlobalBridge } = await import("@nyteshift/core");
      await stopGlobalBridge();
      return { running: false };
    } catch (err) {
      console.error("[IPC] discord:global:stop — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:global:status", async () => {
    try {
      const { isGlobalBridgeRunning } = await import("@nyteshift/core");
      return { running: isGlobalBridgeRunning() };
    } catch {
      return { running: false };
    }
  });

  ipcMain.handle("discord:global:config:read", async () => {
    try {
      const { readGlobalDiscordConfig } = await import("@nyteshift/core");
      return await readGlobalDiscordConfig();
    } catch {
      return null;
    }
  });

  ipcMain.handle("discord:global:config:write", async (_e, config: any) => {
    try {
      const { writeGlobalDiscordConfig } = await import("@nyteshift/core");
      await writeGlobalDiscordConfig(config);
    } catch (err) {
      console.error("[IPC] discord:global:config:write — ERROR:", err);
      throw err;
    }
  });

  // Forwarded send/fetch/resolve helpers so out-of-process tools can
  // route messages through the running bridges.
  ipcMain.handle("discord:bridge:send", async (_e, agentName: string, opts: { channelId?: string; channelName?: string; content?: string; replyToId?: string; guildId?: string }) => {
    console.log("[IPC] discord:bridge:send —", agentName, opts.channelId ?? opts.channelName ?? "(no channel)");
    try {
      const core = await import("@nyteshift/core");
      const { getActiveBridges, isBridgeRunning, startBridge } = core as any;

      let bridge: any = null;
      for (const b of getActiveBridges().values()) {
        if (b.agentName === agentName) { bridge = b; break; }
      }
      if (!bridge) {
        if (isBridgeRunning(agentName)) {
          // try to find again
          for (const b of getActiveBridges().values()) {
            if (b.agentName === agentName) { bridge = b; break; }
          }
        }
      }
      if (!bridge) {
        // attempt to start the bridge if it isn't running (best-effort)
        bridge = await startBridge(agentName);
      }

      const client = bridge?.client;
      if (!client) throw new Error("Discord client not available on bridge");

      let channel: any = null;
      if (opts.channelId) {
        channel = await client.channels.fetch(opts.channelId).catch(() => null);
      }
      if (!channel && opts.channelName) {
        // prefer bridge-level resolver if present
        if (typeof bridge.resolveChannelByName === "function") {
          try {
            const id = await bridge.resolveChannelByName(opts.channelName);
            if (id) channel = await client.channels.fetch(id).catch(() => null);
          } catch {}
        }
        // fallback: search guild channels
        if (!channel) {
          const guild = opts.guildId ? client.guilds.cache.get(opts.guildId) : client.guilds.cache.values().next().value;
          if (guild) {
            try {
              const chans = await guild.channels.fetch();
              channel = chans.find((c: any) => c.name === opts.channelName) as any;
            } catch {}
          }
        }
      }

      if (!channel) throw new Error("Discord channel not found");

      const sendOpts: any = {};
      if (opts.replyToId) sendOpts.reply = { messageReference: opts.replyToId };
      const res = await channel.send({ content: opts.content ?? "", ...sendOpts });
      return { ok: true, id: res.id };
    } catch (err) {
      console.error("[IPC] discord:bridge:send — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:bridge:fetch", async (_e, agentName: string, opts: { channelId?: string; limit?: number }) => {
    console.log("[IPC] discord:bridge:fetch —", agentName, opts.channelId);
    try {
      const core = await import("@nyteshift/core");
      const { getActiveBridges } = core as any;
      let bridge: any = null;
      for (const b of getActiveBridges().values()) {
        if (b.agentName === agentName) { bridge = b; break; }
      }
      if (!bridge) throw new Error("Bridge not running for agent");
      const client = bridge?.client;
      if (!client) throw new Error("Discord client not available on bridge");
      if (!opts.channelId) throw new Error("channelId required");
      const channel = await client.channels.fetch(opts.channelId);
      const messages = await channel.messages.fetch({ limit: opts.limit ?? 50 });
      const out = Array.from(messages.values()).map((m: any) => ({ id: m.id, author: m.author?.username, content: m.content, createdAt: m.createdAt }));
      return out;
    } catch (err) {
      console.error("[IPC] discord:bridge:fetch — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:bridge:resolveChannel", async (_e, agentName: string, name: string) => {
    console.log("[IPC] discord:bridge:resolveChannel —", agentName, name);
    try {
      const core = await import("@nyteshift/core");
      const { getActiveBridges } = core as any;
      let bridge: any = null;
      for (const b of getActiveBridges().values()) {
        if (b.agentName === agentName) { bridge = b; break; }
      }
      if (!bridge) throw new Error("Bridge not running for agent");
      if (typeof bridge.resolveChannelByName === "function") return await bridge.resolveChannelByName(name);
      // fallback to client search
      const client = bridge.client;
      if (!client) throw new Error("Discord client not available on bridge");
      for (const g of client.guilds.cache.values()) {
        try {
          const chans = await g.channels.fetch();
          const found = chans.find((c: any) => c.name === name);
          if (found) return found.id;
        } catch {}
      }
      return null;
    } catch (err) {
      console.error("[IPC] discord:bridge:resolveChannel — ERROR:", err);
      throw err;
    }
  });

  // Global bridge variants
  ipcMain.handle("discord:global:send", async (_e, opts: { channelId?: string; channelName?: string; content?: string; replyToId?: string; guildId?: string }) => {
    console.log("[IPC] discord:global:send —", opts.channelId ?? opts.channelName ?? "(no channel)");
    try {
      const core = await import("@nyteshift/core");
      const { getGlobalBridge, startGlobalBridge } = core as any;
      let bridge = getGlobalBridge();
      if (!bridge) bridge = await startGlobalBridge();
      const client = bridge.client;
      if (!client) throw new Error("Discord client not available on global bridge");
      let channel: any = null;
      if (opts.channelId) channel = await client.channels.fetch(opts.channelId).catch(() => null);
      if (!channel && opts.channelName) {
        if (typeof bridge.resolveChannelByName === "function") {
          const id = await bridge.resolveChannelByName(opts.channelName);
          if (id) channel = await client.channels.fetch(id).catch(() => null);
        }
        if (!channel) {
          const guild = opts.guildId ? client.guilds.cache.get(opts.guildId) : client.guilds.cache.values().next().value;
          if (guild) {
            try {
              const chans = await guild.channels.fetch();
              channel = chans.find((c: any) => c.name === opts.channelName) as any;
            } catch {}
          }
        }
      }
      if (!channel) throw new Error("Discord channel not found");
      const sendOpts: any = {};
      if (opts.replyToId) sendOpts.reply = { messageReference: opts.replyToId };
      const res = await channel.send({ content: opts.content ?? "", ...sendOpts });
      return { ok: true, id: res.id };
    } catch (err) {
      console.error("[IPC] discord:global:send — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:global:fetch", async (_e, opts: { channelId: string; limit?: number }) => {
    console.log("[IPC] discord:global:fetch —", opts.channelId);
    try {
      const core = await import("@nyteshift/core");
      const { getGlobalBridge } = core as any;
      const bridge = getGlobalBridge();
      if (!bridge) throw new Error("Global bridge not running");
      const client = bridge.client;
      if (!client) throw new Error("Discord client not available on global bridge");
      const channel = await client.channels.fetch(opts.channelId);
      const messages = await channel.messages.fetch({ limit: opts.limit ?? 50 });
      const out = Array.from(messages.values()).map((m: any) => ({ id: m.id, author: m.author?.username, content: m.content, createdAt: m.createdAt }));
      return out;
    } catch (err) {
      console.error("[IPC] discord:global:fetch — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:global:resolveChannel", async (_e, name: string) => {
    console.log("[IPC] discord:global:resolveChannel —", name);
    try {
      const core = await import("@nyteshift/core");
      const { getGlobalBridge } = core as any;
      const bridge = getGlobalBridge();
      if (!bridge) throw new Error("Global bridge not running");
      if (typeof bridge.resolveChannelByName === "function") return await bridge.resolveChannelByName(name);
      const client = bridge.client;
      if (!client) throw new Error("Discord client not available on global bridge");
      for (const g of client.guilds.cache.values()) {
        try {
          const chans = await g.channels.fetch();
          const found = chans.find((c: any) => c.name === name);
          if (found) return found.id;
        } catch {}
      }
      return null;
    } catch (err) {
      console.error("[IPC] discord:global:resolveChannel — ERROR:", err);
      throw err;
    }
  });

  // ── Skill / Tool Config ─────────────────────────────────────────────

  ipcMain.handle("skillToolConfig:read", async (
    _e,
    kind: "skill" | "tool" | "channel",
    qualifiedName: string,
    agentName?: string,
  ) => {
    console.log(`[IPC] skillToolConfig:read — ${kind} "${qualifiedName}" agent=${agentName ?? "global"}`);
    return readSkillToolConfig(kind, qualifiedName, agentName);
  });

  ipcMain.handle("skillToolConfig:write", async (
    _e,
    kind: "skill" | "tool" | "channel",
    qualifiedName: string,
    values: Record<string, unknown>,
    agentName?: string,
  ) => {
    console.log(`[IPC] skillToolConfig:write — ${kind} "${qualifiedName}" agent=${agentName ?? "global"}`);
    await writeSkillToolConfig(kind, qualifiedName, values, agentName);
  });

  // ── Secret Store ─────────────────────────────────────────────────────

  ipcMain.handle("secret:get", async (_e, name: string) => {
    return getSecret(name);
  });

  ipcMain.handle("secret:set", async (_e, name: string, value: string) => {
    await setSecret(name, value);
  });

  ipcMain.handle("secret:delete", async (_e, name: string) => {
    await deleteSecret(name);
  });

  ipcMain.handle("secret:list", async () => {
    return listSecretKeys();
  });

  // ── Tool config actions (run in a forked child process so the main thread is never blocked) ──
  ipcMain.handle("tool:configAction", (_e, qualifiedName: string, key: string) => {
    console.log(`[IPC] tool:configAction — tool="${qualifiedName}" key="${key}" (forking child)`);
    return new Promise<unknown>((resolve, reject) => {
      const runnerPath = join(__dirname, "toolActionRunner.js");
      const child = fork(runnerPath, [], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });

      // pipe child stdout / stderr to main console so tool authors can log freely
      child.stdout?.on("data", (b: Buffer) => process.stdout.write(b));
      child.stderr?.on("data", (b: Buffer) => process.stderr.write(b));

      child.on("message", (msg: { ok: boolean; result?: unknown; error?: string }) => {
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error ?? "configAction failed"));
      });

      child.on("error", (err) => reject(err));

      child.on("exit", (code, signal) => {
        // if the child exited without ever sending a message, surface that
        if (code !== 0 && code !== null) {
          reject(new Error(`toolAction child exited with code ${code} (${signal ?? "no signal"})`));
        }
      });

      // kick off the action
      child.send({ qualifiedName, key });
    });
  });

  // ── Agent Graph IPC ────────────────────────────────────────────────────

  // Controllers for graph runs so the UI can request cancellation.
  const graphRunControllers = new Map<string, AbortController>();

  // Forward graphRunRegistry events to the renderer so live progress works
  // for ALL graph runs (manual, trigger-engine, trigger-node) uniformly.
  graphRunRegistry.on("registered", (record: import("@nyteshift/core").GraphRunRecord) => {
    safeSend("graph:runRegistered", {
      runId: record.runId,
      graphId: record.graphId,
      graphName: record.graphName,
      status: record.status,
      source: record.source,
      startedAt: record.startedAt,
    });
  });
  graphRunRegistry.on("node:start", (data: { runId: string; nodeId: string; nodeName: string; nodeType?: string }) => {
    safeSend("graph:nodeStart", data);
  });
  graphRunRegistry.on("node:complete", (data: { runId: string; nodeOutput: unknown }) => {
    safeSend("graph:nodeComplete", data);
  });
  graphRunRegistry.on("run:complete", (data: { runId: string; result?: unknown; error?: string }) => {
    safeSend("graph:runComplete", data);
    graphRunControllers.delete(data.runId);
  });

  ipcMain.handle("graph:list", () => listGraphs());
  ipcMain.handle("graph:load", (_e, id: string) => loadGraph(id));
  ipcMain.handle("graph:save", (_e, graph: unknown) => saveGraph(graph as any));
  ipcMain.handle("graph:delete", (_e, id: string) => deleteGraph(id));
  ipcMain.handle("graph:validate", (_e, graph: unknown) => {
    const errors = validateGraph(graph as any);
    return { valid: errors.length === 0, errors };
  });

  ipcMain.handle("graph:run", async (_e, graphOrId: unknown, opts?: unknown) => {
    const optsObj = (opts as Record<string, unknown>) ?? {};
    // Accept a caller-supplied runId so the renderer can set its event-filter
    // ref BEFORE the IPC round-trip, eliminating the race condition where early
    // node:start/node:complete events arrive before the invoke promise resolves.
    const providedId = typeof optsObj.runId === "string" ? optsObj.runId : "";
    const runId = /^[\w:.-]{1,200}$/.test(providedId) ? providedId : `graph:${randomUUID()}`;

    const controller = new AbortController();
    graphRunControllers.set(runId, controller);
    // Strip runId from the options before forwarding to the graph runner.
    const { runId: _r, ...restOpts } = optsObj;
    const options = { ...restOpts, signal: controller.signal };

    // Start on the next tick so the IPC reply is sent first (belt-and-suspenders
    // alongside the pre-generated runId approach in the renderer).
    setImmediate(() => {
      void runGraphTracked(graphOrId as any, options as any, { source: "manual" }, runId).catch(() => {});
    });

    return { runId };
  });

  // List all tracked runs (registry is the single source-of-truth).
  ipcMain.handle("graph:runs", () => {
    return graphRunRegistry.list().map((r) => ({
      runId: r.runId,
      graphId: r.graphId,
      graphName: r.graphName,
      status: r.status === "done" ? "done" : r.status === "error" ? "error" : r.status === "paused" ? "paused" : "running",
      result: r.result,
      error: r.error,
      nodeProgress: r.nodeProgress,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      source: r.source,
      triggerId: r.triggerId,
      triggerName: r.triggerName,
      triggerType: r.triggerType,
      pausedResumeFrom: r.pausedResumeFrom,
    }));
  });

  // List runs for a specific graph ID.
  ipcMain.handle("graph:runs:forGraph", (_e, graphId: string) => {
    return graphRunRegistry.list({ graphId }).map((r) => ({
      runId: r.runId,
      graphId: r.graphId,
      graphName: r.graphName,
      status: r.status === "done" ? "done" : r.status === "error" ? "error" : r.status === "paused" ? "paused" : "running",
      result: r.result,
      error: r.error,
      nodeProgress: r.nodeProgress,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      source: r.source,
      triggerId: r.triggerId,
      triggerName: r.triggerName,
      triggerType: r.triggerType,
      pausedResumeFrom: r.pausedResumeFrom,
    }));
  });

  ipcMain.handle("graph:run:status", (_e, runId: string) => {
    const r = graphRunRegistry.getRun(runId);
    if (!r) return null;
    return {
      runId: r.runId,
      graphId: r.graphId,
      status: r.status === "done" ? "done" : r.status === "error" ? "error" : r.status === "paused" ? "paused" : "running",
      result: r.result,
      error: r.error,
      nodeProgress: r.nodeProgress,
      startedAt: r.startedAt,
      source: r.source,
      triggerId: r.triggerId,
      triggerName: r.triggerName,
    };
  });

  ipcMain.handle("graph:run:cancel", (_e, runId: string) => {
    // Abort via the main-managed controller (manual runs started via graph:run).
    try { graphRunControllers.get(runId)?.abort(); } catch {}
    graphRunControllers.delete(runId);
    // Also abort via the registry — covers trigger-engine and trigger-node runs
    // so Stop works for any run visible in the graph view, regardless of origin.
    graphRunRegistry.abort(runId);
  });

  ipcMain.handle("graph:run:stop", (_e, runId: string) => {
    // Graceful stop: request the runner exit the current loop at its next safe
    // boundary so matching catch nodes (trigger="abort") still fire.
    graphRunRegistry.requestStop(runId);
  });

  ipcMain.handle("graph:run:resume", async (_e, runId: string) => {
    const controller = new AbortController();
    setImmediate(() => {
      void resumePausedRun(runId, { signal: controller.signal }).then(({ runId: newId }) => {
        graphRunControllers.set(newId, controller);
      }).catch(() => {});
    });
    // Derive the new runId synchronously so the renderer gets it back immediately.
    // The actual execution starts on the next tick (setImmediate above).
    // We generate the same ID that resumePausedRun will use via the registry.
    // Since we can't predict the UUID, we return the paused run ID and let the
    // renderer listen for graph:runRegistered to pick up the new child run.
    return { runId };
  });

  // ── Graph Marketplace Helpers ──────────────────────────────────────────────

  /**
   * Fetch the graph.json for a marketplace graph item and return its parsed
   * GraphDefinition so the UI can inspect dependencies before installing.
   */
  ipcMain.handle(
    "marketplace:fetchGraphDef",
    async (_e, item: { remotePath: string; source?: string }) => {
      return fetchMarketplaceGraphDef(item);
    },
  );

  /**
   * Check whether all tool / skill / agent dependencies of a graph are
   * currently installed.  Returns a GraphDepsResult object.
   */
  ipcMain.handle("graph:checkDeps", async (_e, graph: unknown) => {
    return checkGraphDeps(graph as any);
  });

  /**
   * Install a graph downloaded from the marketplace by saving it into the
   * normal graph store.  Also registers the item in installed.json so update
   * tracking works just like for skills and tools.
   */
  ipcMain.handle(
    "marketplace:installGraph",
    async (
      _e,
      graph: unknown,
      item: { category: string; contributor: string; name: string; remotePath?: string; source?: string },
    ) => {
      return installMarketplaceGraph(graph as any, item);
    },
  );
}

// ── App lifecycle ──────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Always ensure ~/.nyteshift directory tree exists before anything else.
  try {
    await ensureNyteShiftDirs();
    console.log("[NyteShift] ~/.nyteshift dirs ready at:", join(homedir(), ".nyteshift"));
  } catch (err) {
    // Fallback: create dirs directly without core dependency
    console.error("[NyteShift] ensureNyteShiftDirs from core failed, using fallback:", err);
    try {
      const base = join(homedir(), ".nyteshift");
      for (const sub of ["", "agents", "skills", "tools", "triggers"]) {
        await mkdir(join(base, sub), { recursive: true });
      }
      console.log("[NyteShift] ~/.nyteshift dirs created via fallback at:", join(homedir(), ".nyteshift"));
    } catch (fallbackErr) {
      console.error("[NyteShift] fallback dir creation also failed:", fallbackErr);
    }
  }
    // Prune persisted runs per user config and restore saved runs into memory
    // Then schedule recurring pruning according to `runRetention.pruneSchedule`.
    async function schedulePruneJobs(schedule?: string) {
      // Helpers
      function parseHHMM(s: string): { h: number; m: number } | null {
        const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
        if (!m) return null;
        const h = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (isNaN(h) || isNaN(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
        return { h, m: mm };
      }

      function parseIntervalShorthand(expr: string): number | null {
        const re = /^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i;
        const m = String(expr || "").trim().match(re);
        if (!m) return null;
        const v = parseInt(m[1], 10);
        const u = m[2].toLowerCase();
        const mult: Record<string, number> = { s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, hour: 3600000, d: 86400000, day: 86400000 };
        return (mult[u] ?? null) ? v * mult[u] : null;
      }

      // Minimal cron parser (5-field) copied/adapted from core cronParser
      function parseField(field: string, min: number, max: number): Set<number> {
        const values = new Set<number>();
        for (const part of field.split(",")) {
          const t = part.trim();
          if (t === "*") {
            for (let i = min; i <= max; i++) values.add(i);
          } else if (t.includes("/")) {
            const [rangeStr, stepStr] = t.split("/");
            const step = parseInt(stepStr, 10);
            const start = rangeStr === "*" ? min : parseInt(rangeStr, 10);
            for (let i = start; i <= max; i += step) values.add(i);
          } else if (t.includes("-")) {
            const [s, e] = t.split("-");
            const si = parseInt(s, 10); const ei = parseInt(e, 10);
            for (let i = si; i <= ei; i++) values.add(i);
          } else {
            const val = parseInt(t, 10);
            values.add(val);
          }
        }
        return values;
      }
      function parseCron(expr: string) {
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) throw new Error("Invalid cron");
        return {
          minute: parseField(parts[0], 0, 59),
          hour: parseField(parts[1], 0, 23),
          dayOfMonth: parseField(parts[2], 1, 31),
          month: parseField(parts[3], 1, 12),
          dayOfWeek: parseField(parts[4], 0, 6),
        } as any;
      }
      function matchesCron(fields: any, d: Date) {
        return (
          fields.minute.has(d.getMinutes()) &&
          fields.hour.has(d.getHours()) &&
          fields.dayOfMonth.has(d.getDate()) &&
          fields.month.has(d.getMonth() + 1) &&
          fields.dayOfWeek.has(d.getDay())
        );
      }

      let minuteAlignTimeout: NodeJS.Timeout | null = null;
      let minuteInterval: NodeJS.Timeout | null = null;
      let rawInterval: NodeJS.Timeout | null = null;

      function clearTimers() {
        if (minuteAlignTimeout) { clearTimeout(minuteAlignTimeout); minuteAlignTimeout = null; }
        if (minuteInterval) { clearInterval(minuteInterval); minuteInterval = null; }
        if (rawInterval) { clearInterval(rawInterval); rawInterval = null; }
      }

      function startMinuteTicker(checkFn: (d: Date) => Promise<void> | void) {
        const align = 60_000 - (Date.now() % 60_000);
        minuteAlignTimeout = setTimeout(() => {
          // run once at the aligned minute boundary
          void checkFn(new Date());
          minuteInterval = setInterval(() => void checkFn(new Date()), 60_000);
        }, align);
      }

      async function checkAndPruneForDaily(hour: number, minute: number) {
        const now = new Date();
        if (now.getHours() === hour && now.getMinutes() === minute) {
          try { await prunePersistedRuns(); } catch (err) { console.warn("[NyteShift] scheduled prune failed:", (err as Error).message ?? err); }
        }
      }

      async function checkAndPruneForWeekly(targetDow: number, hour: number, minute: number) {
        const now = new Date();
        if (now.getDay() === targetDow && now.getHours() === hour && now.getMinutes() === minute) {
          try { await prunePersistedRuns(); } catch (err) { console.warn("[NyteShift] scheduled prune failed:", (err as Error).message ?? err); }
        }
      }

      async function checkAndPruneForMonthly(dayOfMonth: number, hour: number, minute: number) {
        const now = new Date();
        if (now.getDate() === dayOfMonth && now.getHours() === hour && now.getMinutes() === minute) {
          try { await prunePersistedRuns(); } catch (err) { console.warn("[NyteShift] scheduled prune failed:", (err as Error).message ?? err); }
        }
      }

      if (!schedule) schedule = "daily@00:00";
      const s = String(schedule).trim();

      // Interval shorthand like "24h", "7d"
      const intervalMs = parseIntervalShorthand(s);
      if (intervalMs !== null) {
        rawInterval = setInterval(() => { void prunePersistedRuns().catch((err) => console.warn('[NyteShift] scheduled prune failed:', (err as Error).message ?? err)); }, intervalMs);
        console.log(`[NyteShift] scheduled run pruning every ${intervalMs}ms (interval shorthand)`);
        return () => clearTimers();
      }

      // daily@HH:MM
      const dailyMatch = s.match(/^daily(?:@(\d{1,2}:\d{2}))?$/i);
      if (dailyMatch) {
        const time = parseHHMM(dailyMatch[1] ?? "00:00") ?? { h: 0, m: 0 };
        startMinuteTicker((d) => checkAndPruneForDaily(time.h, time.m));
        console.log(`[NyteShift] scheduled daily pruning at ${String(time.h).padStart(2,'0')}:${String(time.m).padStart(2,'0')}`);
        return () => clearTimers();
      }

      // weekly@DAY@HH:MM  (DAY = 0..6 or sun|mon|tue...)
      const weeklyMatch = s.match(/^weekly@([A-Za-z0-9_-]+)(?:@(\d{1,2}:\d{2}))?$/i);
      if (weeklyMatch) {
        const dayRaw = weeklyMatch[1].toLowerCase();
        const dowMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
        let dow = dowMap[dayRaw] ?? Number(dayRaw);
        if (isNaN(dow) || dow < 0 || dow > 6) dow = 1; // default Monday
        const time = parseHHMM(weeklyMatch[2] ?? "00:00") ?? { h: 0, m: 0 };
        startMinuteTicker((d) => checkAndPruneForWeekly(dow, time.h, time.m));
        console.log(`[NyteShift] scheduled weekly pruning on ${dow} at ${String(time.h).padStart(2,'0')}:${String(time.m).padStart(2,'0')}`);
        return () => clearTimers();
      }

      // monthly@DAY@HH:MM  (DAY 1..31)
      const monthlyMatch = s.match(/^monthly@(\d{1,2})(?:@(\d{1,2}:\d{2}))?$/i);
      if (monthlyMatch) {
        const dayNum = Math.max(1, Math.min(31, parseInt(monthlyMatch[1], 10) || 1));
        const time = parseHHMM(monthlyMatch[2] ?? "00:00") ?? { h: 0, m: 0 };
        startMinuteTicker((d) => checkAndPruneForMonthly(dayNum, time.h, time.m));
        console.log(`[NyteShift] scheduled monthly pruning on day ${dayNum} at ${String(time.h).padStart(2,'0')}:${String(time.m).padStart(2,'0')}`);
        return () => clearTimers();
      }

      // Cron expression (5 fields)
      const cronParts = s.split(/\s+/);
      if (cronParts.length === 5) {
        let fields: any;
        try { fields = parseCron(s); } catch (err) { console.warn('[NyteShift] invalid cron for pruneSchedule:', s); return () => clearTimers(); }
        startMinuteTicker(async (d) => { if (matchesCron(fields, d)) { try { await prunePersistedRuns(); } catch (err) { console.warn('[NyteShift] scheduled prune failed:', (err as Error).message ?? err); } } });
        console.log(`[NyteShift] scheduled pruning via cron: ${s}`);
        return () => clearTimers();
      }

      // Fallback: daily at midnight
      startMinuteTicker((d) => checkAndPruneForDaily(0, 0));
      console.log('[NyteShift] scheduled pruning fallback: daily@00:00');
      return () => clearTimers();
    }

    try {
      const cfg = await readGlobalConfig();
      const retention = (cfg as any).runRetention ?? {};
      if (retention.enabled === false) {
        console.log("[NyteShift] runRetention disabled — skipping prune and scheduling");
      } else {
        try {
          await prunePersistedRuns();
        } catch (err) {
          console.warn("[NyteShift] prunePersistedRuns failed:", (err as Error).message ?? err);
        }
      }
    } catch (err) {
      console.warn("[NyteShift] failed to read global config for run retention:", (err as Error).message ?? err);
    }

    try {
      const persistedGraphRuns = await listPersistedGraphRuns();
      if (persistedGraphRuns.length) {
        try { graphRunRegistry.restoreRuns(persistedGraphRuns as any); console.log(`[NyteShift] restored ${persistedGraphRuns.length} graph run(s)`); } catch (err) { console.warn("restore graph runs failed:", err); }
      }
    } catch (err) {
      console.warn("[NyteShift] failed to read persisted graph runs:", (err as Error).message ?? err);
    }

    try {
      const persistedTriggerRuns = await listPersistedTriggerRuns();
      if (persistedTriggerRuns.length) {
        try { const engine = getTriggerEngine(); engine.addPersistedRuns(persistedTriggerRuns as any); console.log(`[NyteShift] restored ${persistedTriggerRuns.length} trigger run(s)`); } catch (err) { console.warn("restore trigger runs failed:", err); }
      }
    } catch (err) {
      console.warn("[NyteShift] failed to read persisted trigger runs:", (err as Error).message ?? err);
    }

    // Schedule recurring pruning according to user config
    try {
      const cfg = await readGlobalConfig();
      const retention = (cfg as any).runRetention ?? {};
      if (retention.enabled !== false) {
        void schedulePruneJobs(retention.pruneSchedule ?? undefined);
      }
    } catch (err) {
      console.warn("[NyteShift] failed to schedule run pruning:", (err as Error).message ?? err);
    }
  registerIpc();
  createWindow();

  // Notify renderer when user providers finish loading so UI can refresh lists
  try {
    whenUserProvidersLoaded().then(() => {
      safeSend("providers:changed");
    }).catch((err) => {
      console.error("whenUserProvidersLoaded error:", err);
    });
  } catch (err) {
    console.error("whenUserProvidersLoaded hook setup failed:", err);
  }

  // Reconcile installed.json with items on disk that pre-date the index
  // tracking system.  Runs silently in the background — never blocks startup.
  import("@nyteshift/core").then(({ reconcileInstalledItems }) => {
    reconcileInstalledItems().catch((err) =>
      console.warn("[NyteShift] installed-index reconciliation failed:", err),
    );
  }).catch(() => {});

  // Auto-start Discord bridges that have enabled: true saved in their config.
  // Deferred via setTimeout so it never blocks window creation or IPC registration.
  setTimeout(() => {
    import("@nyteshift/core").then(async ({ readGlobalDiscordConfig, startGlobalBridge, listAgents: _listAgents, readBridgeConfig, startBridge }) => {
      // Global bridge
      try {
        const globalCfg = await readGlobalDiscordConfig();
        if (globalCfg?.enabled && globalCfg?.botToken) {
          startGlobalBridge().then(() => {
            console.log("[NyteShift] global Discord bridge auto-started");
          }).catch((err: Error) => {
            console.warn("[NyteShift] global Discord bridge auto-start failed:", err.message);
          });
        }
      } catch (err) {
        console.warn("[NyteShift] global Discord bridge config read failed:", (err as Error).message);
      }

      // Per-agent bridges — fire each one independently so a slow/failing
      // agent does not delay the others.
      try {
        const agents = await _listAgents();
        for (const agentName of agents) {
          readBridgeConfig(agentName).then((cfg) => {
            if (cfg?.enabled && cfg?.botToken) {
              startBridge(agentName).then(() => {
                console.log(`[NyteShift] Discord bridge auto-started for agent "${agentName}"`);
              }).catch((err: Error) => {
                console.warn(`[NyteShift] Discord bridge auto-start failed for "${agentName}":`, err.message);
              });
            }
          }).catch((err: Error) => {
            console.warn(`[NyteShift] Discord bridge config read failed for "${agentName}":`, err.message);
          });
        }
      } catch (err) {
        console.warn("[NyteShift] per-agent Discord bridge auto-start failed:", (err as Error).message);
      }
    }).catch(() => {});
  }, 0);

  // Start trigger engine so cron/webhook triggers run in the background.
  try {
    const triggerEngine = getTriggerEngine();
    triggerEngine.on("run:started", (run: any) => { safeSend("triggers:runUpdate", run); });
    triggerEngine.on("run:completed", (run: any) => { safeSend("triggers:runUpdate", run); });
    triggerEngine.on("run:failed", (run: any) => { safeSend("triggers:runUpdate", run); });
    triggerEngine.start().then(() => {
      console.log("[NyteShift] trigger engine started");
    }).catch((err) => {
      console.error("[NyteShift] trigger engine start failed:", err);
    });
  } catch (err) {
    console.error("[NyteShift] trigger engine setup failed:", err);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
