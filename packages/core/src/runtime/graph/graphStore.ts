// ── Agent Graph Store ──────────────────────────────────────────────────
//
// Filesystem-backed CRUD for graph definitions.
// Graphs are stored as individual JSON files in ~/.solix/graphs/<id>.json

import { readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { GraphDefinition } from "./types.js";
import { graphsDir, pathExists, readJsonFile, writeJsonFile } from "../../utils/index.js";

// ── Public API ─────────────────────────────────────────────────────────

/** List all saved graph definitions. */
export async function listGraphs(): Promise<GraphDefinition[]> {
  const root = graphsDir();
  if (!(await pathExists(root))) return [];

  const entries = await readdir(root);
  const graphs: GraphDefinition[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const graph = await readJsonFile<GraphDefinition>(join(root, entry));
      graphs.push(graph);
    } catch {
      // Skip malformed files
    }
  }

  return graphs;
}

/** Load a single graph by ID. Returns null if not found. */
export async function loadGraph(id: string): Promise<GraphDefinition | null> {
  const p = join(graphsDir(), `${id}.json`);
  if (!(await pathExists(p))) return null;
  return readJsonFile<GraphDefinition>(p);
}

/** Save (create or update) a graph definition. */
export async function saveGraph(graph: GraphDefinition): Promise<void> {
  const root = graphsDir();
  await mkdir(root, { recursive: true });
  graph.updatedAt = Date.now();
  if (!graph.createdAt) graph.createdAt = graph.updatedAt;
  await writeJsonFile(join(root, `${graph.id}.json`), graph);
}

/** Delete a graph by ID. Throws if not found. */
export async function deleteGraph(id: string): Promise<void> {
  const p = join(graphsDir(), `${id}.json`);
  if (!(await pathExists(p))) {
    throw new Error(`Graph "${id}" not found.`);
  }
  await unlink(p);
}
