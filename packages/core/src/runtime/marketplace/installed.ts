import { join } from "node:path";
import { solixHome, readJsonFile, writeJsonFile, pathExists } from "../../utils/index.js";
import { computeDirectoryHash } from "../../utils/index.js";
import type { MarketplaceItem } from "./types.js";
import { browseMarketplace } from "./marketplaceBrowser.js";
import { installMarketplaceItem } from "./marketplaceBrowser.js";

export interface InstalledItem {
  category: string;
  contributor: string;
  name: string;
  /** version parsed from the item (skill frontmatter or tool contract) */
  version?: string;
  /** SHA256 hash of the installed directory contents */
  hash: string;
  /** Whether this item should automatically update when a new version appears */
  autoUpdate?: boolean;
}

export interface InstalledIndex {
  /** global default.  If true, all items will auto-update unless they have
   * an explicit `autoUpdate` boolean set.  Stored in the same file for
   * convenience so state doesn't get lost when migrating. */
  globalAutoUpdate?: boolean;
  items: InstalledItem[];
}

const INSTALLED_INDEX_PATH = join(solixHome(), "installed.json");

export async function readInstalledIndex(): Promise<InstalledIndex> {
  if (!(await pathExists(INSTALLED_INDEX_PATH))) {
    const idx: InstalledIndex = { items: [] };
    await writeJsonFile(INSTALLED_INDEX_PATH, idx);
    return idx;
  }
  return readJsonFile<InstalledIndex>(INSTALLED_INDEX_PATH);
}

export async function writeInstalledIndex(idx: InstalledIndex): Promise<void> {
  await writeJsonFile(INSTALLED_INDEX_PATH, idx);
}

export async function getInstalledItem(
  category: string,
  contributor: string,
  name: string,
): Promise<InstalledItem | undefined> {
  const idx = await readInstalledIndex();
  return idx.items.find(
    (i) => i.category === category && i.contributor === contributor && i.name === name,
  );
}

export async function saveInstalledItem(item: InstalledItem): Promise<void> {
  const idx = await readInstalledIndex();
  const existing = idx.items.find(
    (i) => i.category === item.category && i.contributor === item.contributor && i.name === item.name,
  );
  if (existing) {
    Object.assign(existing, item);
  } else {
    idx.items.push(item);
  }
  await writeInstalledIndex(idx);
}

export async function removeInstalledItem(
  category: string,
  contributor: string,
  name: string,
): Promise<void> {
  const idx = await readInstalledIndex();
  idx.items = idx.items.filter(
    (i) => !(i.category === category && i.contributor === contributor && i.name === name),
  );
  await writeInstalledIndex(idx);
}

export async function setItemAutoUpdate(
  category: string,
  contributor: string,
  name: string,
  enabled: boolean,
): Promise<void> {
  const item = await getInstalledItem(category, contributor, name);
  if (!item) {
    throw new Error(`Item not installed: ${category}/${contributor}/${name}`);
  }
  item.autoUpdate = enabled;
  await saveInstalledItem(item);
}

export async function setGlobalAutoUpdate(enabled: boolean): Promise<void> {
  const idx = await readInstalledIndex();
  idx.globalAutoUpdate = enabled;
  await writeInstalledIndex(idx);
}

/**
 * Compute a hash for the given marketplace cache path (not the installed copy).
 * This is used to determine whether an update is available.
 */
export async function hashOfCachePath(cachePath: string): Promise<string> {
  return computeDirectoryHash(cachePath);
}

/**
 * Check a single installed item and update it if the hash has changed.
 * Respects the `autoUpdate` flags but returns the result regardless.
 */
export async function checkAndUpdateItem(
  category: string,
  contributor: string,
  name: string,
): Promise<{ updated: boolean; message: string }> {
  const installed = await getInstalledItem(category, contributor, name);
  if (!installed) {
    return { updated: false, message: "Item not installed" };
  }

  const all = await browseMarketplace({ category });
  const match = all.find(
    (i) => i.contributor === contributor && i.name === name,
  );
  if (!match) {
    return { updated: false, message: "Marketplace item not found" };
  }

  const newHash = await hashOfCachePath(match.localPath);
  if (newHash === installed.hash) {
    return { updated: false, message: "Already up to date" };
  }

  // copy/install again (installMarketplaceItem will update metadata)
  const { installed: ok, message } = await installMarketplaceItem(match);
  return { updated: ok, message };
}

/**
 * Look at all installed items and, depending on flags, attempt to refresh any
 * that have changed in the marketplace cache.  Returns a list of outcomes.
 */
export async function autoUpdateInstalledItems(): Promise<
  Array<{ item: InstalledItem; updated: boolean; message: string }>
> {
  const idx = await readInstalledIndex();
  const all = await browseMarketplace();
  const results: Array<{ item: InstalledItem; updated: boolean; message: string }> = [];

  for (const it of idx.items) {
    const match = all.find(
      (m) => m.category === it.category && m.contributor === it.contributor && m.name === it.name,
    );
    if (!match) continue;

    try {
      const newHash = await hashOfCachePath(match.localPath);
      if (newHash !== it.hash) {
        const should = it.autoUpdate ?? idx.globalAutoUpdate ?? false;
        if (should) {
          const { installed: ok, message } = await installMarketplaceItem(match);
          results.push({ item: it, updated: ok, message });
        } else {
          results.push({ item: it, updated: false, message: "update available" });
        }
      }
    } catch (err) {
      results.push({ item: it, updated: false, message: (err as Error).message });
    }
  }

  return results;
}
