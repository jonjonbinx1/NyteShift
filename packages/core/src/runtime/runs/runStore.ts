import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { GraphRunRecord } from "../graph/graphRunRegistry.js";
import type { TriggerRun } from "../../types/index.js";
import {
  runsDir,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../utils/index.js";
import { readGlobalConfig } from "../config/configResolver.js";

// Map a run/trigger identifier to a safe filename. On Windows a colon in a
// filename (e.g. `graph:<uuid>`) becomes an NTFS alternate-data-stream.
// Use the suffix (after `:`) when present and strip any unsafe characters.
function filenameForId(id: string): string {
  const base = id.includes(":") ? id.split(":").pop()! : id;
  // allow alphanumerics, dot, underscore and dash
  const safe = base.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `${safe}.json`;
}

/** List persisted graph runs (newest-first). */
export async function listPersistedGraphRuns(): Promise<GraphRunRecord[]> {
  const dir = join(runsDir(), "graphs");
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir);
  const runs: GraphRunRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const g = await readJsonFile<GraphRunRecord>(join(dir, entry));
      runs.push(g);
    } catch {
      // skip malformed
    }
  }
  return runs.sort((a, b) => b.startedAt - a.startedAt);
}

/** List persisted trigger runs (newest-first by completedAt or startedAt). */
export async function listPersistedTriggerRuns(): Promise<TriggerRun[]> {
  const dir = join(runsDir(), "triggers");
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir);
  const runs: TriggerRun[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const r = await readJsonFile<TriggerRun>(join(dir, entry));
      runs.push(r);
    } catch {
      // skip malformed
    }
  }
  return runs.sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt));
}

/** Persist a single graph run to disk. Creates directories as needed. */
export async function saveGraphRun(run: GraphRunRecord): Promise<void> {
  const dir = join(runsDir(), "graphs");
  await writeJsonFile(join(dir, filenameForId(run.runId)), run);
}

/** Persist a single trigger run to disk. */
export async function saveTriggerRun(run: TriggerRun): Promise<void> {
  const dir = join(runsDir(), "triggers");
  await writeJsonFile(join(dir, filenameForId(run.id)), run);
}

/** Prune persisted runs according to global config runRetention settings. */
export async function prunePersistedRuns(): Promise<void> {
  const cfg = await readGlobalConfig();
  const retention = (cfg as any).runRetention ?? {};
  if ((retention.enabled ?? true) === false) return;

  const graphCfg = retention.graph ?? { maxAgeDays: 30, maxItems: 500 };
  const triggerCfg = retention.triggers ?? { maxAgeDays: 30, maxItems: 200 };

  const now = Date.now();

  // Graph runs
  const gDir = join(runsDir(), "graphs");
  if (await pathExists(gDir)) {
    const graphs = await listPersistedGraphRuns();
    const maxAgeMs = (graphCfg.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000;
    for (const g of graphs) {
      if (g.status === "running") continue; // never prune an in-progress run
      const ts = g.completedAt ?? g.startedAt;
      if (ts && now - ts > maxAgeMs) {
        try { await unlink(join(gDir, filenameForId(g.runId))); } catch {}
      }
    }
    const remaining = await listPersistedGraphRuns();
    const finishedRemaining = remaining.filter((r) => r.status !== "running");
    if (graphCfg.maxItems && finishedRemaining.length > graphCfg.maxItems) {
      const toRemove = finishedRemaining.slice(graphCfg.maxItems);
      for (const r of toRemove) {
        try { await unlink(join(gDir, filenameForId(r.runId))); } catch {}
      }
    }
  }

  // Trigger runs
  const tDir = join(runsDir(), "triggers");
  if (await pathExists(tDir)) {
    const triggers = await listPersistedTriggerRuns();
    const maxAgeMs = (triggerCfg.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000;
    for (const t of triggers) {
      if ((t as any).status === "running") continue; // never prune an in-progress run
      const ts = t.completedAt ?? t.startedAt;
      if (ts && now - ts > maxAgeMs) {
        try { await unlink(join(tDir, filenameForId((t as any).id ?? String((t as any).id)))); } catch {}
      }
    }
    const remaining = await listPersistedTriggerRuns();
    const finishedTriggers = remaining.filter((r) => (r as any).status !== "running");
    if (triggerCfg.maxItems && finishedTriggers.length > triggerCfg.maxItems) {
      const toRemove = finishedTriggers.slice(triggerCfg.maxItems);
      for (const r of toRemove) {
        try { await unlink(join(tDir, filenameForId((r as any).id ?? String((r as any).id)))); } catch {}
      }
    }
  }
}

export default null as unknown as void;
