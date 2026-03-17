/**
 * Discord Bridge — connects a Discord channel to a NyteShift agent.
 *
 * Two operating modes (following OpenClaw's channel-adapter architecture):
 *
 *  1. **Trigger mode** (`discordMode: "trigger"`)
 *     Every matching Discord message spawns an independent autonomous run
 *     with the message content interpolated into the task template.
 *     No conversation history is carried between messages.
 *
 *  2. **Bridge mode** (`discordMode: "bridge"`)
 *     The Discord channel acts as a persistent chat proxy.  Each channel
 *     maps to a ChatSession, and the full conversation history is passed
 *     to the agent on every message, enabling multi-turn conversations.
 *
 * The bridge lazily imports `discord.js` so the rest of the core package
 * works without the dependency installed.  If `discord.js` is not available,
 * an informative error is thrown at connection time.
 *
 * Security: bot tokens are stored per-agent at
 *   ~/.nyteshift/agents/<agentName>/discord-bridge.json
 * or inline in the TriggerDefinition.  Tokens are never logged.
 *
 * Design references:
 *  - Anthropic agentic tool-use: external event → autonomous agent run
 *  - OpenClaw channel plugin: inbound message → session → agent → reply
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type {
  DiscordBridgeConfig,
  GlobalDiscordConfig,
  TriggerDefinition,
  TriggerEvent,
  PipelineResult,
} from "../../types/index.js";
import { runAutonomousTask } from "../pipeline/autonomous.js";
import {
  loadChatSession,
  saveChatSession,
  archiveChatSession,
  type ChatMessage,
  type ChatSession,
} from "../agents/chatManager.js";
import { AgentController } from "../control/controller.js";
import {
  agentsDir,
  toKebab,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../utils/index.js";
import { readGlobalConfig, writeGlobalConfig } from "../config/configResolver.js";
import { getSecret, setSecret, SECRET_KEYS } from "../config/secretStore.js";
import { listAgents } from "../agents/agentManager.js";

// ── Logging ────────────────────────────────────────────────────────────

const log  = (...args: unknown[]) => console.log("[discord-bridge]", ...args);
const logW = (...args: unknown[]) => console.warn("[discord-bridge]", ...args);
const logE = (...args: unknown[]) => console.error("[discord-bridge]", ...args);

// ── Config persistence ─────────────────────────────────────────────────

function bridgeConfigPath(agentName: string): string {
  return join(agentsDir(), toKebab(agentName), "discord-bridge.json");
}

export async function readBridgeConfig(agentName: string): Promise<DiscordBridgeConfig | null> {
  const p = bridgeConfigPath(agentName);
  if (!(await pathExists(p))) return null;
  try {
    return await readJsonFile<DiscordBridgeConfig>(p);
  } catch {
    return null;
  }
}

export async function writeBridgeConfig(agentName: string, config: DiscordBridgeConfig): Promise<void> {
  await writeJsonFile(bridgeConfigPath(agentName), config);
}

export async function deleteBridgeConfig(agentName: string): Promise<void> {
  const p = bridgeConfigPath(agentName);
  if (await pathExists(p)) {
    const { rm } = await import("node:fs/promises");
    await rm(p, { force: true });
  }
}

// ── Session key derivation (bridge mode) ───────────────────────────────

/**
 * Deterministic session ID for a Discord channel, so conversations
 * persist across bot restarts.  Format: `discord-<channelId>`.
 */
function discordSessionId(channelId: string): string {
  return `discord-${channelId}`;
}

// ── Bridge class ───────────────────────────────────────────────────────

export interface DiscordBridgeOptions {
  /** Bot token. */
  botToken: string;
  /** Agent name to route messages to. */
  agentName: string;
  /** Guild ID to restrict to (optional). */
  guildId?: string;
  /** Channel IDs to listen on.  Empty = all visible channels. */
  channelIds?: string[];
  /** Only respond when the bot is @mentioned. */
  mentionOnly?: boolean;
  /**
   * Operating mode.
   *  - `"trigger"`: one-shot autonomous run per message (no history).
   *  - `"bridge"`:  persistent chat session per channel (full history).
   */
  mode?: "trigger" | "bridge";
  /** Task template for trigger mode (default: `"{{payload.content}}"`) */
  taskTemplate?: string;
  /** Provider override. */
  provider?: string;
  /** Model override. */
  model?: string;
  /** Max autonomous steps per run (default 10). */
  maxSteps?: number;
}

