import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { fork } from "node:child_process";
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
  callProvider,
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
  // Triggers
  listAllTriggers,
  readAgentTriggers,
  createTriggerDefinition,
  updateTriggerDefinition,
  deleteTriggerDefinition,
  getTriggerEngine,
  // Skill / Tool Config
  readSkillToolConfig,
  writeSkillToolConfig,
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
  runGraph,
} from "@solix/core";
import type { ChatSession, TriggerType } from "@solix/core";

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
      const runOptions = { ...(opts || {}), signal: controller.signal } as any;
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
    const { autoUpdateInstalledItems } = await import("@solix/core");
    return autoUpdateInstalledItems();
  });

  ipcMain.handle("marketplace:update", async (_e, item?: { category: string; contributor: string; name: string }) => {
    const core = await import("@solix/core");
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
    const { setItemAutoUpdate } = await import("@solix/core");
    return setItemAutoUpdate(item.category, item.contributor, item.name, enabled);
  });

  ipcMain.handle("marketplace:setGlobalAutoUpdate", async (_e, enabled: boolean) => {
    const { setGlobalAutoUpdate } = await import("@solix/core");
    return setGlobalAutoUpdate(enabled);
  });

  ipcMain.handle("marketplace:installed", async () => {
    const { readInstalledIndex } = await import("@solix/core");
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
      // Notify renderer.
      try { mainWindow?.webContents.send("triggers:runUpdate", run); } catch {}
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
        result: r.result ? { finalOutput: r.result.finalOutput, aborted: r.result.aborted, steps: r.result.steps.length } : undefined,
      }));
    } catch {
      return [];
    }
  });

  // ── Discord Bridge IPC ──────────────────────────────────────────────

  ipcMain.handle("discord:bridge:start", async (_e, agentName: string) => {
    console.log("[IPC] discord:bridge:start —", agentName);
    try {
      const { startBridge } = await import("@solix/core");
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
      const { stopBridge } = await import("@solix/core");
      await stopBridge(agentName);
      return { running: false };
    } catch (err) {
      console.error("[IPC] discord:bridge:stop — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:bridge:status", async (_e, agentName: string) => {
    try {
      const { isBridgeRunning } = await import("@solix/core");
      return { running: isBridgeRunning(agentName) };
    } catch {
      return { running: false };
    }
  });

  ipcMain.handle("discord:bridge:config:read", async (_e, agentName: string) => {
    try {
      const { readBridgeConfig } = await import("@solix/core");
      return await readBridgeConfig(agentName);
    } catch {
      return null;
    }
  });

  ipcMain.handle("discord:bridge:config:write", async (_e, agentName: string, config: any) => {
    try {
      const { writeBridgeConfig } = await import("@solix/core");
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
      const { startGlobalBridge } = await import("@solix/core");
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
      const { stopGlobalBridge } = await import("@solix/core");
      await stopGlobalBridge();
      return { running: false };
    } catch (err) {
      console.error("[IPC] discord:global:stop — ERROR:", err);
      throw err;
    }
  });

  ipcMain.handle("discord:global:status", async () => {
    try {
      const { isGlobalBridgeRunning } = await import("@solix/core");
      return { running: isGlobalBridgeRunning() };
    } catch {
      return { running: false };
    }
  });

  ipcMain.handle("discord:global:config:read", async () => {
    try {
      const { readGlobalDiscordConfig } = await import("@solix/core");
      return await readGlobalDiscordConfig();
    } catch {
      return null;
    }
  });

  ipcMain.handle("discord:global:config:write", async (_e, config: any) => {
    try {
      const { writeGlobalDiscordConfig } = await import("@solix/core");
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
      const core = await import("@solix/core");
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
      const core = await import("@solix/core");
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
      const core = await import("@solix/core");
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
      const core = await import("@solix/core");
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
      const core = await import("@solix/core");
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
      const core = await import("@solix/core");
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
    kind: "skill" | "tool",
    qualifiedName: string,
    agentName?: string,
  ) => {
    console.log(`[IPC] skillToolConfig:read — ${kind} "${qualifiedName}" agent=${agentName ?? "global"}`);
    return readSkillToolConfig(kind, qualifiedName, agentName);
  });

  ipcMain.handle("skillToolConfig:write", async (
    _e,
    kind: "skill" | "tool",
    qualifiedName: string,
    values: Record<string, unknown>,
    agentName?: string,
  ) => {
    console.log(`[IPC] skillToolConfig:write — ${kind} "${qualifiedName}" agent=${agentName ?? "global"}`);
    await writeSkillToolConfig(kind, qualifiedName, values, agentName);
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

  // Track running graph executions so we can push per-node events to renderer.
  const activeGraphRuns = new Map<string, {
    status: "running" | "done" | "error";
    result?: unknown;
    error?: string;
    nodeProgress: unknown[];
    /** Optional graph id associated with this run (if known) */
    graphId?: string;
    /** Timestamp (ms) when run was started */
    startedAt?: number;
  }>();
  const graphRunControllers = new Map<string, AbortController>();

  ipcMain.handle("graph:list", () => listGraphs());
  ipcMain.handle("graph:load", (_e, id: string) => loadGraph(id));
  ipcMain.handle("graph:save", (_e, graph: unknown) => saveGraph(graph as any));
  ipcMain.handle("graph:delete", (_e, id: string) => deleteGraph(id));
  ipcMain.handle("graph:validate", (_e, graph: unknown) => {
    const errors = validateGraph(graph as any);
    return { valid: errors.length === 0, errors };
  });

  ipcMain.handle("graph:run", async (_e, graphOrId: unknown, opts?: unknown) => {
    const runId = `graph:${Date.now()}`;
    const controller = new AbortController();
    graphRunControllers.set(runId, controller);
    const startedAt = Date.now();
    const graphId = typeof graphOrId === "string" ? (graphOrId as string) : (graphOrId && (graphOrId as any).id ? (graphOrId as any).id : undefined);
    activeGraphRuns.set(runId, { status: "running", nodeProgress: [], startedAt, graphId });

    // Fire-and-forget — resolver returns the runId immediately.
    runGraph(graphOrId as any, {
      ...((opts as Record<string, unknown>) ?? {}),
      signal: controller.signal,
      onNodeStart: (nodeId: string, nodeName: string) => {
        try { mainWindow?.webContents.send("graph:nodeStart", { runId, nodeId, nodeName }); } catch {}
        // Record a lightweight "running" placeholder so renderer pages that query
        // `graphRuns()` or `graphRunStatus()` can see the currently executing node
        // even if they weren't listening when the start event was emitted.
        try {
          const entry = activeGraphRuns.get(runId);
          if (entry) {
            entry.nodeProgress.push({
              nodeId,
              nodeName,
              output: null,
              metadata: { elapsedMs: 0 },
              status: "running",
              timestamp: Date.now(),
            });
          }
        } catch {}
      },
      onNodeComplete: (output: unknown) => {
        const entry = activeGraphRuns.get(runId);
        if (entry) {
          try {
            // Replace the last running placeholder for this node if present,
            // otherwise just append the completed output.
            const outAny = output as any;
            const idx = entry.nodeProgress.map((p: any) => p).reverse().findIndex((p: any) => p && p.nodeId === outAny.nodeId && p.status === "running");
            if (idx >= 0) {
              // reverse index -> actual index
              const realIdx = entry.nodeProgress.length - 1 - idx;
              entry.nodeProgress[realIdx] = output;
            } else {
              entry.nodeProgress.push(output);
            }
          } catch (err) {
            try { entry.nodeProgress.push(output); } catch {}
          }
        }
        try { mainWindow?.webContents.send("graph:nodeComplete", { runId, nodeOutput: output }); } catch {}
      },
    }).then((result: unknown) => {
      const prev = activeGraphRuns.get(runId) ?? { nodeProgress: [] } as any;
      activeGraphRuns.set(runId, {
        status: "done",
        result,
        nodeProgress: prev.nodeProgress ?? [],
        startedAt: prev.startedAt ?? startedAt,
        graphId: prev.graphId,
      });
      try { mainWindow?.webContents.send("graph:runComplete", { runId, result }); } catch {}
      graphRunControllers.delete(runId);
    }).catch((err: Error) => {
      const error = err.message ?? String(err);
      const prev = activeGraphRuns.get(runId) ?? { nodeProgress: [] } as any;
      activeGraphRuns.set(runId, {
        status: "error",
        error,
        nodeProgress: prev.nodeProgress ?? [],
        startedAt: prev.startedAt ?? startedAt,
        graphId: prev.graphId,
      });
      try { mainWindow?.webContents.send("graph:runComplete", { runId, error }); } catch {}
      graphRunControllers.delete(runId);
    });

    return { runId };
  });

  // List active and recent graph runs so renderer can navigate to them even
  // after leaving the graph builder page.
  ipcMain.handle("graph:runs", () => {
    const runs: any[] = [];
    for (const [runId, info] of activeGraphRuns) {
      runs.push({ runId, ...info });
    }
    return runs;
  });

  ipcMain.handle("graph:run:status", (_e, runId: string) => activeGraphRuns.get(runId) ?? null);

  ipcMain.handle("graph:run:cancel", (_e, runId: string) => {
    try { graphRunControllers.get(runId)?.abort(); } catch {}
    graphRunControllers.delete(runId);
  });
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

  // Reconcile installed.json with items on disk that pre-date the index
  // tracking system.  Runs silently in the background — never blocks startup.
  import("@solix/core").then(({ reconcileInstalledItems }) => {
    reconcileInstalledItems().catch((err) =>
      console.warn("[SolixAI] installed-index reconciliation failed:", err),
    );
  }).catch(() => {});

  // Auto-start Discord bridges that have enabled: true saved in their config.
  // Deferred via setTimeout so it never blocks window creation or IPC registration.
  setTimeout(() => {
    import("@solix/core").then(async ({ readGlobalDiscordConfig, startGlobalBridge, listAgents: _listAgents, readBridgeConfig, startBridge }) => {
      // Global bridge
      try {
        const globalCfg = await readGlobalDiscordConfig();
        if (globalCfg?.enabled && globalCfg?.botToken) {
          startGlobalBridge().then(() => {
            console.log("[SolixAI] global Discord bridge auto-started");
          }).catch((err: Error) => {
            console.warn("[SolixAI] global Discord bridge auto-start failed:", err.message);
          });
        }
      } catch (err) {
        console.warn("[SolixAI] global Discord bridge config read failed:", (err as Error).message);
      }

      // Per-agent bridges — fire each one independently so a slow/failing
      // agent does not delay the others.
      try {
        const agents = await _listAgents();
        for (const agentName of agents) {
          readBridgeConfig(agentName).then((cfg) => {
            if (cfg?.enabled && cfg?.botToken) {
              startBridge(agentName).then(() => {
                console.log(`[SolixAI] Discord bridge auto-started for agent "${agentName}"`);
              }).catch((err: Error) => {
                console.warn(`[SolixAI] Discord bridge auto-start failed for "${agentName}":`, err.message);
              });
            }
          }).catch((err: Error) => {
            console.warn(`[SolixAI] Discord bridge config read failed for "${agentName}":`, err.message);
          });
        }
      } catch (err) {
        console.warn("[SolixAI] per-agent Discord bridge auto-start failed:", (err as Error).message);
      }
    }).catch(() => {});
  }, 0);

  // Start trigger engine so cron/webhook triggers run in the background.
  try {
    const triggerEngine = getTriggerEngine();
    triggerEngine.on("run:started", (run: any) => {
      try { mainWindow?.webContents.send("triggers:runUpdate", run); } catch {}
    });
    triggerEngine.on("run:completed", (run: any) => {
      try { mainWindow?.webContents.send("triggers:runUpdate", run); } catch {}
    });
    triggerEngine.on("run:failed", (run: any) => {
      try { mainWindow?.webContents.send("triggers:runUpdate", run); } catch {}
    });
    triggerEngine.start().then(() => {
      console.log("[SolixAI] trigger engine started");
    }).catch((err) => {
      console.error("[SolixAI] trigger engine start failed:", err);
    });
  } catch (err) {
    console.error("[SolixAI] trigger engine setup failed:", err);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
