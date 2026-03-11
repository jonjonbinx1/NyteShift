import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { NyteShiftConfig, AgentConfig } from "../../types/index.js";
import {
  globalConfigPath,
  agentConfigPath,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../utils/index.js";

// ── Security overrides (hard-coded guardrails) ─────────────────────────

const SECURITY_OVERRIDES: Partial<NyteShiftConfig> = {
  // Example: cap temperature to 2.0 max
};

// ── Defaults ───────────────────────────────────────────────────────────

const GLOBAL_DEFAULTS: NyteShiftConfig = {
  defaultProvider: "openai",
  defaultModel: "gpt-4o",
  temperature: 0.7,
  maxTokens: 4096,
  autoUpdate: {
    marketplace: false,
  },
};

/**
 * Resolve the merged config for a given agent.
 *
 * Precedence (highest wins):
 *   security overrides > agent config > user config > global defaults
 */
export async function resolveConfig(agentName?: string): Promise<NyteShiftConfig> {
  let userConfig: NyteShiftConfig = {};
  const gPath = globalConfigPath();
  if (await pathExists(gPath)) {
    userConfig = await readJsonFile<NyteShiftConfig>(gPath);
  }

  let agentCfg: Partial<NyteShiftConfig> = {};
  if (agentName) {
    const aPath = agentConfigPath(agentName);
    if (await pathExists(aPath)) {
      agentCfg = await readJsonFile<Partial<NyteShiftConfig>>(aPath);
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
export async function readGlobalConfig(): Promise<NyteShiftConfig> {
  const p = globalConfigPath();
  if (!(await pathExists(p))) return { ...GLOBAL_DEFAULTS };
  return readJsonFile<NyteShiftConfig>(p);
}

/** Write user-level global config. */
export async function writeGlobalConfig(config: NyteShiftConfig): Promise<void> {
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

// ── Skill / Tool Config (hierarchical) ─────────────────────────────────

/**
 * Read the resolved configuration values for a specific skill or tool.
 *
 * Resolution order (highest wins):
 *   agent-level → global (user) level → defaults from field definitions
 *
 * @param kind      "skill" or "tool"
 * @param qualifiedName  e.g. "base/search"
 * @param agentName Optional — when provided, agent-level values override global.
 */
export async function readSkillToolConfig(
  kind: "skill" | "tool",
  qualifiedName: string,
  agentName?: string,
): Promise<Record<string, unknown>> {
  const ns = kind === "skill" ? "skillConfig" : "toolConfig";

  // Global layer
  const globalCfg = await readGlobalConfig();
  const globalValues: Record<string, unknown> =
    ((globalCfg as any)[ns] as Record<string, Record<string, unknown>> | undefined)?.[qualifiedName] ?? {};

  if (!agentName) return { ...globalValues };

  // Agent layer
  const agentCfg = await readAgentConfig(agentName) as Record<string, unknown>;
  const agentValues: Record<string, unknown> =
    ((agentCfg as any)[ns] as Record<string, Record<string, unknown>> | undefined)?.[qualifiedName] ?? {};

  return { ...globalValues, ...agentValues };
}

/**
 * Write configuration values for a specific skill or tool.
 *
 * @param kind      "skill" or "tool"
 * @param qualifiedName  e.g. "base/search"
 * @param values    Key-value pairs to persist
 * @param agentName When provided, writes at the agent level; otherwise global.
 */
export async function writeSkillToolConfig(
  kind: "skill" | "tool",
  qualifiedName: string,
  values: Record<string, unknown>,
  agentName?: string,
): Promise<void> {
  const ns = kind === "skill" ? "skillConfig" : "toolConfig";

  if (agentName) {
    // Agent-level
    const cfg = await readAgentConfig(agentName) as Record<string, unknown>;
    const bucket = ((cfg as any)[ns] as Record<string, Record<string, unknown>>) ?? {};
    bucket[qualifiedName] = { ...(bucket[qualifiedName] ?? {}), ...values };
    (cfg as any)[ns] = bucket;
    await writeAgentConfig(agentName, cfg as any);
  } else {
    // Global level
    const cfg = await readGlobalConfig() as Record<string, unknown>;
    const bucket = ((cfg as any)[ns] as Record<string, Record<string, unknown>>) ?? {};
    bucket[qualifiedName] = { ...(bucket[qualifiedName] ?? {}), ...values };
    (cfg as any)[ns] = bucket;
    await writeGlobalConfig(cfg as any);
  }
}
