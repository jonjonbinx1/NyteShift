import { join } from "node:path";
import { nyteShiftHome, readJsonFile, writeJsonFile, pathExists } from "../../utils/index.js";
import { computeDirectoryHash } from "../../utils/index.js";
import { installMarketplaceItem } from "./marketplaceBrowser.js";
import {
  parseGithubUrl,
  fetchRepoTree,
  type GitTreeEntry,
} from "./marketplaceRemote.js";
import { readMarketplaceConfig } from "./marketplaceConfig.js";

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
  /**
   * The git tree-object SHA of the item directory at install time.
   * Used to detect remote updates without downloading the whole item.
   */
  remoteTreeSha?: string;
  /** Name of the marketplace source this item was installed from. */
  sourceN?: string;
}

export interface InstalledIndex {
  /** global default.  If true, all items will auto-update unless they have
   * an explicit `autoUpdate` boolean set.  Stored in the same file for
   * convenience so state doesn't get lost when migrating. */
  globalAutoUpdate?: boolean;
  items: InstalledItem[];
}

const INSTALLED_INDEX_PATH = join(nyteShiftHome(), "installed.json");

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
  let item = await getInstalledItem(category, contributor, name);
  if (!item) {
    // Item exists on disk but was not yet tracked in installed.json (e.g. it
    // was installed before the index-tracking system was introduced).
    // Auto-register it now so subsequent operations work correctly.
    const dest = join(nyteShiftHome(), category, contributor, name);
    if (!(await pathExists(dest))) {
      throw new Error(`Item not installed: ${category}/${contributor}/${name}`);
    }
    console.log(`[installed] Auto-registering untracked item: ${category}/${contributor}/${name}`);
    const hash = await computeDirectoryHash(dest);
    item = { category, contributor, name, hash, autoUpdate: enabled };
    await saveInstalledItem(item);
    return;
  }
  item.autoUpdate = enabled;
  await saveInstalledItem(item);
}

/**
 * Scan ~/.nyteshift/skills and ~/.nyteshift/tools for items that exist on disk but
 * are not yet recorded in installed.json (e.g. items installed before the
 * index-tracking system was introduced).  Missing entries are registered
 * with a computed directory hash and default autoUpdate=false.
 *
 * This is safe to call at startup — it is additive-only and never removes
 * or modifies existing index entries.
 */
export async function reconcileInstalledItems(): Promise<void> {
  const { readdir, stat } = await import("node:fs/promises");
  const categories = ["skills", "tools"] as const;

  for (const category of categories) {
    const root = join(nyteShiftHome(), category);
    if (!(await pathExists(root))) continue;

    let contributors: string[];
    try { contributors = await readdir(root); } catch { continue; }

    for (const contributor of contributors) {
      const contribPath = join(root, contributor);
      let st: import("node:fs").Stats;
      try { st = await stat(contribPath); } catch { continue; }
      if (!st.isDirectory()) continue;

      let itemNames: string[];
      try { itemNames = await readdir(contribPath); } catch { continue; }

      for (const itemName of itemNames) {
        const itemPath = join(contribPath, itemName);
        try { st = await stat(itemPath); } catch { continue; }
        if (!st.isDirectory()) continue;

        const existing = await getInstalledItem(category, contributor, itemName);
        if (!existing) {
          try {
            const hash = await computeDirectoryHash(itemPath);
            await saveInstalledItem({ category, contributor, name: itemName, hash });
            console.log(`[installed] Reconciled untracked item: ${category}/${contributor}/${itemName}`);
          } catch (err) {
            console.warn(`[installed] Failed to reconcile ${category}/${contributor}/${itemName}:`, err);
          }
        }
      }
    }
  }
}

export async function setGlobalAutoUpdate(enabled: boolean): Promise<void> {
  const idx = await readInstalledIndex();
  idx.globalAutoUpdate = enabled;
  await writeInstalledIndex(idx);
}

