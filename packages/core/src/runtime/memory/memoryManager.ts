/**
 * Agent Memory Manager — NyteShift
 *
 * Implements the "external storage" memory tier described in Anthropic's
 * augmented-LLM building-block model (https://www.anthropic.com/research/building-effective-agents).
 *
 * Design principles (grounded in Anthropic best practices):
 *
 *  1. **Explicit, not automatic** — memories are NEVER injected into the
 *     context window automatically.  The agent must call a tool to read or
 *     write them.  This prevents cross-session bleed and keeps context lean.
 *
 *  2. **Agent-scoped** — each agent has its own isolated memory store.
 *     Memories written by agent "A" cannot be read by agent "B".
 *
 *  3. **Session-independent** — unlike chat history (which is per-session),
 *     memories persist across sessions and across calling platforms (UI,
 *     CLI, Discord, triggers).
 *
 *  4. **Minimal footprint** — memories are stored as individual JSON files
 *     (one per key) under ~/.nyteshift/agents/<agentName>/memory/.  This keeps
 *     reads O(1) by key and avoids loading the entire store when only one
 *     value is needed.
 *
 * Storage layout:
 *   ~/.nyteshift/agents/<agentName>/memory/<key>.json
 *
 * Each file shape: {@link MemoryEntry}
 */

import { readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  agentsDir,
  toKebab,
  pathExists,
  writeJsonFile,
  readJsonFile,
} from "../../utils/index.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface MemoryEntry {
  /** Stable lookup key (kebab-cased on write). */
  key: string;
  /** The stored value — any JSON-serialisable data. */
  value: string;
  /**
   * Optional category tag (e.g. "preferences", "facts", "goals").
   * Used to filter results via memory_list.
   */
  category?: string;
  /**
   * Natural-language note explaining *why* this memory was stored.
   * Helps the agent reason about relevance on retrieval.
   */
  note?: string;
  /** Epoch ms when first written. */
  createdAt: number;
  /** Epoch ms of last update. */
  updatedAt: number;
}

// ── Path helper ────────────────────────────────────────────────────────

function memoryDir(agentName: string): string {
  return join(agentsDir(), toKebab(agentName), "memory");
}

function memoryPath(agentName: string, key: string): string {
  return join(memoryDir(agentName), `${toKebab(key)}.json`);
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Write (create or update) a memory entry for the given agent.
 *
 * @param agentName  The agent whose memory store to write to.
 * @param key        Stable identifier (e.g. "user_preferred_language").
 * @param value      The value to persist (any non-null string).
 * @param category   Optional grouping tag.
 * @param note       Optional human-readable explanation of what this stores.
 */
export async function writeMemory(
  agentName: string,
  key: string,
  value: string,
  category?: string,
  note?: string,
): Promise<MemoryEntry> {
  const dir = memoryDir(agentName);
  await mkdir(dir, { recursive: true });

  const p = memoryPath(agentName, key);
  const now = Date.now();

  // Preserve createdAt if updating an existing entry.
  let createdAt = now;
  if (await pathExists(p)) {
    try {
      const existing = await readJsonFile<MemoryEntry>(p);
      createdAt = existing.createdAt ?? now;
    } catch {
      // Corrupted file — treat as new.
    }
  }

  const entry: MemoryEntry = {
    key: toKebab(key),
    value,
    category,
    note,
    createdAt,
    updatedAt: now,
  };

  await writeJsonFile(p, entry);
  return entry;
}

/**
 * Read a single memory entry by key.
 * Returns `null` if the key does not exist.
 */
export async function readMemory(
  agentName: string,
  key: string,
): Promise<MemoryEntry | null> {
  const p = memoryPath(agentName, key);
  if (!(await pathExists(p))) return null;
  try {
    return await readJsonFile<MemoryEntry>(p);
  } catch {
    return null;
  }
}

/**
 * List all memory entries for an agent, optionally filtered by category.
 * Results are sorted by `updatedAt` descending (most recent first).
 */
export async function listMemories(
  agentName: string,
  category?: string,
): Promise<MemoryEntry[]> {
  const dir = memoryDir(agentName);
  if (!(await pathExists(dir))) return [];

  const entries: MemoryEntry[] = [];
  const files = await readdir(dir);

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const entry = await readJsonFile<MemoryEntry>(join(dir, file));
      if (category && entry.category !== category) continue;
      entries.push(entry);
    } catch {
      // Corrupted or partial write — skip silently.
    }
  }

  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  return entries;
}

/**
 * Delete a single memory entry by key.
 * No-ops silently if the key does not exist.
 */
export async function deleteMemory(
  agentName: string,
  key: string,
): Promise<void> {
  const p = memoryPath(agentName, key);
  if (await pathExists(p)) {
    await rm(p, { force: true });
  }
}

/**
 * Delete ALL memory entries for an agent.
 * Used for agent reset / data-deletion flows.
 */
export async function clearAllMemories(
  agentName: string,
): Promise<void> {
  const dir = memoryDir(agentName);
  if (await pathExists(dir)) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Substring / keyword search across all memory values and notes.
 * Returns entries where `query` appears (case-insensitive) in the
 * key, value, note, or category fields.
 *
 * This is a lightweight alternative to embedding-based retrieval and
 * sufficient for small-to-medium memory stores.
 */
export async function searchMemories(
  agentName: string,
  query: string,
): Promise<MemoryEntry[]> {
  const all = await listMemories(agentName);
  const q = query.toLowerCase();
  return all.filter(
    (e) =>
      e.key.toLowerCase().includes(q) ||
      e.value.toLowerCase().includes(q) ||
      (e.note ?? "").toLowerCase().includes(q) ||
      (e.category ?? "").toLowerCase().includes(q),
  );
}