export class DiscordBridge extends EventEmitter {
  private client: any = null; // discord.js Client (lazy-loaded)
  private running = false;
  private botUserId = "";
  /**
   * Active run controllers keyed by sessionId.
   * Populated at the start of each bridge-mode run and removed in a
   * finally block so /cancel can abort an in-progress pipeline step.
   */
  private readonly activeControllers = new Map<string, AgentController>();

  readonly agentName: string;
  private readonly botToken: string;
  private readonly guildId?: string;
  private readonly channelIds: Set<string>;
  private readonly mentionOnly: boolean;
  private readonly mode: "trigger" | "bridge";
  private readonly taskTemplate: string;
  private readonly provider?: string;
  private readonly model?: string;
  private readonly maxSteps: number;

  constructor(opts: DiscordBridgeOptions) {
    super();
    this.agentName = opts.agentName;
    this.botToken = opts.botToken;
    this.guildId = opts.guildId;
    this.channelIds = new Set(opts.channelIds ?? []);
    this.mentionOnly = opts.mentionOnly ?? false;
    this.mode = opts.mode ?? "trigger";
    this.taskTemplate = opts.taskTemplate ?? "{{payload.content}}";
    this.provider = opts.provider;
    this.model = opts.model;
    this.maxSteps = opts.maxSteps ?? 10;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;

    // Lazy-import discord.js to avoid hard dependency.
    let DiscordJS: any;
    try {
      DiscordJS = await import("discord.js");
    } catch {
      throw new Error(
        "discord.js is not installed.  Run `npm install discord.js` in packages/core to enable Discord integration.",
      );
    }

    const { Client, GatewayIntentBits, Events } = DiscordJS;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    // Ready handler.
    this.client.once(Events.ClientReady, (readyClient: any) => {
      this.botUserId = readyClient.user.id;
      log(`connected as ${readyClient.user.tag} (mode: ${this.mode})`);
      this.emit("ready", { tag: readyClient.user.tag, id: this.botUserId });
    });

    // Message handler.
    this.client.on(Events.MessageCreate, async (message: any) => {
      try {
        await this.handleMessage(message);
      } catch (err) {
        logE("message handler error:", (err as Error).message);
        this.emit("error", err);
      }
    });

    // Error handler.
    this.client.on("error", (err: Error) => {
      logE("client error:", err.message);
      this.emit("error", err);
    });

    await this.client.login(this.botToken);
    this.running = true;
    log("started");
    this.emit("started");
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    log("stopping…");
    try {
      await this.client?.destroy();
    } catch {
      // Best-effort.
    }
    this.client = null;
    this.running = false;
    log("stopped");
    this.emit("stopped");
  }

  // ── Message handler ────────────────────────────────────────────────

  private async handleMessage(message: any): Promise<void> {
    // Log raw incoming message for debugging before any filters
    try {
      const user = message.author?.username || "<unknown>";
      const chan = message.channel?.name || message.channel?.id || "<unknown>";
      const raw = message.content;
      log(`[discord-bridge] incoming message from ${user} in #${chan}: "${raw}"`);
    } catch {
      // ignore logging errors
    }

    // Ignore bot messages (including our own).
    if (message.author.bot) return;

    // Guild filter.
    if (this.guildId && message.guild?.id !== this.guildId) return;

    // Channel filter.
    if (this.channelIds.size > 0 && !this.channelIds.has(message.channel.id)) return;

    // Mention filter.
    if (this.mentionOnly) {
      const mentioned = message.mentions.users.has(this.botUserId);
      if (!mentioned) return;
    }

    const content = message.content.trim();
    if (!content) return;

    log(`message from ${message.author.username} in #${message.channel.name || message.channel.id}: "${content.slice(0, 80)}"`);
    this.emit("message", {
      author: message.author.username,
      authorId: message.author.id,
      channelId: message.channel.id,
      guildId: message.guild?.id,
      content,
    });

    // ── Discord control commands (bridge mode only) ──────────────────
    if (this.mode === "bridge") {
      const cmd = content.toLowerCase();
      if (cmd === "/newchat") {
        await this.handleNewChatCommand(message);
        return;
      }
      if (cmd === "/cancel") {
        await this.handleCancelCommand(message);
        return;
      }
      await this.handleBridgeMessage(message, content);
    } else {
      await this.handleTriggerMessage(message, content);
    }
  }

  // ── /newchat command ───────────────────────────────────────────────

