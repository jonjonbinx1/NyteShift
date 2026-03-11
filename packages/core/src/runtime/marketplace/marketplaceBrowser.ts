/**
 * Marketplace browser — fetches the remote repo index via the GitHub API and
 * discovers all available items without cloning or storing anything locally.
 *
 * Files are only downloaded to the user's machine when they explicitly choose
 * to install an item.  Installed items land in ~/.nyteshift/<category>/<contributor>/<name>
 * exactly as before — the user-visible behaviour is unchanged.
 */

import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { pathExists, nyteShiftHome, computeDirectoryHash } from "../../utils/index.js";
import { readMarketplaceConfig } from "./marketplaceConfig.js";
import type { MarketplaceItem, MarketplaceCategory } from "./types.js";
import {
  saveInstalledItem,
  removeInstalledItem,
  getInstalledItem,
} from "./installed.js";
import { readGlobalConfig } from "../config/configResolver.js";
import {
  parseGithubUrl,
  fetchRepoTree,
  downloadItemFiles,
  fetchRawFile,
  type GitTreeEntry,
} from "./marketplaceRemote.js";
import matter from "gray-matter";

/** Top-level folders that are not marketplace categories */
const SKIP = new Set([".git", ".github", "node_modules", ".vscode", "LICENSE", "README.md", "CHANGELOG.md"]);

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Given a flat list of GitTreeEntry objects, extract unique item directories
 * at depth-3 (category/contributor/name).
 */
function extractItemPaths(entries: GitTreeEntry[]): Array<{
  category: string;
  contributor: string;
  name: string;
  itemPath: string;
  hasReadme: boolean;
}> {
  const seen = new Set<string>();
  const items: Array<{
    category: string;
    contributor: string;
    name: string;
    itemPath: string;
    hasReadme: boolean;
  }> = [];

  const readmePaths = new Set(
    entries
      .filter((e) => e.type === "blob" && e.path.endsWith("/README.md"))
      .map((e) => e.path),
  );

  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    const parts = entry.path.split("/");
    if (parts.length < 4) continue; // need category/contributor/name/<file>

    const [category, contributor, name] = parts;
    if (SKIP.has(category)) continue;
    if (!category || !contributor || !name) continue;

    const itemPath = `${category}/${contributor}/${name}`;
    if (seen.has(itemPath)) continue;
    seen.add(itemPath);

    items.push({ category, contributor, name, itemPath, hasReadme: readmePaths.has(`${itemPath}/README.md`) });
  }
  return items;
}

function descriptionFromReadme(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  return (lines[0] ?? "").trim().slice(0, 200);
}

