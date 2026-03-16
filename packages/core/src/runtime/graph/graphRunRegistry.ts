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
export type GraphRunStatus = "running" | "done" | "error";

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

  // ── Cancellation API ──────────────────────────────────────────────────────

  /** Store an AbortController so this run can be cancelled via abort(runId). */
  registerController(runId: string, controller: AbortController): void {
    this._controllers.set(runId, controller);
  }

  /** Remove a stored controller (called when run ends). */
  removeController(runId: string): void {
    this._controllers.delete(runId);
  }

  /**
   * Abort a tracked run by its runId.
   * Works for all run origins (manual, trigger-engine, trigger-node).
   * The run will surface as an error in the registry and throw to any
   * parent graph that is synchronously awaiting it.
   */
  abort(runId: string): void {
    try { this._controllers.get(runId)?.abort(); } catch {}
    this._controllers.delete(runId);
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
      .filter(([, r]) => r.status !== "running")
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

  const trackedOpts: import("./types.js").GraphRunOptions = {
    ...options,
    // Replace any caller-provided signal with the chained internal one so
    // both parent-signal aborts and registry.abort(runId) propagate correctly.
    signal: internalController.signal,
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
  }
}
