import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { SolixConfig, AgentConfig } from "../../types/index.js";
import {
  globalConfigPath,
  agentConfigPath,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../utils/index.js";

// ── Security overrides (hard-coded guardrails) ─────────────────────────

const SECURITY_OVERRIDES: Partial<SolixConfig> = {
  // Example: cap temperature to 2.0 max
};

// ── Defaults ───────────────────────────────────────────────────────────

const GLOBAL_DEFAULTS: SolixConfig = {
  defaultProvider: "openai",
  defaultModel: "gpt-4o",
  temperature: 0.7,
  maxTokens: 4096,
};

/**
 * Resolve the merged config for a given agent.
 *
 * Precedence (highest wins):
 *   security overrides > agent config > user config > global defaults
 */
export async function resolveConfig(agentName?: string): Promise<SolixConfig> {
  let userConfig: SolixConfig = {};
  const gPath = globalConfigPath();
  if (await pathExists(gPath)) {
    userConfig = await readJsonFile<SolixConfig>(gPath);
  }

  let agentCfg: Partial<SolixConfig> = {};
  if (agentName) {
    const aPath = agentConfigPath(agentName);
    if (await pathExists(aPath)) {
      agentCfg = await readJsonFile<Partial<SolixConfig>>(aPath);
    }
  }

  return {
    ...GLOBAL_DEFAULTS,
    ...userConfig,
    ...agentCfg,
    ...SECURITY_OVERRIDES,
  };
}

/** Read user-level global config. */
export async function readGlobalConfig(): Promise<SolixConfig> {
  const p = globalConfigPath();
  if (!(await pathExists(p))) return { ...GLOBAL_DEFAULTS };
  return readJsonFile<SolixConfig>(p);
}

/** Write user-level global config. */
export async function writeGlobalConfig(config: SolixConfig): Promise<void> {
  await writeJsonFile(globalConfigPath(), config);
}

/** Read an agent's config.json. */
export async function readAgentConfig(agentName: string): Promise<AgentConfig> {
  const p = agentConfigPath(agentName);
  if (!(await pathExists(p))) {
    return { name: agentName };
  }
  return readJsonFile<AgentConfig>(p);
}

/** Write an agent's config.json. */
export async function writeAgentConfig(agentName: string, config: AgentConfig): Promise<void> {
  await writeJsonFile(agentConfigPath(agentName), config);
}
