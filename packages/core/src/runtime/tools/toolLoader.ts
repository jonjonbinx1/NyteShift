import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ToolContract } from "../../types/index.js";
import { toolsDir, pathExists } from "../../utils/index.js";
import { getInstalledItem } from "../marketplace/installed.js";
import { ensureToolDeps } from "./toolDeps.js";

/**
 * Scans ~/.solix/tools for tool.js modules.
 *
 * Expected layout:
 *   ~/.solix/tools/<contributor>/<tool-name>/tool.js
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
        // Ensure any dependencies declared in the tool's package.json are
        // installed into the tool's own node_modules before we import it.
        // This call is a no-op when deps are already present (cached after
        // the first check per process), so repeated loadTools() calls are cheap.
        await ensureToolDeps(join(contributorDir, toolDir));

        const mod = await import(pathToFileURL(toolPath).href);
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
