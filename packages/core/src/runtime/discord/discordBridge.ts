/**
 * Discord Bridge — connects a Discord channel to a SolixAI agent.
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
 *   ~/.solix/agents/<agentName>/discord-bridge.json
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
  TriggerDefinition,
  TriggerEvent,
  PipelineResult,
} from "../../types/index.js";
import { runAutonomousTask } from "../pipeline/autonomous.js";
import {
  loadChatSession,
  saveChatSession,
  type ChatMessage,
  type ChatSession,
} from "../agents/chatManager.js";
import {
  agentsDir,
  toKebab,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../utils/index.js";

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

    if (this.mode === "bridge") {
      await this.handleBridgeMessage(message, content);
    } else {
      await this.handleTriggerMessage(message, content);
    }
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

    try {
      await message.channel.sendTyping?.();

      const result = await runAutonomousTask(
        this.agentName,
        content,
        {
          provider: this.provider,
          model: this.model,
          maxSteps: this.maxSteps,
          chatHistory: chatHistory.slice(0, -1), // Exclude the message we just added (it's the task).
        },
      );

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
        result,
      });
    } catch (err) {
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
