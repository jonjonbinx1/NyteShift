/**
 * TriggerEngine — orchestrates trigger lifecycle.
 *
 * Design follows the industry-standard pattern from Anthropic's agentic
 * tool-use documentation and OpenAI's Assistants API:
 *
 *  1. An external event (cron tick, webhook request, manual invocation)
 *     fires a **TriggerEvent**.
 *  2. The event is matched to a **TriggerDefinition** which specifies the
 *     agent to invoke and a task-template that gets interpolated with the
 *     event payload.
 *  3. The agent is "spawned" by calling **runAutonomousTask()** — the same
 *     ReAct loop used for interactive chat — and runs until it produces a
 *     final answer or exhausts its step budget.
 *  4. The run result is recorded as a **TriggerRun** for observability.
 *
 * Supported trigger types:
 *  - **cron**    — time-based scheduling (cron expressions or interval
 *                  shorthands like "5m", "1h").
 *  - **webhook** — HTTP POST endpoint; the request body becomes the event
 *                  payload.  Optionally verified via HMAC-SHA256.
 *  - **manual**  — programmatic or CLI invocation.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import type {
  TriggerDefinition,
  TriggerEvent,
  TriggerRun,
  PipelineResult,
} from "../../types/index.js";
import { saveTriggerRun } from "../runs/runStore.js";
import { runAutonomousTask } from "../pipeline/autonomous.js";
import { listAllTriggers } from "./triggerStore.js";
import {
  parseInterval,
  parseCron,
  matchesCron,
  classifySchedule,
  matchesMonthlyDay,
  matchesMonthlyOrdinal,
  type CronFields,
} from "./cronParser.js";
import { DiscordBridge, type DiscordBridgeOptions } from "../discord/discordBridge.js";

// ── Logging ────────────────────────────────────────────────────────────

const log  = (...args: unknown[]) => console.log("[trigger-engine]", ...args);
const logW = (...args: unknown[]) => console.warn("[trigger-engine]", ...args);
const logE = (...args: unknown[]) => console.error("[trigger-engine]", ...args);

// ── Template renderer ──────────────────────────────────────────────────

/**
 * Interpolate `{{path.to.value}}` placeholders in a task template with
 * values from the trigger event.
 *
 * Supported top-level keys: `type`, `timestamp`, `payload` (and nested
 * paths within `payload`).
 */
