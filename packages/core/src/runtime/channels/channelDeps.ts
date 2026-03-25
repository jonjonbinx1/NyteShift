/**
 * Channel Dependency Manager
 *
 * Mirrors the tool dependency pattern: marketplace channels can declare
 * npm dependencies in a `package.json` alongside their `channel.js`.
 * Dependencies are installed into the channel's own `node_modules/` so
 * they are completely isolated from NyteShift core.
 */

import { join } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { pathExists, readJsonFile } from "../../utils/index.js";

const verified = new Map<string, string>();

export function clearVerified(channelDir: string): void {
  verified.delete(channelDir);
}

function hashDeps(deps: Record<string, string>): string {
  const stable = Object.keys(deps)
    .sort()
    .map((k) => `${k}@${deps[k]}`)
    .join(";");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

export async function ensureChannelDeps(channelDir: string): Promise<void> {
  const pkgPath = join(channelDir, "package.json");
  if (!(await pathExists(pkgPath))) return;

  const pkg = await readJsonFile<{ dependencies?: Record<string, string> }>(pkgPath);
  const deps = pkg.dependencies;
  if (!deps || Object.keys(deps).length === 0) return;

  const hash = hashDeps(deps);
  if (verified.get(channelDir) === hash) return;

  const lockPath = join(channelDir, ".deps-lock");
  const { readFile, writeFile } = await import("node:fs/promises");

  let storedHash: string | undefined;
  try {
    storedHash = (await readFile(lockPath, "utf-8")).trim();
  } catch {
    /* first run */
  }

  if (storedHash === hash) {
    // Verify all packages actually exist on disk.
    let allPresent = true;
    for (const name of Object.keys(deps)) {
      if (!(await pathExists(join(channelDir, "node_modules", name)))) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) {
      verified.set(channelDir, hash);
      return;
    }
  }

  console.log(`[ChannelDeps] Installing dependencies for ${channelDir}…`);
  execSync("npm install --no-save", { cwd: channelDir, stdio: "pipe" });
  await writeFile(lockPath, hash + "\n", "utf-8");
  verified.set(channelDir, hash);
}
