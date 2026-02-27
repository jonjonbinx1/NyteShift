/**
 * Marketplace sync engine.
 *
 * Clones or pulls marketplace git repos into ~/.solix/marketplace/<slug>/
 * so the browser module can read their contents.
 */

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { pathExists } from "../../utils/index.js";
import {
  readMarketplaceConfig,
  sourceCacheDir,
  marketplaceCacheDir,
} from "./marketplaceConfig.js";
import type { MarketplaceSyncResult } from "./types.js";

const exec = promisify(execFile);

/**
 * Sync all enabled marketplace sources.
 * Clones repos that don't exist locally; pulls repos that do.
 */
export async function syncAllMarketplaces(): Promise<MarketplaceSyncResult[]> {
  const cfg = await readMarketplaceConfig();
  const cacheDir = marketplaceCacheDir();
  console.log(`[Marketplace:sync] cache dir: ${cacheDir}`);
  console.log(`[Marketplace:sync] sources (${cfg.sources.length}):`, cfg.sources.map(s => `${s.name} enabled=${s.enabled} url=${s.url}`));
  await mkdir(cacheDir, { recursive: true });

  const results: MarketplaceSyncResult[] = [];

  for (const source of cfg.sources) {
    if (!source.enabled) {
      console.log(`[Marketplace:sync] skipping disabled source: ${source.name}`);
      results.push({ source: source.name, status: "disabled", message: "Source is disabled" });
      continue;
    }

    const dir = sourceCacheDir(source.name);
    const branch = source.branch ?? "main";
    console.log(`[Marketplace:sync] processing source "${source.name}" dir=${dir} branch=${branch}`);

    try {
      if (await pathExists(dir)) {
        console.log(`[Marketplace:sync] dir exists — pulling`);
        const fetchOut = await exec("git", ["-C", dir, "fetch", "origin", branch], { timeout: 60_000 });
        console.log(`[Marketplace:sync] fetch stdout: ${fetchOut.stdout.trim()} stderr: ${fetchOut.stderr.trim()}`);
        const resetOut = await exec("git", ["-C", dir, "reset", "--hard", `origin/${branch}`], { timeout: 30_000 });
        console.log(`[Marketplace:sync] reset stdout: ${resetOut.stdout.trim()}`);
        results.push({
          source: source.name,
          status: "updated",
          message: `Pulled latest from ${source.url} (${branch})`,
        });
      } else {
        console.log(`[Marketplace:sync] dir missing — cloning ${source.url}`);
        const cloneOut = await exec(
          "git",
          ["clone", "--depth", "1", "--branch", branch, source.url, dir],
          { timeout: 120_000 },
        );
        console.log(`[Marketplace:sync] clone stdout: ${cloneOut.stdout.trim()} stderr: ${cloneOut.stderr.trim()}`);
        results.push({
          source: source.name,
          status: "cloned",
          message: `Cloned ${source.url} (${branch})`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Marketplace:sync] ERROR for source "${source.name}":`, err);
      results.push({ source: source.name, status: "error", message: msg });
    }
  }

  console.log("[Marketplace:sync] final results:", results);
  return results;
}

/**
 * Sync a single marketplace source by name.
 */
export async function syncMarketplaceSource(name: string): Promise<MarketplaceSyncResult> {
  const cfg = await readMarketplaceConfig();
  const source = cfg.sources.find((s) => s.name === name);
  if (!source) {
    return { source: name, status: "error", message: `Source "${name}" not found in config` };
  }
  const results = await syncAllMarketplaces();
  return results.find((r) => r.source === name) ?? {
    source: name,
    status: "error",
    message: "Unexpected: sync did not produce a result for this source",
  };
}
