/**
 * Marketplace refresh engine.
 *
 * Previously this module cloned/pulled entire git repos.  It now operates
 * against the GitHub API only, invalidating the in-memory tree cache and
 * re-fetching the lightweight path index for each enabled source.
 *
 * Nothing is cloned or stored locally.  Individual items are only downloaded
 * when a user explicitly installs them via installMarketplaceItem().
 */

import { readMarketplaceConfig } from "./marketplaceConfig.js";
import { parseGithubUrl, invalidateTreeCache, fetchRepoTree } from "./marketplaceRemote.js";
import type { MarketplaceSyncResult } from "./types.js";

/**
 * Refresh all enabled marketplace sources.
 *
 * Invalidates the in-memory GitHub API tree cache for each source then issues
 * a fresh fetch so that subsequent browse/install calls see up-to-date data.
 */
export async function syncAllMarketplaces(): Promise<MarketplaceSyncResult[]> {
  const cfg = await readMarketplaceConfig();
  console.log(`[Marketplace:sync] refreshing ${cfg.sources.length} source(s)`);

  const results: MarketplaceSyncResult[] = [];

  for (const source of cfg.sources) {
    if (!source.enabled) {
      console.log(`[Marketplace:sync] skipping disabled source: ${source.name}`);
      results.push({ source: source.name, status: "disabled", message: "Source is disabled" });
      continue;
    }

    const coords = parseGithubUrl(source.url);
    if (!coords) {
      const msg = `URL "${source.url}" is not a GitHub URL — only GitHub sources are supported`;
      console.warn(`[Marketplace:sync] ${source.name}: ${msg}`);
      results.push({ source: source.name, status: "error", message: msg });
      continue;
    }

    const branch = source.branch ?? "main";
    try {
      // Invalidate cache so the next fetch is a real network round-trip
      invalidateTreeCache(coords.owner, coords.repo, branch);
      const entries = await fetchRepoTree(coords.owner, coords.repo, branch);
      console.log(`[Marketplace:sync] "${source.name}" — refreshed (${entries.length} entries)`);
      results.push({
        source: source.name,
        status: "updated",
        message: `Refreshed index from ${source.url} (${branch}) — ${entries.length} entries`,
      });
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
 * Refresh a single marketplace source by name.
 */
export async function syncMarketplaceSource(name: string): Promise<MarketplaceSyncResult> {
  const cfg = await readMarketplaceConfig();
  const source = cfg.sources.find((s) => s.name === name);
  if (!source) {
    return { source: name, status: "error", message: `Source "${name}" not found in config` };
  }

  const coords = parseGithubUrl(source.url);
  if (!coords) {
    return { source: name, status: "error", message: `URL "${source.url}" is not a GitHub URL` };
  }

  const branch = source.branch ?? "main";
  try {
    invalidateTreeCache(coords.owner, coords.repo, branch);
    const entries = await fetchRepoTree(coords.owner, coords.repo, branch);
    return {
      source: name,
      status: "updated",
      message: `Refreshed index from ${source.url} (${branch}) — ${entries.length} entries`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { source: name, status: "error", message: msg };
  }
}
