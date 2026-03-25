// ── Graph Run Registry ─────────────────────────────────────────────────────
//
// Process-level singleton that tracks ALL graph runs regardless of origin:
//   - Runs started via the IPC "graph:run" handler (manual from UI)
//   - Runs started by the trigger engine (cron / webhook / manual trigger)
//   - Runs started by trigger nodes inside other graphs
//
// The Electron main process imports this module and forwards its events to
// the renderer via IPC so the UI always has a live, unified view of runs.

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { NodeOutput } from "./types.js";
import { saveGraphRun } from "../runs/runStore.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type GraphRunSource = "manual" | "trigger" | "trigger-node";
export type GraphRunStatus = "running" | "done" | "error" | "paused";

export interface GraphRunRecord {
  /** Stable identifier for this specific run. */
  runId: string;
  /** ID of the graph being executed. */
  graphId: string;
  /** Human-readable graph name at run time. */
  graphName: string;
  /** Current lifecycle state. */
  status: GraphRunStatus;
  /** Lightweight node progress entries (start + complete events). */
  nodeProgress: NodeOutput[];
  /** How this run was initiated. */
  source: GraphRunSource;
  /** Trigger ID when source is "trigger" (trigger engine). */
  triggerId?: string;
  /** Trigger name when source is "trigger". */
  triggerName?: string;
  /** Trigger type label (cron, webhook, manual, …). */
  triggerType?: string;
  /** ID of the graph that contains the trigger node, when source is "trigger-node". */
  parentGraphId?: string;
  /** Wall-clock start time (ms since epoch). */
  startedAt: number;
  /** Wall-clock completion time (ms since epoch). */
  completedAt?: number;
  /** Error message when status is "error". */
  error?: string;
  /** Serialisable result from the graph execution. */
  result?: unknown;
  /** Saved execution context when status is "paused" (manual resume). */
  pausedContext?: { vars: Record<string, unknown>; nodeOutputs: Record<string, unknown> };
  /** Node ID to resume from when status is "paused". */
  pausedResumeFrom?: string;
  /** Run ID of the original paused run this run was resumed from. */
  resumedFromRunId?: string;
}

// ── Registry class ─────────────────────────────────────────────────────────

const MAX_HISTORY = 500;

class GraphRunRegistryClass extends EventEmitter {
  private _runs = new Map<string, GraphRunRecord>();
  /** Abort controllers keyed by runId — allows any caller to cancel any run. */
  private _controllers = new Map<string, AbortController>();

  // ── Write API ────────────────────────────────────────────────────────────

  /** Register a new run (call before invoking runGraph). */
  register(record: GraphRunRecord): void {
    this._runs.set(record.runId, record);
    this.trim();
    this.emit("registered", record);
  }

  /** Merge partial updates into an existing record. */
  update(runId: string, patch: Partial<GraphRunRecord>): void {
    const r = this._runs.get(runId);
    if (!r) return;
    Object.assign(r, patch);
  }

  /** Restore persisted runs into the registry without emitting events. */
  restoreRuns(records: GraphRunRecord[]): void {
    for (const r of records) {
      this._runs.set(r.runId, r);
    }
    this.trim();
  }

  /**
   * Record that a node has started.
   * Appends a lightweight placeholder so callers can see in-progress nodes.
   */
  nodeStarted(runId: string, nodeId: string, nodeName: string, nodeType?: string): void {
    const r = this._runs.get(runId);
    if (!r) return;
    r.nodeProgress.push({
      nodeId,
      nodeType: nodeType as import("./types.js").GraphNode["type"] | undefined,
      nodeName,
      output: null,
      metadata: { elapsedMs: 0 },
      // "running" is an in-progress sentinel replaced by nodeCompleted()
      status: "running" as unknown as "success" | "error" | "skipped",
      timestamp: Date.now(),
    });
    this.emit("node:start", { runId, nodeId, nodeName, nodeType });
  }