  /**
   * Archive the current channel session so the next message starts a
   * completely blank context window.  The archived file is preserved
   * under chats/archived/ for audit / recovery (soft-delete).
   *
   * Follows Anthropic's guideline of preferring reversible, safe operations
   * in agentic systems.
   */
  private async handleNewChatCommand(message: any): Promise<void> {
    const channelId = message.channel.id;
    const sessionId = discordSessionId(channelId);
    const separator = "─".repeat(40);
    try {
      await archiveChatSession(this.agentName, sessionId);
      await message.channel.send(
        `${separator}\nNew chat started by **${message.author.username}**\n${separator}`,
      );
      log(`[/newchat] session "${sessionId}" archived for agent "${this.agentName}"`);
      this.emit("session:reset", {
        channelId,
        sessionId,
        agentName: this.agentName,
        requestedBy: message.author.id,
      });
    } catch (err) {
      logE("/newchat failed:", (err as Error).message);
      try { await message.channel.send("Failed to reset chat — please try again."); } catch {}
    }
  }

  // ── /cancel command ────────────────────────────────────────────────

  /**
   * Abort the currently running autonomous pipeline for this channel.
   *
   * The AbortSignal is checked between every ReAct step so cancellation
   * takes effect at the next step boundary.  The pipeline returns
   * `aborted: true` and any partial session state is preserved.
   */
  private async handleCancelCommand(message: any): Promise<void> {
    const channelId = message.channel.id;
    const sessionId = discordSessionId(channelId);
    const controller = this.activeControllers.get(sessionId);
    if (!controller) {
      try { await message.channel.send("No active task to cancel."); } catch {}
      return;
    }
    controller.cancel();
    log(`[/cancel] requested by ${message.author.username} for session "${sessionId}"`);
    try {
      await message.channel.send(
        `**${message.author.username}** cancelled the current task.`,
      );
    } catch {}
    this.emit("run:cancelled", {
      channelId,
      sessionId,
      agentName: this.agentName,
      requestedBy: message.author.id,
    });
  }

  // ── Trigger mode ──────────────────────────────────────────────────

  private async handleTriggerMessage(message: any, content: string): Promise<void> {
    const event: TriggerEvent = {
      type: "discord",
      payload: {
        content,
        author: message.author.username,
        authorId: message.author.id,
        channelId: message.channel.id,
        channelName: message.channel.name || "",
        guildId: message.guild?.id || "",
        guildName: message.guild?.name || "",
        messageId: message.id,
      },
      timestamp: Date.now(),
    };

    // Render task template with event payload.
    const task = this.renderTemplate(this.taskTemplate, event);

    try {
      // Show typing indicator while agent works.
      await message.channel.sendTyping?.();

      const result = await runAutonomousTask(this.agentName, task, {
        provider: this.provider,
        model: this.model,
        maxSteps: this.maxSteps,
      });

      // Send reply (split into 2000-char chunks for Discord's limit).
      await this.sendReply(message.channel, result.finalOutput, message.id);

      this.emit("run:completed", {
        mode: "trigger",
        channelId: message.channel.id,
        result,
      });
    } catch (err) {
      logE("trigger run failed:", (err as Error).message);
      try {
        await message.channel.send(`Sorry, I encountered an error: ${(err as Error).message}`);
      } catch {}
      this.emit("run:failed", { mode: "trigger", error: (err as Error).message });
    }
  }

  // ── Bridge mode ───────────────────────────────────────────────────

