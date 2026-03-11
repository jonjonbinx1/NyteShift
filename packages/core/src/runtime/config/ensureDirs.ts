import { mkdir } from "node:fs/promises";
import {
  nyteShiftHome,
  skillsDir,
  toolsDir,
  agentsDir,
  triggersDir,
} from "../../utils/index.js";

/**
 * Ensure all required ~/.nyteshift sub-directories exist.
 * Safe to call on every startup — mkdir is no-op when dirs already exist.
 */
export async function ensureNyteShiftDirs(): Promise<void> {
  const dirs = [
    nyteShiftHome(),
    skillsDir(),
    toolsDir(),
    agentsDir(),
    triggersDir(),
  ];

  await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })));
}