  /**
   * Record that a node has completed.
   * Replaces the last running placeholder for the node if one exists,
   * otherwise appends the completion record.
   */
  nodeCompleted(runId: string, nodeOutput: unknown): void {
    const r = this._runs.get(runId);
    if (r) {
      const out = nodeOutput as any;
      const idx = [...r.nodeProgress]
        .reverse()
        .findIndex((p: any) => p.nodeId === out.nodeId && p.status === "running");
      if (idx >= 0) {
        // Preserve nodeType from the placeholder when present
        const prev = r.nodeProgress[r.nodeProgress.length - 1 - idx] as any;
        if (!out.nodeType && prev?.nodeType) out.nodeType = prev.nodeType;
        r.nodeProgress[r.nodeProgress.length - 1 - idx] = nodeOutput as NodeOutput;
      } else {
        r.nodeProgress.push(nodeOutput as NodeOutput);
      }
    }
    this.emit("node:complete", { runId, nodeOutput });
  }

  /** Mark the run as done or errored. */
  complete(
    runId: string,
    outcome: { result?: unknown; error?: string },
  ): void {
    const r = this._runs.get(runId);
    if (!r) return;
    const status: GraphRunStatus = outcome.error ? "error" : "done";
    Object.assign(r, {
      status,
      completedAt: Date.now(),
      result: outcome.result,
      error: outcome.error,
    });
    this.emit("run:complete", { runId, result: outcome.result, error: outcome.error });
    // Persist completed run to disk (best-effort, non-blocking)
    try {
      void saveGraphRun(r).catch(() => {});
    } catch {}
  }
  /** Mark a run as paused (waiting for manual resume). Persists state to disk. */
  pause(
    runId: string,
    pausedContext: { vars: Record<string, unknown>; nodeOutputs: Record<string, unknown> },
    pausedResumeFrom?: string,
  ): void {
    const r = this._runs.get(runId);
    if (!r) return;
    Object.assign(r, {
      status: "paused" as GraphRunStatus,
      completedAt: Date.now(),
      pausedContext,
      pausedResumeFrom,
    });
    this.emit("run:complete", { runId, result: r.result });
    try { void saveGraphRun(r).catch(() => {}); } catch {}
  }
  // ── Soft-stop API ─────────────────────────────────────────────────────────

  private _softStops = new Map<string, { requested: boolean; kind?: "manualStop" }>();
  /** Runs that were hard-aborted via `abort(runId)` (manual cancel). */
  private _manualHardAborts = new Set<string>();

  /**
   * Request a graceful stop for a run.
   *
   * Unlike `abort()`, this does NOT fire the AbortSignal immediately.
   * Instead the runner detects the flag at loop boundaries and exits the
   * current loop with exitReason "abort" so matching catch nodes still run.
   */
  requestStop(runId: string): void {
    const flag = this._softStops.get(runId);
    if (flag) { flag.requested = true; flag.kind = "manualStop"; return; }
    // If the flag hasn't been registered yet (race), create and mark it now.
    this._softStops.set(runId, { requested: true, kind: "manualStop" });
  }

  /** @internal Allocate a fresh flag for a run before it starts. */
  allocateSoftStop(runId: string): { requested: boolean; kind?: "manualStop" } {
    // Preserve any existing flag so a previous `requestStop` call made
    // before allocation (race) isn't overwritten and lost.
    const existing = this._softStops.get(runId) as { requested: boolean; kind?: "manualStop" } | undefined;
    if (existing) return existing;
    const flag = { requested: false } as { requested: boolean; kind?: "manualStop" };
    this._softStops.set(runId, flag);
    return flag;
  }

  /** @internal Clean up soft-stop flag when a run ends. */
  removeSoftStop(runId: string): void {
    this._softStops.delete(runId);
  }

  // ── Cancellation API ──────────────────────────────────────────────────────

  /** Store an AbortController so this run can be cancelled via abort(runId). */
  registerController(runId: string, controller: AbortController): void {
    this._controllers.set(runId, controller);
  }