  private async handleBridgeMessage(message: any, content: string): Promise<void> {
    const channelId = message.channel.id;
    const sessionId = discordSessionId(channelId);

    // Load or create session.
    let session = await loadChatSession(this.agentName, sessionId);
    if (!session) {
      session = {
        id: sessionId,
        agentName: this.agentName,
        title: `Discord #${message.channel.name || channelId}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
    }

    // Append user message.
    const userMsg: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: `[${message.author.username}]: ${content}`,
      ts: Date.now(),
    };
    session.messages.push(userMsg);

    // Build chat history for context.
    const chatHistory = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-50) // Keep last 50 turns for context window safety.
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Register a controller so /cancel can abort between steps.
    const controller = new AgentController();
    this.activeControllers.set(sessionId, controller);

    try {
      await message.channel.sendTyping?.();

      let result;
      try {
        result = await runAutonomousTask(
          this.agentName,
          content,
          {
            provider: this.provider,
            model: this.model,
            maxSteps: this.maxSteps,
            chatHistory: chatHistory.slice(0, -1), // Exclude the message we just added (it's the task).
            signal: controller.signal,
          },
        );
      } finally {
        // Always release the controller slot, whether the run succeeded,
        // failed, or was cancelled — prevents stale entries in the Map.
        this.activeControllers.delete(sessionId);
      }

      // Append assistant response.
      const assistantMsg: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        content: result.finalOutput,
        thinking: result.thinking,
        ts: Date.now(),
      };
      session.messages.push(assistantMsg);

      // Persist the session.
      await saveChatSession(session);

      // Send reply to Discord.
      await this.sendReply(message.channel, result.finalOutput, message.id);

      this.emit("run:completed", {
        mode: "bridge",
        channelId,
        sessionId,
        aborted: result.aborted,
        result,
      });
    } catch (err) {
      // Ensure controller is removed even if the outer try throws before
      // the inner finally had a chance to run.
      this.activeControllers.delete(sessionId);
      logE("bridge run failed:", (err as Error).message);

      // Record the error in session history.
      session.messages.push({
        id: randomUUID(),
        role: "error" as any,
        content: `Error: ${(err as Error).message}`,
        ts: Date.now(),
      });
      await saveChatSession(session);

      try {
        await message.channel.send(`Sorry, I encountered an error: ${(err as Error).message}`);
      } catch {}
      this.emit("run:failed", { mode: "bridge", error: (err as Error).message });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /** Send a reply, respecting Discord's 2000-char limit. */
  private async sendReply(channel: any, text: string, replyToId?: string): Promise<void> {
    const maxLen = 1990; // Leave room for formatting.
    const chunks: string[] = [];

    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to split at a newline.
      let splitAt = remaining.lastIndexOf("\n", maxLen);
      if (splitAt <= 0) splitAt = maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    for (let i = 0; i < chunks.length; i++) {
      const opts: any = {};
      // Reply to the original message for the first chunk only.
      if (i === 0 && replyToId) {
        opts.reply = { messageReference: replyToId };
      }
      await channel.send({ content: chunks[i], ...opts });
    }
  }

  /** Interpolate {{path.to.value}} placeholders. */
  private renderTemplate(template: string, event: TriggerEvent): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
      const parts = path.split(".");
      let value: unknown = event;
      for (const part of parts) {
        if (value === null || value === undefined) return "";
        if (typeof value === "object") {
          value = (value as Record<string, unknown>)[part];
        } else {
          return "";
        }
      }
      if (value === null || value === undefined) return "";
      return typeof value === "string" ? value : JSON.stringify(value);
    });
  }

  /**
   * Resolve a human-friendly channel name (e.g. "emaily" or "#emaily")
   * to a Discord channel snowflake ID. Returns `null` if not found.
   */
  public async resolveChannelByName(name: string): Promise<string | null> {
    if (!this.client || !name) return null;
    const normalize = (s: string) => s.toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
    const want = normalize(name);

    try {
      // Prefer configured guild when available to reduce search scope.
      const guildIds = this.guildId ? [this.guildId] : Array.from(this.client.guilds.cache.keys());
      for (const gid of guildIds) {
        let guild: any;
        try {
          guild = await this.client.guilds.fetch(gid);
        } catch {
          guild = this.client.guilds.cache.get(gid);
        }
        if (!guild) continue;

        let chans: any;
        try {
          chans = await guild.channels.fetch();
        } catch {
          chans = guild.channels?.cache ?? null;
        }
        if (!chans) continue;

        for (const ch of chans.values()) {
          const chName = (ch.name || "").toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
          if (chName === want) return ch.id;
        }
      }
    } catch {
      // best-effort: swallow errors and return null
    }
    return null;
  }
}

// ── Active bridges registry ────────────────────────────────────────────

const activeBridges = new Map<string, DiscordBridge>();

/** Get all currently active Discord bridges. */
export function getActiveBridges(): Map<string, DiscordBridge> {
  return activeBridges;
}

/**
 * Start a Discord bridge for an agent from its saved config.
 * Returns the bridge instance.
 */
export async function startBridge(agentName: string): Promise<DiscordBridge> {
  const key = toKebab(agentName);

  // Stop existing bridge if running.
  const existing = activeBridges.get(key);
  if (existing?.isRunning) {
    await existing.stop();
  }

  const config = await readBridgeConfig(agentName);
  if (!config) {
    throw new Error(`No Discord bridge config found for agent "${agentName}". Configure one first.`);
  }
  if (!config.botToken) {
    throw new Error(`Discord bot token is required for agent "${agentName}".`);
  }

  const bridge = new DiscordBridge({
    botToken: config.botToken,
    agentName: config.agentName,
    guildId: config.guildId,
    channelIds: config.channelIds,
    mentionOnly: config.mentionOnly,
    mode: "bridge",
    provider: config.provider,
    model: config.model,
  });

  await bridge.start();
  activeBridges.set(key, bridge);
  return bridge;
}

/** Stop a Discord bridge for an agent. */
export async function stopBridge(agentName: string): Promise<void> {
  const key = toKebab(agentName);
  const bridge = activeBridges.get(key);
  if (bridge?.isRunning) {
    await bridge.stop();
  }
  activeBridges.delete(key);
}

/** Check whether a bridge is running for an agent. */
export function isBridgeRunning(agentName: string): boolean {
  const key = toKebab(agentName);
  return activeBridges.get(key)?.isRunning ?? false;
}

// ── Global Discord Config persistence ─────────────────────────────────

/** Read the global Discord config from the user's top-level config. */
export async function readGlobalDiscordConfig(): Promise<GlobalDiscordConfig | null> {
  const cfg = await readGlobalConfig();
  const discord: GlobalDiscordConfig | null = (cfg as any).globalDiscord ?? null;
  if (!discord) return null;

  // Inject the bot token from the secret store (it is not in config.json).
  const storedToken = await getSecret(SECRET_KEYS.DISCORD_BOT_TOKEN);
  return {
    ...discord,
    botToken: storedToken ?? discord.botToken ?? "",
  };
}

/** Write the global Discord config into the user's top-level config. */
export async function writeGlobalDiscordConfig(discord: GlobalDiscordConfig): Promise<void> {
  // Persist the bot token in the secret store, never in config.json.
  if (discord.botToken && discord.botToken.trim()) {
    await setSecret(SECRET_KEYS.DISCORD_BOT_TOKEN, discord.botToken.trim());
  }

  // Write settings (without token) to the shared config file.
  const { botToken: _token, ...discordWithoutToken } = discord;
  const cfg = await readGlobalConfig();
  (cfg as any).globalDiscord = discordWithoutToken;
  await writeGlobalConfig(cfg as any);
}

// ── GlobalDiscordBridge ────────────────────────────────────────────────

/**
 * A single shared Discord bot that routes messages to agents by name.
 *
 * Agents WITHOUT their own per-agent discord-bridge.json are served by
 * this bridge.  To address an agent the user must prefix their message
 * with the agent's name:
 *
 *   @AgentName do something for me
 *   AgentName: do something for me
 *
 * Case is ignored when matching agent names.  The name prefix is stripped
 * before the task is sent to the agent.
 *
 * Agents WITH their own per-agent discord-bridge.json (a dedicated bot
 * token) run their own `DiscordBridge` and are NOT handled here.
 */
export class GlobalDiscordBridge extends EventEmitter {
  private client: any = null;
  private running = false;
  private botUserId = "";
  /**
   * Active run controllers keyed by sessionId.
   * Used by /cancel to abort in-progress pipeline runs between steps.
   */
  private readonly activeControllers = new Map<string, AgentController>();

  private readonly botToken: string;
  private readonly guildId?: string;
  private readonly channelIds: Set<string>;
  private readonly mode: "trigger" | "bridge";
  /** channel ID → agent name direct routing map */
  private readonly channelAgentMap: Map<string, string>;

  constructor(cfg: GlobalDiscordConfig) {
    super();
    this.botToken = cfg.botToken;
    this.guildId = cfg.guildId;
    this.channelIds = new Set(cfg.channelIds ?? []);
    this.mode = cfg.mode ?? "bridge";
    this.channelAgentMap = new Map(Object.entries(cfg.channelAgentMap ?? {}));
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;

    let DiscordJS: any;
    try {
      DiscordJS = await import("discord.js");
    } catch {
      throw new Error(
        "discord.js is not installed.  Run `npm install discord.js` in packages/core to enable Discord integration.",
      );
    }

    const { Client, GatewayIntentBits, Events } = DiscordJS;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.once(Events.ClientReady, (readyClient: any) => {
      this.botUserId = readyClient.user.id;
      log(`[global] connected as ${readyClient.user.tag} (mode: ${this.mode})`);
      this.emit("ready", { tag: readyClient.user.tag, id: this.botUserId });
    });

    this.client.on(Events.MessageCreate, async (message: any) => {
      try {
        await this.handleMessage(message);
      } catch (err) {
        logE("[global] message handler error:", (err as Error).message);
        this.emit("error", err);
      }
    });

    this.client.on("error", (err: Error) => {
      logE("[global] client error:", err.message);
      this.emit("error", err);
    });

    await this.client.login(this.botToken);
    this.running = true;
    log("[global] started");
    this.emit("started");
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    log("[global] stopping…");
    try {
      await this.client?.destroy();
    } catch {
      // Best-effort.
    }
    this.client = null;
    this.running = false;
    log("[global] stopped");
    this.emit("stopped");
  }

  // ── Message routing ──────────────────────────────────────────────

  private async handleMessage(message: any): Promise<void> {
    if (message.author.bot) return;

    if (this.guildId && message.guild?.id !== this.guildId) return;

    // Resolve mapped agent: try channel ID first, then channel name (case-insensitive, strip leading #).
    const channelName = (message.channel.name || "").toLowerCase().replace(/^#/, "");
    const mappedAgent =
      this.channelAgentMap.get(message.channel.id) ??
      this.channelAgentMap.get(channelName) ??
      [...this.channelAgentMap.entries()].find(
        ([k]) => k.toLowerCase().replace(/^#/, "") === channelName
      )?.[1];

    if (!mappedAgent && this.channelIds.size > 0 && !this.channelIds.has(message.channel.id)) return;

    const raw = message.content.trim();
    if (!raw) return;

    // ── Discord control commands (bridge mode only) ────────────────────
    if (this.mode === "bridge") {
      const rawLower = raw.toLowerCase();
      if (rawLower === "/newchat" || rawLower.startsWith("/newchat ")) {
        await this.handleControlCommand(message, raw, mappedAgent ?? null);
        return;
      }
      if (rawLower === "/cancel") {
        await this.handleControlCommand(message, raw, mappedAgent ?? null);
        return;
      }
    }

    // If this channel has a direct agent mapping, route straight to that agent
    // with no name prefix required.
    if (mappedAgent) {
      log(
        `[global] channel-mapped message from ${message.author.username} in #${message.channel.name || message.channel.id} → agent "${mappedAgent}":`,
        `"${raw.slice(0, 80)}"`,
      );
      this.emit("message", {
        agentName: mappedAgent,
        author: message.author.username,
        authorId: message.author.id,
        channelId: message.channel.id,
        guildId: message.guild?.id,
        content: raw,
      });
      if (this.mode === "bridge") {
        await this.handleBridgeMessage(message, mappedAgent, raw);
      } else {
        await this.handleTriggerMessage(message, mappedAgent, raw);
      }
      return;
    }

    // Load known agents and find those WITHOUT their own dedicated bridge.
    const allAgents = await listAgents();

    // Build list of agents that should be served by the global bridge
    // (i.e. those that have NO per-agent discord-bridge.json).
    const globalAgents: string[] = [];
    for (const name of allAgents) {
      const cfg = await readBridgeConfig(name);
      if (!cfg || !cfg.botToken) {
        globalAgents.push(name);
      }
    }

    const parsed = parseAgentFromMessage(raw, globalAgents);
    if (!parsed) return; // No matching agent name prefix found.

    const { agentName, task } = parsed;

    log(
      `[global] routing message from ${message.author.username} → agent "${agentName}":`,
      `"${task.slice(0, 80)}"`,
    );
    this.emit("message", {
      agentName,
      author: message.author.username,
      authorId: message.author.id,
      channelId: message.channel.id,
      guildId: message.guild?.id,
      content: task,
    });

    if (this.mode === "bridge") {
      await this.handleBridgeMessage(message, agentName, task);
    } else {
      await this.handleTriggerMessage(message, agentName, task);
    }
  }

