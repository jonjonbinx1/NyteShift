/**
 * Channel Loader
 *
 * Scans ~/.nyteshift/channels for channel.js modules.
 *
 * Expected layout:
 *   ~/.nyteshift/channels/<contributor>/<channel-name>/channel.js
 *
 * Each module must default-export a {@link ChannelContract}.
 *
 * This mirrors the tool loader pattern: mtime-based caching, dep management,
 * cache-busting URL for ESM re-import on edits.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ChannelContract } from "../../types/index.js";
import { channelsDir, pathExists } from "../../utils/index.js";
import { getInstalledItem } from "../marketplace/installed.js";
import { ensureChannelDeps, clearVerified } from "./channelDeps.js";

// ── Module cache ───────────────────────────────────────────────────────
const moduleCache = new Map<string, { mtime: number; contract: ChannelContract }>();

/**
 * Load all installed channel adapters from `~/.nyteshift/channels/`.
 */
export async function loadChannels(): Promise<ChannelContract[]> {
  const root = channelsDir();
  if (!(await pathExists(root))) return [];

  const channels: ChannelContract[] = [];
  const contributors = await readdir(root);

  for (const contributor of contributors) {
    const contributorDir = join(root, contributor);
    const cStat = await stat(contributorDir);
    if (!cStat.isDirectory()) continue;

    const channelSubDirs = await readdir(contributorDir);
    for (const channelDir of channelSubDirs) {
      const channelPath = join(contributorDir, channelDir, "channel.js");
      if (!(await pathExists(channelPath))) continue;

      try {
        const fileStat = await stat(channelPath);
        const mtime = fileStat.mtimeMs;
        const cached = moduleCache.get(channelPath);

        if (cached && cached.mtime === mtime) {
          channels.push(cached.contract);
          continue;
        }

        if (cached) {
          clearVerified(join(contributorDir, channelDir));
        }

        await ensureChannelDeps(join(contributorDir, channelDir));

        const url = pathToFileURL(channelPath).href + `?t=${mtime}`;
        const mod = await import(url);
        const contract: ChannelContract = mod.default ?? mod;

        // Merge named exports (same pattern as tools).
        if (!contract.config && mod.config) {
          contract.config = mod.config;
        }

        if (!contract.name || !contract.version || typeof contract.start !== "function") {
          console.warn(`[ChannelLoader] Invalid contract in ${channelPath}, skipping.`);
          continue;
        }

        // Attach installed metadata if present.
        try {
          const meta = await getInstalledItem("channels", contract.contributor, contract.name);
          if (meta) {
            (contract as any).hash = meta.hash;
            (contract as any).autoUpdate = meta.autoUpdate;
            if (meta.version) contract.version = meta.version;
          }
        } catch {
          // ignore
        }

        moduleCache.set(channelPath, { mtime, contract });
        channels.push(contract);
      } catch (err) {
        console.warn(`[ChannelLoader] Failed to import ${channelPath}:`, err);
      }
    }
  }

  return channels;
}

/**
 * Retrieve a single channel contract by qualified name (`contributor/name`).
 */
export async function getChannel(qualifiedName: string): Promise<ChannelContract | undefined> {
  const channels = await loadChannels();
  return channels.find(
    (c) => `${c.contributor}/${c.name}` === qualifiedName || c.name === qualifiedName,
  );
}