  /** Remove a stored controller (called when run ends). */
  removeController(runId: string): void {
    this._controllers.delete(runId);
    this._manualHardAborts.delete(runId);
  }

  /**
   * Abort a tracked run by its runId.
   * Works for all run origins (manual, trigger-engine, trigger-node).
   * The run will surface as an error in the registry and throw to any
   * parent graph that is synchronously awaiting it.
   */
  abort(runId: string): void {
    try { this._manualHardAborts.add(runId); this._controllers.get(runId)?.abort(); } catch {}
    this._controllers.delete(runId);
  }

  /** Return true when the run was hard-aborted via `abort(runId)` */
  wasHardAborted(runId: string): boolean {
    return this._manualHardAborts.has(runId);
  }

  // ── Read API ──────────────────────────────────────────────────────────────

  /** Look up a single run by ID. */
  getRun(runId: string): GraphRunRecord | undefined {
    return this._runs.get(runId);
  }

  /**
   * List all tracked runs, optionally filtered.
   * Returns newest-first (by startedAt).
   */
  list(filter?: { graphId?: string }): GraphRunRecord[] {
    let all = [...this._runs.values()];
    if (filter?.graphId) all = all.filter((r) => r.graphId === filter.graphId);
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private trim(): void {
    if (this._runs.size <= MAX_HISTORY) return;
    // Never evict runs that are still active — only remove completed/errored
    // runs, oldest first.  If there are not enough finished runs to bring the
    // registry back to MAX_HISTORY we accept a temporarily oversized map
    // rather than silently dropping a live run.
    const evictable = [...this._runs.entries()]
      .filter(([, r]) => r.status !== "running" && r.status !== "paused")
      .sort(([, a], [, b]) => a.startedAt - b.startedAt);
    const excess = this._runs.size - MAX_HISTORY;
    for (let i = 0; i < Math.min(excess, evictable.length); i++) {
      this._runs.delete(evictable[i]![0]);
    }
  }
}

// ── Singleton export ───────────────────────────────────────────────────────

export const graphRunRegistry = new GraphRunRegistryClass();

// ── runGraphTracked helper ─────────────────────────────────────────────────

/** Metadata describing how a tracked run was initiated. */
export interface GraphRunMeta {
  source: GraphRunSource;
  triggerId?: string;
  triggerName?: string;
  triggerType?: string;
  parentGraphId?: string;
}

/**
 * Wraps {@link runGraph} and automatically registers the run in
 * {@link graphRunRegistry}, wiring up `onNodeStart` / `onNodeComplete`
 * callbacks and completing the record when the promise settles.
 *
 * Returns `{ runId, result }` so callers can surface the runId immediately.
 * Pass an explicit `runId` to get a predictable identifier before the run starts.
 */
export async function runGraphTracked(
  graphOrId: import("./types.js").GraphDefinition | string,
  options: import("./types.js").GraphRunOptions = {},
  meta: GraphRunMeta = { source: "manual" },
  explicitRunId?: string,
): Promise<{ runId: string; result: import("./types.js").GraphExecutionResult }> {
  // Lazy import to avoid circular dependency (graphRunner → graphRunRegistry → graphRunner).
  const { runGraph } = await import("./graphRunner.js");
  const { loadGraph } = await import("./graphStore.js");

  // Resolve graph to get id and name before the run starts.
  let graphId: string;
  let graphName: string;
  if (typeof graphOrId === "string") {
    const def = await loadGraph(graphOrId);
    graphId = graphOrId;
    graphName = def?.name ?? graphOrId;
  } else {
    graphId = graphOrId.id;
    graphName = graphOrId.name;
  }

  const runId = explicitRunId ?? `graph:${randomUUID()}`;

  const record: GraphRunRecord = {
    runId,
    graphId,
    graphName,
    status: "running",
    nodeProgress: [],
    source: meta.source,
    triggerId: meta.triggerId,
    triggerName: meta.triggerName,
    triggerType: meta.triggerType,
    parentGraphId: meta.parentGraphId,
    startedAt: Date.now(),
  };

  graphRunRegistry.register(record);

  // Create an internal AbortController so any caller can cancel this run via
  // graphRunRegistry.abort(runId), regardless of how the run was initiated.
  // If a parent signal is already provided, chain it so parent aborts cascade.
  const internalController = new AbortController();
  if (options.signal) {
    options.signal.addEventListener("abort", () => internalController.abort(), { once: true });
  }
  graphRunRegistry.registerController(runId, internalController);

  const userOnNodeStart = options.onNodeStart;
  const userOnNodeComplete = options.onNodeComplete;

  const softStop = graphRunRegistry.allocateSoftStop(runId);

  const trackedOpts: import("./types.js").GraphRunOptions = {
    ...options,
    // Replace any caller-provided signal with the chained internal one so
    // both parent-signal aborts and registry.abort(runId) propagate correctly.
    signal: internalController.signal,
    _softStop: softStop,
    _runId: runId,
    onNodeStart: (nodeId, nodeName, nodeType) => {
      graphRunRegistry.nodeStarted(runId, nodeId, nodeName, nodeType);
      userOnNodeStart?.(nodeId, nodeName, nodeType);
    },
    onNodeComplete: (output) => {
      graphRunRegistry.nodeCompleted(runId, output);
      userOnNodeComplete?.(output);
    },
  };

  try {
    const result = await runGraph(graphOrId, trackedOpts);
    if (result.status === "aborted") {
      // Surface abort as an error so parent graphs / trigger nodes observe a
      // thrown exception and can react via their error policies / catch nodes.
      graphRunRegistry.complete(runId, { error: "Run aborted" });
      throw new Error("Run aborted");
    }
    if (result.status === "paused") {
      // Manual resume: persist context so the user can resume later.
      graphRunRegistry.pause(runId, result.pausedContext!, result.pausedResumeFrom);
      return { runId, result };
    }
    graphRunRegistry.complete(runId, { result });
    return { runId, result };
  } catch (err) {
    // Only call complete if the run record is still "running" (i.e. complete
    // hasn't been called yet by the aborted-status branch above).
    const r = graphRunRegistry.getRun(runId);
    if (r?.status === "running") {
      graphRunRegistry.complete(runId, { error: (err as Error).message ?? String(err) });
    }
    throw err;
  } finally {
    graphRunRegistry.removeController(runId);
    graphRunRegistry.removeSoftStop(runId);
  }
}

/**
 * Resume a paused run from the node recorded in `run.pausedResumeFrom`.
 *
 * Creates a new tracked run using the saved context (vars + node outputs)
 * so template references to previous-run node outputs resolve correctly.
 *
 * Returns `{ runId, result }` with the NEW run's ID.
 */
export async function resumePausedRun(
  runId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ runId: string; result: import("./types.js").GraphExecutionResult }> {
  const run = graphRunRegistry.getRun(runId);
  if (!run) throw new Error(`Run "${runId}" not found in registry`);
  if (run.status !== "paused") throw new Error(`Run "${runId}" is not paused (status="${run.status}")`);
  if (!run.pausedResumeFrom) throw new Error(`Paused run "${runId}" has no resume point`);

  const { loadGraph } = await import("./graphStore.js");
  const graph = await loadGraph(run.graphId);
  if (!graph) throw new Error(`Graph "${run.graphId}" not found`);

  const newRunId = `graph:${randomUUID()}`;
  const result = await runGraphTracked(
    graph,
    {
      startFromNodeId: run.pausedResumeFrom,
      initialContext: run.pausedContext,
      signal: opts.signal,
    },
    { source: "manual" },
    newRunId,
  );
  // Tag the new run with the original run ID so the UI can link them.
  graphRunRegistry.update(newRunId, { resumedFromRunId: runId } as Partial<GraphRunRecord>);
  return result;
}