  private async handleBridgeMessage(message: any, agentName: string, task: string): Promise<void> {
    const channelId = message.channel.id;
    // Per-agent, per-channel session so conversations don't bleed between agents.
    const sessionId = `discord-global-${channelId}-${toKebab(agentName)}`;

    let session = await loadChatSession(agentName, sessionId);
    if (!session) {
      session = {
        id: sessionId,
        agentName,
        title: `Discord Global #${message.channel.name || channelId}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
    }

    const userMsg: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: `[${message.author.username}]: ${task}`,
      ts: Date.now(),
    };
    session.messages.push(userMsg);

    const chatHistory = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-50)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // Register a controller so /cancel can abort between steps.
    const controller = new AgentController();
    this.activeControllers.set(sessionId, controller);

    try {
      await message.channel.sendTyping?.();

      let result;
      try {
        result = await runAutonomousTask(agentName, task, {
          chatHistory: chatHistory.slice(0, -1),
          signal: controller.signal,
        });
      } finally {
        this.activeControllers.delete(sessionId);
      }

      const assistantMsg: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        content: result.finalOutput,
        thinking: result.thinking,
        ts: Date.now(),
      };
      session.messages.push(assistantMsg);
      await saveChatSession(session);

      await this.sendReply(message.channel, result.finalOutput, message.id);

      this.emit("run:completed", {
        mode: "bridge",
        agentName,
        channelId,
        sessionId,
        aborted: result.aborted,
        result,
      });
    } catch (err) {
      this.activeControllers.delete(sessionId);
      logE(`[global] bridge run failed for "${agentName}":`, (err as Error).message);
      session.messages.push({ id: randomUUID(), role: "error" as any, content: `Error: ${(err as Error).message}`, ts: Date.now() });
      await saveChatSession(session);
      try { await message.channel.send(`[${agentName}] Sorry, I encountered an error: ${(err as Error).message}`); } catch {}
      this.emit("run:failed", { mode: "bridge", agentName, error: (err as Error).message });
    }
  }

  // ── Control commands (/newchat, /cancel) ──────────────────────────────

  /**
   * Handle /newchat and /cancel for the global bridge.
   *
   * /newchat [agentName]
   *   Archives the session for the target agent (channel-mapped or explicit).
   *   Soft-deletes so history is preserved for audit/recovery.
   *
   * /cancel
   *   Aborts ALL active pipeline runs for this channel (any agent).
   *   Cancellation is cooperative — takes effect at the next ReAct step boundary.
   */
  private async handleControlCommand(
    message: any,
    raw: string,
    mappedAgent: string | null,
  ): Promise<void> {
    const channelId = message.channel.id;
    const rawLower = raw.toLowerCase();
    const separator = "─".repeat(40);

    // ── /newchat ──────────────────────────────────────────────────────
    if (rawLower === "/newchat" || rawLower.startsWith("/newchat ")) {
      // Explicit agent name takes priority over channel mapping.
      const argAgent = rawLower.startsWith("/newchat ") ? raw.slice(9).trim() : null;
      const targetAgent = argAgent || mappedAgent;

      if (!targetAgent) {
        try {
          await message.channel.send(
            "Please specify an agent: `/newchat <agentName>`",
          );
        } catch {}
        return;
      }

      const sessionId = `discord-global-${channelId}-${toKebab(targetAgent)}`;
      try {
        await archiveChatSession(targetAgent, sessionId);
        await message.channel.send(
          `${separator}\nNew chat started by **${message.author.username}** (agent: **${targetAgent}**)\n${separator}`,
        );
        log(`[global /newchat] session "${sessionId}" archived by ${message.author.username}`);
        this.emit("session:reset", {
          channelId,
          sessionId,
          agentName: targetAgent,
          requestedBy: message.author.id,
        });
      } catch (err) {
        logE("[global] /newchat failed:", (err as Error).message);
        try { await message.channel.send("Failed to reset chat — please try again."); } catch {}
      }
      return;
    }

    // ── /cancel ───────────────────────────────────────────────────────
    if (rawLower === "/cancel") {
      // Cancel every active run for this channel regardless of agent.
      const prefix = `discord-global-${channelId}-`;
      let cancelled = 0;
      for (const [sid, ctrl] of this.activeControllers.entries()) {
        if (sid.startsWith(prefix)) {
          ctrl.cancel();
          this.activeControllers.delete(sid);
          cancelled++;
        }
      }

      if (cancelled === 0) {
        try { await message.channel.send("No active tasks to cancel."); } catch {}
      } else {
        try {
          await message.channel.send(
            `**${message.author.username}** cancelled ${cancelled} active task(s).`,
          );
        } catch {}
      }
      log(`[global /cancel] ${cancelled} run(s) cancelled in channel ${channelId} by ${message.author.username}`);
      this.emit("run:cancelled", {
        channelId,
        cancelled,
        requestedBy: message.author.id,
      });
    }
  }

  private async handleTriggerMessage(message: any, agentName: string, task: string): Promise<void> {
    const event: TriggerEvent = {
      type: "discord",
      payload: {
        content: task,
        author: message.author.username,
        authorId: message.author.id,
        channelId: message.channel.id,
        channelName: message.channel.name || "",
        guildId: message.guild?.id || "",
        guildName: message.guild?.name || "",
        messageId: message.id,
      },
      timestamp: Date.now(),
    };

    try {
      await message.channel.sendTyping?.();

      const result = await runAutonomousTask(agentName, task, {});

      await this.sendReply(message.channel, result.finalOutput, message.id);

      this.emit("run:completed", { mode: "trigger", agentName, channelId: message.channel.id, result });
    } catch (err) {
      logE(`[global] trigger run failed for "${agentName}":`, (err as Error).message);
      try { await message.channel.send(`[${agentName}] Sorry, I encountered an error: ${(err as Error).message}`); } catch {}
      this.emit("run:failed", { mode: "trigger", agentName, error: (err as Error).message });
    }
  }

  private async sendReply(channel: any, text: string, replyToId?: string): Promise<void> {
    const maxLen = 1990;
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) { chunks.push(remaining); break; }
      let splitAt = remaining.lastIndexOf("\n", maxLen);
      if (splitAt <= 0) splitAt = maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    for (let i = 0; i < chunks.length; i++) {
      const opts: any = {};
      if (i === 0 && replyToId) opts.reply = { messageReference: replyToId };
      await channel.send({ content: chunks[i], ...opts });
    }
  }

  /**
   * Resolve a human-friendly channel name (e.g. "emaily" or "#emaily")
   * to a Discord channel snowflake ID. Returns `null` if not found.
   */
  public async resolveChannelByName(name: string): Promise<string | null> {
    if (!this.client || !name) return null;
    const normalize = (s: string) => s.toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
    const want = normalize(name);

    // If the channelAgentMap contains a matching key that is already a snowflake, return it.
    for (const key of this.channelAgentMap.keys()) {
      const keyNorm = String(key).toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
      if (keyNorm === want && /^\d+$/.test(String(key))) {
        return String(key);
      }
    }

    try {
      // Search through guilds and their channels.
      for (const g of this.client.guilds.cache.values()) {
        try {
          const chans = await g.channels.fetch();
          for (const ch of chans.values()) {
            const chName = (ch.name || "").toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
            if (chName === want) return ch.id;
          }
        } catch {}
      }
    } catch {}

    return null;
  }

  public async sendMessage(channelOrName: string, content: string, opts?: { replyToId?: string }): Promise<void> {
    if (!this.client) throw new Error("Global Discord bridge is not running");
    let channelId = String(channelOrName ?? "").trim();
    if (!/^\d+$/.test(channelId)) {
      const resolved = await this.resolveChannelByName(channelId);
      if (!resolved) throw new Error(`Channel "${channelOrName}" could not be resolved to a Discord channel ID`);
      channelId = resolved;
    }
    let ch: any;
    try {
      ch = await this.client.channels.fetch(channelId);
    } catch {
      ch = this.client.channels.cache.get(channelId);
    }
    if (!ch || typeof ch.send !== "function") {
      throw new Error(`Channel "${channelOrName}" (${channelId}) is not a text channel or is not accessible`);
    }
    const sendOpts: any = { content };
    if (opts?.replyToId) sendOpts.reply = { messageReference: opts.replyToId };
    await ch.send(sendOpts);
  }

}
// ── Agent name parsing ─────────────────────────────────────────────────

/**
 * Parse an agent name prefix from a Discord message.
 *
 * Supported formats (case-insensitive):
 *   `@AgentName rest of message`
 *   `AgentName: rest of message`
 *
 * @returns `{agentName, task}` or `null` if no match.
 */
export function parseAgentFromMessage(
  content: string,
  agents: string[],
): { agentName: string; task: string } | null {
  const lower = content.toLowerCase();

  for (const name of agents) {
    const lname = name.toLowerCase();

    // "@AgentName " prefix
    if (lower.startsWith(`@${lname} `) || lower.startsWith(`@${lname}\n`)) {
      const task = content.slice(name.length + 1).trimStart(); // strip "@Name"
      return { agentName: name, task };
    }

    // "AgentName: " prefix
    if (lower.startsWith(`${lname}: `)) {
      const task = content.slice(name.length + 2).trimStart(); // strip "Name: "
      return { agentName: name, task };
    }
  }

  return null;
}

// ── Global bridge registry ─────────────────────────────────────────────

let _globalBridge: GlobalDiscordBridge | null = null;

/** Get the active global Discord bridge, if any. */
export function getGlobalBridge(): GlobalDiscordBridge | null {
  return _globalBridge;
}

/**
 * Start the global Discord bridge using the stored global config.
 * Stops any previously running global bridge first.
 */
export async function startGlobalBridge(): Promise<GlobalDiscordBridge> {
  if (_globalBridge?.isRunning) {
    await _globalBridge.stop();
  }

  const cfg = await readGlobalDiscordConfig();
  if (!cfg) {
    throw new Error("No global Discord config found. Configure one in Global Settings → Discord.");
  }
  if (!cfg.botToken) {
    throw new Error("Global Discord bot token is required.");
  }

  _globalBridge = new GlobalDiscordBridge(cfg);
  await _globalBridge.start();
  return _globalBridge;
}

/** Stop the global Discord bridge. */
export async function stopGlobalBridge(): Promise<void> {
  if (_globalBridge?.isRunning) {
    await _globalBridge.stop();
  }
  _globalBridge = null;
}

/** Whether the global Discord bridge is currently running. */
export function isGlobalBridgeRunning(): boolean {
  return _globalBridge?.isRunning ?? false;
}