function renderTemplate(template: string, event: TriggerEvent): string {
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

// ── Webhook signature verification ─────────────────────────────────────

function verifyWebhookSignature(
  body: string,
  secret: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  // Constant-time comparison.
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length) return false;
  // Use timingSafeEqual for constant-time compare.
  const { timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
  return timingSafeEqual(sigBuf, expBuf);
}

// ── Engine ─────────────────────────────────────────────────────────────

export interface TriggerEngineOptions {
  /** Port for the webhook HTTP server (default 7433). */
  webhookPort?: number;
  /** Maximum number of completed runs to keep in memory (default 200). */
  maxRunHistory?: number;
}

interface ActiveCronEntry {
  trigger: TriggerDefinition;
  timerId: ReturnType<typeof setInterval>;
  cronFields?: CronFields;
}

interface ActiveMonthlyEntry {
  trigger: TriggerDefinition;
  timerId: ReturnType<typeof setInterval>;
}

export class TriggerEngine extends EventEmitter {
  private running = false;
  private webhookServer: Server | null = null;
  private webhookPort: number;
  private maxRunHistory: number;

  /** Interval timers for cron-type triggers. */
  private cronEntries = new Map<string, ActiveCronEntry>();

  /** One-off trigger timeouts keyed by trigger id. */
  private oneoffTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Monthly trigger intervals keyed by trigger id. */
  private monthlyEntries = new Map<string, ActiveMonthlyEntry>();

  /**
   * Tracks the "YYYY-MM" string of the last month a monthly trigger fired,
   * so the 60 s tick loop cannot fire it twice within the same minute.
   */
  private monthlyFiredKey = new Map<string, string>();

  /** Webhook triggers indexed by their normalised path. */
  private webhookTriggers = new Map<string, TriggerDefinition>();

  /** Discord bridges indexed by trigger id. */
  private discordBridges = new Map<string, DiscordBridge>();

  /** In-memory run history (newest first). */
  private runs: TriggerRun[] = [];

  /** Last-fired timestamps keyed by trigger id. */
  private lastFired = new Map<string, number>();

  /** Run counts keyed by trigger id. */
  private runCounts = new Map<string, number>();

  constructor(opts: TriggerEngineOptions = {}) {
    super();
    this.webhookPort = opts.webhookPort ?? 7433;
    this.maxRunHistory = opts.maxRunHistory ?? 200;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /** Start the engine — load triggers and begin scheduling. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    log("starting…");

    const triggers = await listAllTriggers();
    const enabled = triggers.filter((t) => t.enabled);
    log(`loaded ${triggers.length} trigger(s), ${enabled.length} enabled`);

    let hasWebhooks = false;
    for (const t of enabled) {
      if (t.type === "cron") this.startCron(t);
      if (t.type === "oneoff") this.startOneOff(t);
      if (t.type === "monthly") this.startMonthly(t);
      if (t.type === "webhook") {
        this.registerWebhook(t);
        hasWebhooks = true;
      }
      if (t.type === "discord") {
        this.startDiscordTrigger(t).catch((err) =>
          logE(`failed to start Discord trigger "${t.name}":`, (err as Error).message),
        );
      }
    }

    if (hasWebhooks) {
      await this.startWebhookServer();
    }

    log("started");
    this.emit("started");
  }

  /** Stop the engine — clear timers, shut down webhook server. */
  async stop(): Promise<void> {
    if (!this.running) return;
    log("stopping…");

    for (const [, entry] of this.cronEntries) {
      clearInterval(entry.timerId);
    }
    this.cronEntries.clear();

    for (const [, timer] of this.oneoffTimers) {
      clearTimeout(timer);
    }
    this.oneoffTimers.clear();

    for (const [, entry] of this.monthlyEntries) {
      clearInterval(entry.timerId);
    }
    this.monthlyEntries.clear();
    this.monthlyFiredKey.clear();

    this.webhookTriggers.clear();

    // Stop all Discord bridges.
    for (const [, bridge] of this.discordBridges) {
      try {
        await bridge.stop();
      } catch (err) {
        logE("error stopping Discord bridge:", (err as Error).message);
      }
    }
    this.discordBridges.clear();

    if (this.webhookServer) {
      await new Promise<void>((resolve) => {
        this.webhookServer!.close(() => resolve());
      });
      this.webhookServer = null;
    }

    this.running = false;
    log("stopped");
    this.emit("stopped");
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ── Trigger management (runtime hot-reload) ────────────────────────

  /** Add or update a trigger at runtime (no restart needed). */
  addTrigger(trigger: TriggerDefinition): void {
    this.removeTrigger(trigger.id);
    if (!trigger.enabled) return;

    if (trigger.type === "cron") {
      this.startCron(trigger);
    } else if (trigger.type === "oneoff") {
      this.startOneOff(trigger);
    } else if (trigger.type === "monthly") {
      this.startMonthly(trigger);
    } else if (trigger.type === "webhook") {
      this.registerWebhook(trigger);
      // Start webhook server if not already running.
      if (!this.webhookServer && this.running) {
        this.startWebhookServer().catch(logE);
      }
    } else if (trigger.type === "discord") {
      this.startDiscordTrigger(trigger).catch((err) =>
        logE(`failed to start Discord trigger "${trigger.name}":`, (err as Error).message),
      );
    }
  }

  /** Remove a trigger at runtime. */
  removeTrigger(triggerId: string): void {
    const cronEntry = this.cronEntries.get(triggerId);
    if (cronEntry) {
      clearInterval(cronEntry.timerId);
      this.cronEntries.delete(triggerId);
    }
    const oneoffTimer = this.oneoffTimers.get(triggerId);
    if (oneoffTimer !== undefined) {
      clearTimeout(oneoffTimer);
      this.oneoffTimers.delete(triggerId);
    }
    const monthlyEntry = this.monthlyEntries.get(triggerId);
    if (monthlyEntry) {
      clearInterval(monthlyEntry.timerId);
      this.monthlyEntries.delete(triggerId);
      this.monthlyFiredKey.delete(triggerId);
    }
    // Remove from webhook map (iterate to find by id).
    for (const [path, t] of this.webhookTriggers) {
      if (t.id === triggerId) {
        this.webhookTriggers.delete(path);
        break;
      }
    }
    // Stop Discord bridge for this trigger.
    const bridge = this.discordBridges.get(triggerId);
    if (bridge) {
      bridge.stop().catch((err) =>
        logE("error stopping Discord bridge:", (err as Error).message),
      );
      this.discordBridges.delete(triggerId);
    }
  }

  // ── Cron scheduling ────────────────────────────────────────────────

  private startCron(trigger: TriggerDefinition): void {
    if (!trigger.schedule) {
      logW(`cron trigger "${trigger.name}" has no schedule — skipping`);
      return;
    }

    const kind = classifySchedule(trigger.schedule);

    if (kind === "interval") {
      const ms = parseInterval(trigger.schedule)!;
      log(`cron (interval) "${trigger.name}" — every ${ms}ms`);
      const timerId = setInterval(() => this.fireCronTrigger(trigger), ms);
      this.cronEntries.set(trigger.id, { trigger, timerId });
    } else {
      // Standard cron: check every 60 s whether the current minute matches.
      const cronFields = parseCron(trigger.schedule);
      log(`cron (expression) "${trigger.name}" — ${trigger.schedule}`);
      const timerId = setInterval(() => {
        if (matchesCron(cronFields, new Date())) {
          this.fireCronTrigger(trigger);
        }
      }, 60_000);
      this.cronEntries.set(trigger.id, { trigger, timerId, cronFields });

      // Also check immediately on registration.
      if (matchesCron(cronFields, new Date())) {
        this.fireCronTrigger(trigger);
      }
    }
  }

  private fireCronTrigger(trigger: TriggerDefinition): void {
    const event: TriggerEvent = {
      type: "cron",
      payload: { schedule: trigger.schedule },
      timestamp: Date.now(),
    };
    this.executeTrigger(trigger, event).catch(logE);
  }

  // ── One-off scheduling ──────────────────────────────────────

  private startOneOff(trigger: TriggerDefinition): void {
    if (!trigger.runAt) {
      logW(`one-off trigger "${trigger.name}" has no runAt timestamp — skipping`);
      return;
    }

    const delay = trigger.runAt - Date.now();

    // If the fire time has already passed by more than 60 s, skip it and
    // disable the trigger so it doesn't re-arm on the next engine start.
    if (delay < -60_000) {
      logW(`one-off trigger "${trigger.name}" runAt is in the past — disabling`);
      import("./triggerStore.js").then(({ updateTriggerDefinition }) => {
        updateTriggerDefinition(trigger.id, { enabled: false }).catch(logE);
      }).catch(logE);
      return;
    }

    const effectiveDelay = Math.max(0, delay);
    log(`one-off "${trigger.name}" fires in ${Math.round(effectiveDelay / 1000)}s`);

    const timerId = setTimeout(() => {
      this.oneoffTimers.delete(trigger.id);
      const event: TriggerEvent = {
        type: "oneoff",
        payload: { runAt: trigger.runAt },
        timestamp: Date.now(),
      };
      this.executeTrigger(trigger, event)
        .then(() => {
          // Auto-disable so it never fires again.
          import("./triggerStore.js").then(({ updateTriggerDefinition }) => {
            updateTriggerDefinition(trigger.id, { enabled: false }).catch(logE);
          }).catch(logE);
        })
        .catch(logE);
    }, effectiveDelay);

    this.oneoffTimers.set(trigger.id, timerId);
  }

  // ── Monthly scheduling ────────────────────────────────────────

  private startMonthly(trigger: TriggerDefinition): void {
    const hour   = trigger.monthlyHour   ?? 9;
    const minute = trigger.monthlyMinute ?? 0;
    log(`monthly "${trigger.name}" — type:${trigger.monthlyType} h:${hour} m:${minute}`);

    const timerId = setInterval(() => {
      const now = new Date();
      let matches = false;

      if (trigger.monthlyType === "day") {
        const day = trigger.monthlyDay ?? 1;
        matches = matchesMonthlyDay(day, hour, minute, now);
      } else if (trigger.monthlyType === "ordinal") {
        const ordinal  = trigger.monthlyOrdinal  ?? "first";
        const weekday  = trigger.monthlyWeekday  ?? 1;  // Monday default
        matches = matchesMonthlyOrdinal(ordinal, weekday, hour, minute, now);
      }

      if (!matches) return;

      // Guard: only fire once per calendar month.
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      if (this.monthlyFiredKey.get(trigger.id) === monthKey) return;
      this.monthlyFiredKey.set(trigger.id, monthKey);

      const event: TriggerEvent = {
        type: "monthly",
        payload: {
          monthlyType:    trigger.monthlyType,
          monthlyDay:     trigger.monthlyDay,
          monthlyOrdinal: trigger.monthlyOrdinal,
          monthlyWeekday: trigger.monthlyWeekday,
          hour,
          minute,
        },
        timestamp: Date.now(),
      };
      this.executeTrigger(trigger, event).catch(logE);
    }, 60_000);

    this.monthlyEntries.set(trigger.id, { trigger, timerId });

    // Check immediately on registration (handles the case where the engine
    // restarted during the exact fire minute).
    const now = new Date();
    let immediateMatch = false;
    if (trigger.monthlyType === "day") {
      immediateMatch = matchesMonthlyDay(trigger.monthlyDay ?? 1, hour, minute, now);
    } else if (trigger.monthlyType === "ordinal") {
      immediateMatch = matchesMonthlyOrdinal(
        trigger.monthlyOrdinal ?? "first",
        trigger.monthlyWeekday ?? 1,
        hour,
        minute,
        now,
      );
    }
    if (immediateMatch) {
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      if (this.monthlyFiredKey.get(trigger.id) !== monthKey) {
        this.monthlyFiredKey.set(trigger.id, monthKey);
        const event: TriggerEvent = {
          type: "monthly",
          payload: { monthlyType: trigger.monthlyType, hour, minute },
          timestamp: Date.now(),
        };
        this.executeTrigger(trigger, event).catch(logE);
      }
    }
  }

  // ── Webhook ────────────────────────────────────────────────────────

  private registerWebhook(trigger: TriggerDefinition): void {
    const path = this.normaliseWebhookPath(trigger.webhookPath || `/hooks/${trigger.id}`);
    this.webhookTriggers.set(path, trigger);
    log(`webhook "${trigger.name}" registered at ${path}`);
  }

  private normaliseWebhookPath(p: string): string {
    const cleaned = p.startsWith("/") ? p : `/${p}`;
    return cleaned.replace(/\/+$/, "");
  }

  private async startWebhookServer(): Promise<void> {
    if (this.webhookServer) return;

    this.webhookServer = createServer((req, res) => this.handleWebhookRequest(req, res));

    return new Promise((resolve, reject) => {
      this.webhookServer!.on("error", (err) => {
        logE(`webhook server error: ${err.message}`);
        reject(err);
      });
      this.webhookServer!.listen(this.webhookPort, () => {
        log(`webhook server listening on port ${this.webhookPort}`);
        resolve();
      });
    });
  }

  private handleWebhookRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only accept POST.
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const path = this.normaliseWebhookPath(req.url ?? "/");
    const trigger = this.webhookTriggers.get(path);

    if (!trigger) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No trigger registered for this path" }));
      return;
    }

    // Read body.
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");

      // Verify HMAC if secret is set.
      if (trigger.webhookSecret) {
        const sig = req.headers["x-nyteshift-signature"] as string | undefined;
        if (!verifyWebhookSignature(body, trigger.webhookSecret, sig)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid signature" }));
          return;
        }
      }

      let payload: Record<string, unknown>;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        payload = { raw: body };
      }

      const event: TriggerEvent = {
        type: "webhook",
        payload,
        timestamp: Date.now(),
      };

      // Fire asynchronously — respond immediately with 202 Accepted.
      const runId = randomUUID();
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: true, runId }));

      this.executeTrigger(trigger, event).catch(logE);
    });
  }

  // ── Discord ─────────────────────────────────────────────────────────

  /**
   * Start a Discord bridge for a trigger definition.
   * The bridge connects to Discord and routes incoming messages to the
   * agent via either trigger mode (one-shot) or bridge mode (persistent chat).
   */
  private async startDiscordTrigger(trigger: TriggerDefinition): Promise<void> {
    if (!trigger.discordBotToken) {
      logW(`discord trigger "${trigger.name}" has no bot token — skipping`);
      return;
    }

    const bridge = new DiscordBridge({
      botToken: trigger.discordBotToken,
      agentName: trigger.agentName,
      guildId: trigger.discordGuildId,
      channelIds: trigger.discordChannelIds,
      mentionOnly: trigger.discordMentionOnly,
      mode: trigger.discordMode ?? "trigger",
      taskTemplate: trigger.taskTemplate,
      provider: trigger.provider,
      model: trigger.model,
      maxSteps: trigger.maxSteps,
    });

    // Forward bridge events as trigger runs.
    bridge.on("run:completed", (data: { mode: string; channelId: string; result: PipelineResult }) => {
      const run: TriggerRun = {
        id: require("node:crypto").randomUUID(),
        triggerId: trigger.id,
        triggerName: trigger.name,
        agentName: trigger.agentName,
        status: "completed",
        event: { type: "discord", payload: { channelId: data.channelId, mode: data.mode }, timestamp: Date.now() },
        result: data.result,
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
      this.runs.unshift(run);
      this.trimRunHistory();
      this.lastFired.set(trigger.id, Date.now());
      this.runCounts.set(trigger.id, (this.runCounts.get(trigger.id) ?? 0) + 1);
      this.emit("run:completed", run);
    });

    bridge.on("run:failed", (data: { mode: string; error: string }) => {
      const run: TriggerRun = {
        id: require("node:crypto").randomUUID(),
        triggerId: trigger.id,
        triggerName: trigger.name,
        agentName: trigger.agentName,
        status: "failed",
        event: { type: "discord", payload: { mode: data.mode }, timestamp: Date.now() },
        error: data.error,
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
      this.runs.unshift(run);
      this.trimRunHistory();
      this.emit("run:failed", run);
    });

    await bridge.start();
    this.discordBridges.set(trigger.id, bridge);
    log(`discord trigger "${trigger.name}" started (mode: ${trigger.discordMode ?? "trigger"})`);
  }

  // ── Manual fire ────────────────────────────────────────────────────

  /**
   * Manually fire a trigger by id with an optional payload.
   * This is the API used by the CLI `nyteshift triggers fire` command and
   * the UI "Run Now" button.
   */
  async fireManual(
    triggerId: string,
    payload: Record<string, unknown> = {},
  ): Promise<TriggerRun> {
    const all = await listAllTriggers();
    const trigger = all.find((t) => t.id === triggerId);
    if (!trigger) throw new Error(`Trigger "${triggerId}" not found`);

    const event: TriggerEvent = {
      type: "manual",
      payload,
      timestamp: Date.now(),
    };

    return this.executeTrigger(trigger, event);
  }

  // ── Core execution ─────────────────────────────────────────────────

  /**
   * Execute a trigger: render the task template, invoke the autonomous
   * pipeline, and record the result.
   */
  private async executeTrigger(
    trigger: TriggerDefinition,
    event: TriggerEvent,
  ): Promise<TriggerRun> {
    const runId = randomUUID();
    const task = renderTemplate(trigger.taskTemplate ?? "", event);

    const targetDesc = (trigger as any).targetType === "graph" ? `graph "${(trigger as any).targetId ?? "?"}"` : `agent "${trigger.agentName}"`;
    log(`executing trigger "${trigger.name}" (${trigger.type}) for ${targetDesc} — task: "${String(task).slice(0, 120)}"`);

    const run: TriggerRun = {
      id: runId,
      triggerId: trigger.id,
      triggerName: trigger.name,
      agentName: trigger.agentName,
      status: "running",
      event,
      startedAt: Date.now(),
    };

    this.runs.unshift(run);
    this.trimRunHistory();
    this.lastFired.set(trigger.id, Date.now());
    this.runCounts.set(trigger.id, (this.runCounts.get(trigger.id) ?? 0) + 1);
    this.emit("run:started", run);

    try {
      if ((trigger as any).targetType === "graph" && (trigger as any).targetId) {
        // Run a graph when the trigger targets a graph. Pass the trigger payload
        // as the graph input (manual fire) or fall back to any configured
        // `triggerInput` on the definition.
        const { runGraphTracked } = await import("../graph/graphRunRegistry.js");
        const graphInput = (event.payload as Record<string, unknown>) ?? trigger.triggerInput ?? {};
        const { result: graphResult } = await runGraphTracked(
          (trigger as any).targetId,
          { input: graphInput, provider: trigger.provider, model: trigger.model },
          { source: "trigger", triggerId: trigger.id, triggerName: trigger.name, triggerType: trigger.type },
        );

        run.status = "completed";
        run.result = graphResult as any;
        run.completedAt = Date.now();

        // Persist run (best-effort)
        try { void saveTriggerRun(run).catch(() => {}); } catch {}

        log(`trigger "${trigger.name}" completed — graph trace="${(graphResult as any)?.traceId ?? ""}"`);
        this.emit("run:completed", run);
      } else {
        const result: PipelineResult = await runAutonomousTask(
          trigger.agentName,
          task,
          {
            provider: trigger.provider,
            model: trigger.model,
            maxSteps: trigger.maxSteps ?? 10,
          },
        );

        run.status = "completed";
        run.result = result;
        run.completedAt = Date.now();

        // Persist run (best-effort)
        try { void saveTriggerRun(run).catch(() => {}); } catch {}

        log(`trigger "${trigger.name}" completed — output: "${result.finalOutput.slice(0, 120)}"`);
        this.emit("run:completed", run);
      }
    } catch (err) {
      run.status = "failed";
      run.error = (err as Error).message ?? String(err);
      run.completedAt = Date.now();

      // Persist failed run (best-effort)
      try { void saveTriggerRun(run).catch(() => {}); } catch {}

      logE(`trigger "${trigger.name}" failed:`, run.error);
      this.emit("run:failed", run);
    }

    return run;
  }

  // ── Run history ────────────────────────────────────────────────────

  /** Get all runs, optionally filtered by agent or trigger. */
  getRuns(filter?: { agentName?: string; triggerId?: string }): TriggerRun[] {
    if (!filter) return [...this.runs];
    return this.runs.filter((r) => {
      if (filter.agentName && r.agentName !== filter.agentName) return false;
      if (filter.triggerId && r.triggerId !== filter.triggerId) return false;
      return true;
    });
  }

  /** Get status summary for a trigger. */
  getTriggerStatus(trigger: TriggerDefinition): {
    active: boolean;
    lastFired?: number;
    runCount: number;
    lastResult?: "success" | "error";
  } {
    const isActive =
      this.cronEntries.has(trigger.id) ||
      this.oneoffTimers.has(trigger.id) ||
      this.monthlyEntries.has(trigger.id) ||
      [...this.webhookTriggers.values()].some((t) => t.id === trigger.id) ||
      (this.discordBridges.get(trigger.id)?.isRunning ?? false);

    const recentRun = this.runs.find((r) => r.triggerId === trigger.id);

    return {
      active: isActive,
      lastFired: this.lastFired.get(trigger.id),
      runCount: this.runCounts.get(trigger.id) ?? 0,
      lastResult: recentRun
        ? recentRun.status === "completed"
          ? "success"
          : recentRun.status === "failed"
            ? "error"
            : undefined
        : undefined,
    };
  }

  private trimRunHistory(): void {
    if (this.runs.length > this.maxRunHistory) {
      this.runs = this.runs.slice(0, this.maxRunHistory);
    }
  }

  /** Merge persisted runs into the in-memory history (newest-first). */
  addPersistedRuns(runs: TriggerRun[]): void {
    if (!runs || runs.length === 0) return;
    this.runs = [...runs, ...this.runs];
    this.trimRunHistory();
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

let _engine: TriggerEngine | null = null;

/** Get (or create) the singleton TriggerEngine instance. */
export function getTriggerEngine(opts?: TriggerEngineOptions): TriggerEngine {
  if (!_engine) {
    _engine = new TriggerEngine(opts);
  }
  return _engine;
}
