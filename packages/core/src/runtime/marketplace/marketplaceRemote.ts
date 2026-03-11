/**
 * Remote marketplace fetcher.
 *
 * Uses the GitHub API to get a lightweight file-tree (just paths, no content)
 * for browsing.  Individual item files are downloaded on-demand only when the
 * user explicitly installs an item — nothing is stored locally until that
 * point, and only the requested item lands on the user's machine.
 *
 * Supported URL format:
 *   https://github.com/<owner>/<repo>[.git]
 *
 * For non-GitHub repos the functions throw a descriptive error so callers can
 * surface it in the UI.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// ── URL helpers ───────────────────────────────────────────────────────────────

export interface GithubCoords {
  owner: string;
  repo: string;
}

/**
 * Parse a GitHub HTTPS URL into owner + repo.
 * Returns null for non-GitHub URLs.
 */
export function parseGithubUrl(url: string): GithubCoords | null {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:[/?#]|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/** GitHub REST API base for a given repo */
export function githubApiBase(owner: string, repo: string): string {
  return `https://api.github.com/repos/${owner}/${repo}`;
}

/** Raw content CDN base */
export function rawContentBase(owner: string, repo: string, branch: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
}

// ── Tree fetching + in-memory cache ──────────────────────────────────────────

export interface GitTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  /** Git object SHA — stable identifier for the tree/blob content. */
  sha?: string;
}

interface TreeCacheEntry {
  fetchedAt: number;
  entries: GitTreeEntry[];
}

/** In-process cache keyed by `owner/repo/branch`.  Cleared on explicit refresh. */
const treeCache = new Map<string, TreeCacheEntry>();

/** How long tree results are considered fresh (5 minutes). */
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Return a cached (or freshly fetched) file tree for the given GitHub repo.
 *
 * Only paths are returned — no file contents are downloaded.
 */
export async function fetchRepoTree(
  owner: string,
  repo: string,
  branch: string,
): Promise<GitTreeEntry[]> {
  const key = `${owner}/${repo}/${branch}`;
  const cached = treeCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    console.log(`[Marketplace:remote] using cached tree (${cached.entries.length} entries)`);
    return cached.entries;
  }

  const url = `${githubApiBase(owner, repo)}/git/trees/${branch}?recursive=1`;
  console.log(`[Marketplace:remote] fetching tree: ${url}`);

  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "NyteShift-Marketplace-Client/1.0",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`GitHub API error ${res.status} for ${owner}/${repo}: ${body}`);
  }

  const data = (await res.json()) as { tree: GitTreeEntry[]; truncated?: boolean };
  if (data.truncated) {
    console.warn("[Marketplace:remote] tree response was truncated by GitHub API — some items may be hidden");
  }

  const entries: GitTreeEntry[] = data.tree ?? [];
  treeCache.set(key, { fetchedAt: Date.now(), entries });
  console.log(`[Marketplace:remote] tree fetched: ${entries.length} entries`);
  return entries;
}

/**
 * Invalidate the in-memory tree cache so the next browse forces a fresh fetch.
 * Pass coords to target a specific source; omit to wipe all.
 */
export function invalidateTreeCache(owner?: string, repo?: string, branch?: string): void {
  if (owner && repo && branch) {
    treeCache.delete(`${owner}/${repo}/${branch}`);
    console.log(`[Marketplace:remote] invalidated cache for ${owner}/${repo}/${branch}`);
  } else {
    treeCache.clear();
    console.log("[Marketplace:remote] invalidated all tree caches");
  }
}

// ── File downloading ──────────────────────────────────────────────────────────

/**
 * Download all files belonging to a single item (identified by its directory
 * path in the repo, e.g. `skills/contributor/itemname`) and write them to
 * `destDir` on disk.  Only called when the user explicitly installs an item.
 */
export async function downloadItemFiles(
  owner: string,
  repo: string,
  branch: string,
  itemPath: string,
  destDir: string,
  allEntries: GitTreeEntry[],
): Promise<void> {
  // normalise path separator
  const prefix = itemPath.replace(/\\/g, "/") + "/";
  const fileEntries = allEntries.filter(
    (e) => e.type === "blob" && e.path.startsWith(prefix),
  );

  if (fileEntries.length === 0) {
    throw new Error(`No files found for item at path "${itemPath}" in ${owner}/${repo}@${branch}`);
  }

  await mkdir(destDir, { recursive: true });

  // Download all files in parallel
  await Promise.all(
    fileEntries.map(async (entry) => {
      const relativePath = entry.path.slice(prefix.length);
      const destPath = join(destDir, relativePath);
      await mkdir(dirname(destPath), { recursive: true });

      const rawUrl = `${rawContentBase(owner, repo, branch)}/${entry.path}`;
      console.log(`[Marketplace:remote] downloading ${rawUrl}`);

      const fileRes = await fetch(rawUrl, {
        headers: { "User-Agent": "NyteShift-Marketplace-Client/1.0" },
      });
      if (!fileRes.ok) {
        throw new Error(`Failed to download "${entry.path}": HTTP ${fileRes.status}`);
      }
      const buf = await fileRes.arrayBuffer();
      await writeFile(destPath, Buffer.from(buf));
    }),
  );

  console.log(`[Marketplace:remote] installed ${fileEntries.length} file(s) to ${destDir}`);
}

/**
 * Download all files for an item into a fresh temporary directory.
 * The caller is responsible for deleting the directory when done.
 *
 * Useful for update-checking: download → hash → compare → optionally keep or discard.
 */
export async function downloadItemToTemp(
  owner: string,
  repo: string,
  branch: string,
  itemPath: string,
  allEntries: GitTreeEntry[],
): Promise<string> {
  const tmp = join(tmpdir(), `nyteshift-mp-${randomBytes(8).toString("hex")}`);
  await downloadItemFiles(owner, repo, branch, itemPath, tmp, allEntries);
  return tmp;
}

/**
 * Fetch the raw text content of a single file from the repo.
 * Used for description extraction (README.md, etc.).
 */
export async function fetchRawFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string> {
  const url = `${rawContentBase(owner, repo, branch)}/${path}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "NyteShift-Marketplace-Client/1.0" },
  });
  if (!res.ok) throw new Error(`Failed to fetch "${path}": HTTP ${res.status}`);
  return res.text();
}
