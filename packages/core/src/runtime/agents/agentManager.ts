import { readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { AgentConfig } from "../../types/index.js";
import {
  agentsDir,
  agentConfigPath,
  toKebab,
  pathExists,
  writeJsonFile,
  readJsonFile,
} from "../../utils/index.js";

/** List all agent names (kebab-case directory names). */
export async function listAgents(): Promise<string[]> {
  const root = agentsDir();
  if (!(await pathExists(root))) return [];

  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/** Create a new agent directory + default config.json. */
export async function createAgent(name: string): Promise<AgentConfig> {
  const kebab = toKebab(name);
  const dir = join(agentsDir(), kebab);

  if (await pathExists(dir)) {
    throw new Error(`Agent "${kebab}" already exists.`);
  }

  await mkdir(dir, { recursive: true });

  const config: AgentConfig = { name: kebab };
  await writeJsonFile(agentConfigPath(kebab), config);

  return config;
}

/** Delete an agent directory entirely. */
export async function deleteAgent(name: string): Promise<void> {
  const kebab = toKebab(name);
  const dir = join(agentsDir(), kebab);

  if (!(await pathExists(dir))) {
    throw new Error(`Agent "${kebab}" does not exist.`);
  }

  await rm(dir, { recursive: true, force: true });
}

/** Load an agent's config. */
export async function loadAgentConfig(name: string): Promise<AgentConfig> {
  const kebab = toKebab(name);
  const p = agentConfigPath(kebab);
  if (!(await pathExists(p))) {
    return { name: kebab };
  }
  return readJsonFile<AgentConfig>(p);
}
