import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ToolContract } from "../../types/index.js";
import { toolsDir, pathExists } from "../../utils/index.js";

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
        const mod = await import(pathToFileURL(toolPath).href);
        const contract: ToolContract = mod.default ?? mod;

        if (!contract.name || !contract.version || typeof contract.run !== "function") {
          console.warn(`[ToolLoader] Invalid contract in ${toolPath}, skipping.`);
          continue;
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
  return tools.find((t) => `${t.contributor}/${t.name}` === qualifiedName);
}
