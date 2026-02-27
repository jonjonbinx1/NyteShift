/**
 * Marketplace browser — reads the cached repo directories and discovers
 * all available items.  Also handles installing (copying) items into
 * ~/.solix/<category>/<contributor>/<name>.
 */

import { readdir, cp, rm, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { pathExists, solixHome } from "../../utils/index.js";
import {
  readMarketplaceConfig,
  sourceCacheDir,
} from "./marketplaceConfig.js";
import type { MarketplaceItem, MarketplaceCategory } from "./types.js";
import matter from "gray-matter";

/** Folders to skip when scanning the repo root (e.g. .git, README, LICENSE) */
const SKIP = new Set([".git", ".github", "node_modules", ".vscode"]);

/**
 * Browse all items across all enabled marketplace sources.
 * Optionally filter by category and/or search query.
 */
export async function browseMarketplace(opts?: {
  category?: string;
  search?: string;
}): Promise<MarketplaceItem[]> {
  const cfg = await readMarketplaceConfig();
  console.log(`[Marketplace:browse] sources: ${cfg.sources.map(s => s.name).join(", ")}`);
  const allItems: MarketplaceItem[] = [];

  for (const source of cfg.sources) {
    if (!source.enabled) { console.log(`[Marketplace:browse] skipping disabled: ${source.name}`); continue; }

    const dir = sourceCacheDir(source.name);
    const exists = await pathExists(dir);
    console.log(`[Marketplace:browse] source "${source.name}" cache dir: ${dir} exists: ${exists}`);
    if (!exists) continue;

    const categories = await safeReadDir(dir);

    for (const cat of categories) {
      if (SKIP.has(cat)) continue;
      // Check it's actually a directory
      const catPath = join(dir, cat);
      if (!(await isDir(catPath))) continue;

      // If category filter given, skip non-matching
      if (opts?.category && cat !== opts.category) continue;

      const contributors = await safeReadDir(catPath);
      for (const contributor of contributors) {
        const contribPath = join(catPath, contributor);
        if (!(await isDir(contribPath))) continue;

        const items = await safeReadDir(contribPath);
        for (const itemName of items) {
          const itemPath = join(contribPath, itemName);
          if (!(await isDir(itemPath))) continue;

          const description = await extractDescription(itemPath, cat);
          const installed = await isInstalled(cat, contributor, itemName);

          allItems.push({
            source: source.name,
            category: cat,
            contributor,
            name: itemName,
            localPath: itemPath,
            installed,
            description,
          });
        }
      }
    }
  }

  // Apply search filter
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
 * List available categories across all synced marketplaces.
 */
export async function listMarketplaceCategories(): Promise<MarketplaceCategory[]> {
  const cfg = await readMarketplaceConfig();
  const cats = new Set<string>();

  for (const source of cfg.sources) {
    if (!source.enabled) continue;
    const dir = sourceCacheDir(source.name);
    if (!(await pathExists(dir))) continue;

    const entries = await safeReadDir(dir);
    for (const entry of entries) {
      if (SKIP.has(entry)) continue;
      if (await isDir(join(dir, entry))) {
        cats.add(entry);
      }
    }
  }

  return [...cats].sort();
}

/**
 * Install a marketplace item: copy it from the cache into ~/.solix/<category>/<contributor>/<name>.
 */
export async function installMarketplaceItem(item: {
  category: string;
  contributor: string;
  name: string;
  localPath: string;
}): Promise<{ installed: boolean; path: string; message: string }> {
  const dest = join(solixHome(), item.category, item.contributor, item.name);

  try {
    await cp(item.localPath, dest, { recursive: true, force: true });
    return { installed: true, path: dest, message: `Installed ${item.category}/${item.contributor}/${item.name}` };
  } catch (err) {
    return {
      installed: false,
      path: dest,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Uninstall a marketplace item: remove ~/.solix/<category>/<contributor>/<name>.
 */
export async function uninstallMarketplaceItem(item: {
  category: string;
  contributor: string;
  name: string;
}): Promise<{ message: string }> {
  const dest = join(solixHome(), item.category, item.contributor, item.name);
  try {
    await rm(dest, { recursive: true, force: true });
    return { message: `Uninstalled ${item.category}/${item.contributor}/${item.name}` };
  } catch (err) {
    return { message: err instanceof Error ? err.message : String(err) };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

async function isDir(p: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function safeReadDir(p: string): Promise<string[]> {
  try {
    return await readdir(p);
  } catch {
    return [];
  }
}

async function isInstalled(category: string, contributor: string, name: string): Promise<boolean> {
  return pathExists(join(solixHome(), category, contributor, name));
}

/**
 * Try to extract a description from the item folder:
 * 1. If a README.md exists, use first non-heading line
 * 2. If a .md file with frontmatter exists, use frontmatter.description
 * 3. Otherwise return ""
 */
async function extractDescription(itemPath: string, _category: string): Promise<string> {
  // Try README.md
  const readmePath = join(itemPath, "README.md");
  if (await pathExists(readmePath)) {
    try {
      const content = await readFile(readmePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      return lines[0]?.trim().slice(0, 200) ?? "";
    } catch { /* ignore */ }
  }

  // Try any .md file with frontmatter
  const files = await safeReadDir(itemPath);
  for (const f of files) {
    if (!f.endsWith(".md") || f === "README.md") continue;
    try {
      const content = await readFile(join(itemPath, f), "utf-8");
      const parsed = matter(content);
      if (parsed.data?.description) return String(parsed.data.description).slice(0, 200);
    } catch { /* ignore */ }
  }

  return "";
}
