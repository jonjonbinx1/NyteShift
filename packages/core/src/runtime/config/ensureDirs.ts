import { mkdir } from "node:fs/promises";
import {
  solixHome,
  skillsDir,
  toolsDir,
  agentsDir,
  triggersDir,
} from "../../utils/index.js";

/**
 * Ensure all required ~/.solix sub-directories exist.
 * Safe to call on every startup — mkdir is no-op when dirs already exist.
 */
export async function ensureSolixDirs(): Promise<void> {
  const dirs = [
    solixHome(),
    skillsDir(),
    toolsDir(),
    agentsDir(),
    triggersDir(),
  ];

  await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })));
}
