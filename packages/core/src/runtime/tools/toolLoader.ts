import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ToolContract } from "../../types/index.js";
import { toolsDir, pathExists } from "../../utils/index.js";
import { getInstalledItem } from "../marketplace/installed.js";
import { ensureToolDeps, clearVerified } from "./toolDeps.js";

// ── Module cache ───────────────────────────────────────────────────────
// Keyed by absolute tool path.  Stores the last-seen mtime and the fully-
// resolved ToolContract so unchanged tools are served from memory on every
// loadTools() call (one stat() per file, no re-import required).
// When a file's mtime changes the entry is evicted, deps are re-checked,
// and the module is re-imported via a cache-busting URL so Node's ESM
// loader treats it as a fresh module, picking up the updated code.
const moduleCache = new Map<string, { mtime: number; contract: ToolContract }>();

/**
 * Scans ~/.nyteshift/tools for tool.js modules.
 *
 * Expected layout:
 *   ~/.nyteshift/tools/<contributor>/<tool-name>/tool.js
 *
 * Each module must default-export a {@link ToolContract}.
 */
export async function loadTools(): Promise<ToolContract[]> {
  const root = toolsDir();
  if (!(await pathExists(root))) return [];

  const tools: ToolContract[] = [];
  const contributors = await readdir(root);

  for (const contributor of contributors) {
    const contributorDir = join(root, contributor);
    const cStat = await stat(contributorDir);
    if (!cStat.isDirectory()) continue;

    const toolDirs = await readdir(contributorDir);
    for (const toolDir of toolDirs) {
      const toolPath = join(contributorDir, toolDir, "tool.js");
      if (!(await pathExists(toolPath))) continue;

      try {
        // Stat the file to detect changes.  One stat() per tool per loadTools()
        // call is negligible overhead (~0.1 ms each) and lets us serve unchanged
        // tools entirely from memory while picking up edits immediately.
        const fileStat = await stat(toolPath);
        const mtime = fileStat.mtimeMs;
        const cached = moduleCache.get(toolPath);

        if (cached && cached.mtime === mtime) {
          // File unchanged — return the cached contract with no import needed.
          tools.push(cached.contract);
          continue;
        }

        // File is new or has been updated on disk.
        // Evict the deps-verified entry so ensureToolDeps re-checks the manifest.
        if (cached) {
          clearVerified(join(contributorDir, toolDir));
        }

        // Ensure any dependencies declared in the tool's package.json are
        // installed into the tool's own node_modules before we import it.
        await ensureToolDeps(join(contributorDir, toolDir));

        // Append `?t=<mtime>` to the file URL so Node's ESM loader treats this
        // as a distinct module specifier, bypassing its native registry cache
        // and loading the updated file from disk.
        const url = pathToFileURL(toolPath).href + `?t=${mtime}`;
        const mod = await import(url);
        const contract: ToolContract = mod.default ?? mod;

        // Merge a named `spec` export onto the contract when the default
        // export doesn't carry one (common authoring pattern:
        //   export default { name, run, … };
        //   export const spec = { inputSchema: { … } };
        // ).
        if (!contract.spec && mod.spec) {
          contract.spec = mod.spec;
        }

        // Same pattern for config: merge a named `config` export.
        if (!contract.config && mod.config) {
          contract.config = mod.config;
        }

        if (!contract.name || !contract.version || typeof contract.run !== "function") {
          console.warn(`[ToolLoader] Invalid contract in ${toolPath}, skipping.`);
          continue;
        }

        if (!contract.spec) {
          console.warn(
            `[ToolLoader] Tool "${contract.contributor}/${contract.name}" has no spec — ` +
            `input validation will be skipped.  Add a spec.inputSchema to enable it.`,
          );
        }

        // attach install metadata if present
        try {
          const meta = await getInstalledItem("tools", contract.contributor, contract.name);
          if (meta) {
            (contract as any).hash = meta.hash;
            (contract as any).autoUpdate = meta.autoUpdate;
            if (meta.version) contract.version = meta.version;
          }
        } catch {
          // ignore
        }

        // Store the resolved contract so the next loadTools() call is free.
        moduleCache.set(toolPath, { mtime, contract });
        tools.push(contract);
      } catch (err) {
        console.warn(`[ToolLoader] Failed to import ${toolPath}:`, err);
      }
    }
  }

  return tools;
}

/** Look up a single tool by `<contributor>/<tool-name>`. */
export async function getTool(qualifiedName: string): Promise<ToolContract | undefined> {
  const tools = await loadTools();
  if (!qualifiedName) return undefined;

  // Only accept the fully-qualified name: "contributor/name".
  return tools.find((t) => `${t.contributor}/${t.name}` === qualifiedName);
}
