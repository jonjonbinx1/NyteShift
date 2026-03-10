/**
 * Tool Dependency Manager
 *
 * Allows marketplace tools to declare their own npm dependencies in a
 * `package.json` file sitting alongside their `tool.js`.  Dependencies are
 * installed into the tool's own `node_modules` directory so they are
 * completely isolated from the SolixAI core package — there is no version
 * conflict risk and no write access to the host project is required.
 *
 * Resolution flow (runs once per tool, per process start):
 *   1. Look for `<toolDir>/package.json`.
 *   2. Read the `dependencies` field.
 *   3. Hash the dependencies map.
 *   4. Compare against the stored hash in `<toolDir>/.deps-lock`.
 *        • Hash matches AND every listed `node_modules/<pkg>` folder exists → skip.
 *        • Otherwise → run `npm install --prefix <toolDir> --no-save`, update hash.
 *
 * Because deps land in the tool's own `<toolDir>/node_modules`, Node's ESM
 * loader will resolve them naturally when the tool file calls `import` or
 * `require` — the tool's directory is an ancestor of every package it uses.
 *
 * The cache is in-process (Map) so the install only happens once per process
 * even if the same tool is reloaded multiple times.
 */

import { join } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { pathExists, readJsonFile } from "../../utils/index.js";

// In-process cache: toolDir → deps hash that was last verified this session.
const verified = new Map<string, string>();

/**
 * Remove the cached verification entry for a tool directory, forcing the next
 * `ensureToolDeps` call to re-check and potentially re-install dependencies.
 * Called by the tool loader whenever it detects a tool file has changed.
 */
export function clearVerified(toolDir: string): void {
  verified.delete(toolDir);
}

/** Hash a plain object's keys+values deterministically. */
function hashDeps(deps: Record<string, string>): string {
  const stable = Object.keys(deps)
    .sort()
    .map((k) => `${k}@${deps[k]}`)
    .join(";");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

/**
 * Ensure all `dependencies` declared in `<toolDir>/package.json` are
 * installed in `<toolDir>/node_modules`.
 *
 * Safe to call on every tool load — subsequent calls for the same tool
 * directory are resolved from an in-process cache and return immediately.
 *
 * @param toolDir  Absolute path to the tool directory (contains `tool.js`).
 */
export async function ensureToolDeps(toolDir: string): Promise<void> {
  const pkgPath = join(toolDir, "package.json");
  if (!(await pathExists(pkgPath))) return; // no package.json → nothing to do

  let pkg: Record<string, unknown>;
  try {
    pkg = await readJsonFile<Record<string, unknown>>(pkgPath);
  } catch {
    console.warn(`[ToolDeps] Could not parse ${pkgPath} — skipping dep check.`);
    return;
  }

  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  if (Object.keys(deps).length === 0) return; // no deps declared

  const hash = hashDeps(deps);

  // Fast path: already verified this session with the same hash.
  if (verified.get(toolDir) === hash) return;

  // Check stored lock.
  const lockPath = join(toolDir, ".deps-lock");
  let storedHash = "";
  if (await pathExists(lockPath)) {
    try {
      const { readFile } = await import("node:fs/promises");
      storedHash = (await readFile(lockPath, "utf-8")).trim();
    } catch { /* ignore */ }
  }

  // Check if every dep's node_modules entry actually exists on disk.
  const nmDir = join(toolDir, "node_modules");
  let allPresent = true;
  if (storedHash === hash) {
    for (const pkg of Object.keys(deps)) {
      if (!(await pathExists(join(nmDir, pkg)))) {
        allPresent = false;
        break;
      }
    }
  } else {
    allPresent = false; // hash changed — need reinstall
  }

  if (allPresent) {
    verified.set(toolDir, hash);
    return;
  }

  // Install deps.
  console.log(`[ToolDeps] Installing dependencies for tool at ${toolDir} …`);
  try {
    execSync(
      // --no-save         : don't modify the tool's package.json
      // --no-package-lock : don't create/update a lock-file in the tool dir
      // --no-audit        : skip network audit round-trip
      // --prefer-offline  : use cache when available
      `npm install --prefix "${toolDir}" --no-save --no-package-lock --no-audit --prefer-offline`,
      {
        stdio: "pipe", // capture output — surface errors ourselves
        timeout: 120_000, // 2-minute safety limit
      },
    );
    console.log(`[ToolDeps] ✔ Dependencies installed for ${toolDir}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface stderr if it was captured.
    const stderr = (err as NodeJS.ErrnoException & { stderr?: Buffer })?.stderr;
    const detail = stderr ? `\n${stderr.toString().trim()}` : "";
    console.error(`[ToolDeps] ✖ npm install failed for ${toolDir}: ${msg}${detail}`);
    // Don't throw — let the tool attempt to load anyway (it may still work if
    // deps were installed by some other means, or the error is non-fatal).
    return;
  }

  // Write the lock hash so subsequent startups skip the install.
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(lockPath, hash, "utf-8");
  } catch { /* non-fatal */ }

  verified.set(toolDir, hash);
}