async function isInstalled(category: string, contributor: string, name: string): Promise<boolean> {
  return pathExists(join(nyteShiftHome(), category, contributor, name));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Browse all items across all enabled marketplace sources.
 *
 * Fetches the GitHub API repo tree (lightweight path listing — no file
 * contents) and reads README files in parallel for descriptions.
 * Nothing is written to disk.
 */
export async function browseMarketplace(opts?: {
  category?: string;
  search?: string;
}): Promise<MarketplaceItem[]> {
  const cfg = await readMarketplaceConfig();
  console.log(`[Marketplace:browse] sources: ${cfg.sources.map((s) => s.name).join(", ")}`);
  const allItems: MarketplaceItem[] = [];

  for (const source of cfg.sources) {
    if (!source.enabled) {
      console.log(`[Marketplace:browse] skipping disabled: ${source.name}`);
      continue;
    }

    const coords = parseGithubUrl(source.url);
    if (!coords) {
      console.warn(`[Marketplace:browse] source "${source.name}" has a non-GitHub URL — skipping`);
      continue;
    }

    const branch = source.branch ?? "main";
    let entries: GitTreeEntry[];
    try {
      entries = await fetchRepoTree(coords.owner, coords.repo, branch);
    } catch (err) {
      console.error(`[Marketplace:browse] failed to fetch tree for "${source.name}":`, err);
      continue;
    }

    const itemMetas = extractItemPaths(entries);
    console.log(`[Marketplace:browse] source "${source.name}" — ${itemMetas.length} item(s) found`);

    // Fetch README content in parallel for all items that have one
    const readmeMap = new Map<string, string>();
    await Promise.allSettled(
      itemMetas
        .filter((m) => m.hasReadme)
        .map(async (m) => {
          try {
            const content = await fetchRawFile(coords.owner, coords.repo, branch, `${m.itemPath}/README.md`);
            readmeMap.set(m.itemPath, content);
          } catch { /* description stays empty */ }
        }),
    );

    for (const meta of itemMetas) {
      if (opts?.category && meta.category !== opts.category) continue;

      const description = readmeMap.has(meta.itemPath)
        ? descriptionFromReadme(readmeMap.get(meta.itemPath)!)
        : "";

      const installed = await isInstalled(meta.category, meta.contributor, meta.name);
      let autoUpdate: boolean | undefined;
      // needsUpdate is expensive to check without local cache; set false here.
      // Use checkAndUpdateItem / autoUpdateInstalledItems for explicit update checks.
      const needsUpdate = false;
      if (installed) {
        try {
          const installedMeta = await getInstalledItem(meta.category, meta.contributor, meta.name);
          if (installedMeta) autoUpdate = installedMeta.autoUpdate;
        } catch { /* ignore */ }
      }

      allItems.push({
        source: source.name,
        category: meta.category,
        contributor: meta.contributor,
        name: meta.name,
        remotePath: meta.itemPath,
        localPath: "",
        installed,
        description,
        needsUpdate,
        autoUpdate,
      });
    }
  }

  if (opts?.search) {
    const q = opts.search.toLowerCase();
    return allItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.contributor.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  }

  return allItems;
}

/**
 * List available categories across all enabled marketplace sources.
 */
export async function listMarketplaceCategories(): Promise<MarketplaceCategory[]> {
  const cfg = await readMarketplaceConfig();
  const cats = new Set<string>();

  for (const source of cfg.sources) {
    if (!source.enabled) continue;
    const coords = parseGithubUrl(source.url);
    if (!coords) continue;
    const branch = source.branch ?? "main";

    try {
      const entries = await fetchRepoTree(coords.owner, coords.repo, branch);
      for (const entry of entries) {
        if (entry.type !== "blob") continue;
        const parts = entry.path.split("/");
        if (parts.length < 4) continue;
        const [cat] = parts;
        if (!SKIP.has(cat) && cat) cats.add(cat);
      }
    } catch (err) {
      console.error(`[Marketplace:categories] failed for "${source.name}":`, err);
    }
  }

  return [...cats].sort();
}

/**
 * Install a marketplace item.
 *
 * Downloads all files for the item from the remote GitHub repo into
 * ~/.nyteshift/<category>/<contributor>/<name>.
 *
 * Accepts `remotePath` (preferred, new callers) or falls back to legacy
 * `localPath` for CLI callers that still use a locally-cloned cache.
 */
export async function installMarketplaceItem(item: {
  category: string;
  contributor: string;
  name: string;
  /** Path inside the repo, e.g. "skills/contributor/itemname" */
  remotePath?: string;
  /** @deprecated Only used when calling from CLI with a locally-cloned cache. */
  localPath?: string;
  /** Name of the source to install from (defaults to first enabled source). */
  source?: string;
}): Promise<{ installed: boolean; path: string; message: string }> {
  const dest = join(nyteShiftHome(), item.category, item.contributor, item.name);

  // These are populated during the remote download path
  let remoteTreeSha: string | undefined;
  let sourceN: string | undefined;

  try {
    if (item.remotePath) {
      const cfg = await readMarketplaceConfig();
      const source = item.source
        ? cfg.sources.find((s) => s.name === item.source)
        : cfg.sources.find((s) => s.enabled);
      if (!source) throw new Error("No enabled marketplace source found");

      const coords = parseGithubUrl(source.url);
      if (!coords) throw new Error(`Source "${source.name}" does not use a GitHub URL`);

      const branch = source.branch ?? "main";
      const entries = await fetchRepoTree(coords.owner, coords.repo, branch);
      await downloadItemFiles(coords.owner, coords.repo, branch, item.remotePath, dest, entries);

      // Capture the git tree SHA of the item directory for future update detection
      remoteTreeSha = entries.find(
        (e) => e.type === "tree" && e.path === item.remotePath,
      )?.sha;
      sourceN = source.name;
    } else if (item.localPath) {
      const { cp } = await import("node:fs/promises");
      await cp(item.localPath, dest, { recursive: true, force: true });
    } else {
      throw new Error("Either remotePath or localPath must be provided");
    }

    // Extract version from installed files
    let version: string | undefined;
    try {
      if (item.category === "skills") {
        const skillPath = join(dest, "skill.md");
        if (await pathExists(skillPath)) {
          const raw = await readFile(skillPath, "utf-8");
          const parsed = matter(raw);
          version = parsed.data?.version;
        }
      } else if (item.category === "tools") {
        const toolPath = join(dest, "tool.js");
        try {
          const mod = await import(`${pathToFileURL(toolPath).href}?t=${Date.now()}`);
          const contract = mod.default ?? mod;
          version = contract.version;
        } catch { /* ignore */ }
      }
    } catch { /* ignore version extraction failures */ }

    const hash = await computeDirectoryHash(dest);
    const gcfg = await readGlobalConfig();
    const defaultAuto = (gcfg.autoUpdate?.marketplace as boolean) ?? false;
    await saveInstalledItem({
      category: item.category,
      contributor: item.contributor,
      name: item.name,
      version,
      hash,
      autoUpdate: defaultAuto,
      remoteTreeSha,
      sourceN,
    });

    return {
      installed: true,
      path: dest,
      message: `Installed ${item.category}/${item.contributor}/${item.name}`,
    };
  } catch (err) {
    return {
      installed: false,
      path: dest,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Uninstall a marketplace item: remove ~/.nyteshift/<category>/<contributor>/<name>
 * and remove it from the installed index.
 */
export async function uninstallMarketplaceItem(item: {
  category: string;
  contributor: string;
  name: string;
}): Promise<{ message: string }> {
  const dest = join(nyteShiftHome(), item.category, item.contributor, item.name);
  try {
    await rm(dest, { recursive: true, force: true });
    await removeInstalledItem(item.category, item.contributor, item.name);
    return { message: `Uninstalled ${item.category}/${item.contributor}/${item.name}` };
  } catch (err) {
    return { message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Extract a description from an already-installed item directory.
 * Used for reconciling items that were installed before the index system.
 */
export async function extractDescriptionFromDir(itemPath: string): Promise<string> {
  const readmePath = join(itemPath, "README.md");
  if (await pathExists(readmePath)) {
    try {
      const content = await readFile(readmePath, "utf-8");
      return descriptionFromReadme(content);
    } catch { /* ignore */ }
  }
  return "";
}
