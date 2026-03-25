import { homedir } from "node:os";
import { join } from "node:path";

// ── Path helpers ───────────────────────────────────────────────────────

/** Root of the user-level NyteShift directory: ~/.nyteshift */
export function nyteShiftHome(): string {
  return join(homedir(), ".nyteshift");
}

/** ~/.nyteshift/skills */
export function skillsDir(): string {
  return join(nyteShiftHome(), "skills");
}

/** ~/.nyteshift/tools */
export function toolsDir(): string {
  return join(nyteShiftHome(), "tools");
}

/** ~/.nyteshift/channels */
export function channelsDir(): string {
  return join(nyteShiftHome(), "channels");
}

/** ~/.nyteshift/agents */
export function agentsDir(): string {
  return join(nyteShiftHome(), "agents");
}

/** ~/.nyteshift/triggers */
export function triggersDir(): string {
  return join(nyteShiftHome(), "triggers");
}

/** ~/.nyteshift/graphs */
export function graphsDir(): string {
  return join(nyteShiftHome(), "graphs");
}

/** ~/.nyteshift/runs — persisted run history */
export function runsDir(): string {
  return join(nyteShiftHome(), "runs");
}

/** ~/.nyteshift/config.json — global user config */
export function globalConfigPath(): string {
  return join(nyteShiftHome(), "config.json");
}

/** ~/.nyteshift/agents/<name>/config.json */
export function agentConfigPath(name: string): string {
  return join(agentsDir(), toKebab(name), "config.json");
}

/** ~/.nyteshift/agents/<name>/soul.md */
export function agentSoulPath(name: string): string {
  return join(agentsDir(), toKebab(name), "soul.md");
}

/** ~/.nyteshift/agents/<name>/memory/ — persistent external memory store */
export function agentMemoryDir(name: string): string {
  return join(agentsDir(), toKebab(name), "memory");
}

// ── String helpers ─────────────────────────────────────────────────────

/** Normalize any string to lowercase-kebab-case. */
export function toKebab(input: string): string {
  return input
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/gi, "")
    .toLowerCase();
}

// ── JSON helpers ───────────────────────────────────────────────────────

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(path, "utf-8");
  // Strip a UTF-8 BOM (EF BB BF) that some extraction tools or editors prepend;
  // JSON.parse throws on the BOM character otherwise.
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
}

export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export async function pathExists(p: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf-8");
}

/**
 * Compute a SHA256 hash representing the contents of all files within a
 * directory tree.  Useful for detecting changes without comparing timestamps.
 */
export async function computeDirectoryHash(dir: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const { readdir, stat, readFile } = await import("node:fs/promises");
  const hash = createHash("sha256");

  async function walk(p: string) {
    const entries = await readdir(p);
    entries.sort();
    for (const e of entries) {
      const full = join(p, e);
      const st = await stat(full);
      if (st.isDirectory()) {
        await walk(full);
      } else if (st.isFile()) {
        // incorporate relative path to avoid collisions
        hash.update(full.replace(dir, ""));
        const data = await readFile(full);
        hash.update(data);
      }
    }
  }
  await walk(dir);
  return hash.digest("hex");
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}