/**
 * Compute a tree SHA for a given item path across all enabled sources.
 * Returns undefined if not found or on error.
 */
async function getRemoteTreeSha(
  category: string,
  contributor: string,
  name: string,
): Promise<string | undefined> {
  const cfg = await readMarketplaceConfig();
  const itemPath = `${category}/${contributor}/${name}`;

  for (const source of cfg.sources) {
    if (!source.enabled) continue;
    const coords = parseGithubUrl(source.url);
    if (!coords) continue;
    const branch = source.branch ?? "main";
    try {
      const entries = await fetchRepoTree(coords.owner, coords.repo, branch);
      // Look for the tree entry for the item directory
      const treeEntry = entries.find(
        (e): e is GitTreeEntry & { type: "tree" } =>
          e.type === "tree" && e.path === itemPath,
      );
      if (treeEntry) {
        // The tree response may include a `sha` field; cast through unknown
        return (treeEntry as unknown as { sha?: string }).sha;
      }
    } catch { /* ignore, try next source */ }
  }
  return undefined;
}

/**
 * @deprecated Local-cache hashing is no longer used.
 * Kept only for backward compatibility with any external callers.
 */
export async function hashOfCachePath(_cachePath: string): Promise<string> {
  return "";
}

/**
 * Check a single installed item against the remote repo to see if an update
 * is available.  Uses git tree-object SHAs to detect changes without
 * downloading the full item.  If an update exists and autoUpdate is enabled
 * (or `force` is true), downloads and re-installs the item.
 */
export async function checkAndUpdateItem(
  category: string,
  contributor: string,
  name: string,
  force = false,
): Promise<{ updated: boolean; message: string }> {
  const installed = await getInstalledItem(category, contributor, name);
  if (!installed) {
    return { updated: false, message: "Item not installed" };
  }

  const remoteSha = await getRemoteTreeSha(category, contributor, name);
  if (!remoteSha) {
    return { updated: false, message: "Item not found in any enabled marketplace source" };
  }

  const hasUpdate = installed.remoteTreeSha ? remoteSha !== installed.remoteTreeSha : true;
  if (!hasUpdate) {
    return { updated: false, message: "Already up to date" };
  }

  const shouldUpdate = force || (installed.autoUpdate ?? false);
  if (!shouldUpdate) {
    return { updated: false, message: "Update available (auto-update disabled)" };
  }

  // Re-install from remote
  const remotePath = `${category}/${contributor}/${name}`;
  const { installed: ok, message } = await installMarketplaceItem({
    category,
    contributor,
    name,
    remotePath,
    source: installed.sourceN,
  });
  return { updated: ok, message };
}

/**
 * Look at all installed items and, depending on flags, attempt to refresh any
 * that have changed in the remote marketplace.  Returns a list of outcomes.
 */
export async function autoUpdateInstalledItems(): Promise<
  Array<{ item: InstalledItem; updated: boolean; message: string }>
> {
  const idx = await readInstalledIndex();
  const results: Array<{ item: InstalledItem; updated: boolean; message: string }> = [];

  for (const it of idx.items) {
    try {
      const remoteSha = await getRemoteTreeSha(it.category, it.contributor, it.name);
      if (!remoteSha) {
        results.push({ item: it, updated: false, message: "Not found in remote" });
        continue;
      }

      const hasUpdate = it.remoteTreeSha ? remoteSha !== it.remoteTreeSha : true;
      if (!hasUpdate) {
        results.push({ item: it, updated: false, message: "Already up to date" });
        continue;
      }

      const should = it.autoUpdate ?? idx.globalAutoUpdate ?? false;
      if (should) {
        const { updated: ok, message } = await checkAndUpdateItem(
          it.category, it.contributor, it.name, true,
        );
        results.push({ item: it, updated: ok, message });
      } else {
        results.push({ item: it, updated: false, message: "Update available" });
      }
    } catch (err) {
      results.push({ item: it, updated: false, message: (err as Error).message });
    }
  }

  return results;
}
