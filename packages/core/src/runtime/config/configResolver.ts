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
import {
  migrateSecretsFromConfig,
  stripSecretsFromConfig,
} from "./secretStore.js";
import {
  getSecret,
  setSecret,
  deleteSecret,
  secretNameFor,
} from "./secretStore.js";
import { getTool } from "../tools/toolLoader.js";
import { getSkill } from "../skills/skillLoader.js";
import { getChannel } from "../channels/channelLoader.js";

// ── One-time migration guard ───────────────────────────────────────────

/**
 * Set to true once the migration check has run in this process so we
 * never re-migrate on every readGlobalConfig call.
 */
let _migrationChecked = false;

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
  // Run retention / persistence settings
  runRetention: {
    enabled: true,
    // Default: daily at midnight
    pruneSchedule: "daily@00:00",
    graph: { maxAgeDays: 30, maxItems: 500 },
    triggers: { maxAgeDays: 30, maxItems: 200 },
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
  const raw = await readJsonFile<NyteShiftConfig>(p);

  // Auto-migrate any secrets that are still in plaintext on first read.
  if (!_migrationChecked) {
    _migrationChecked = true;
    const { sanitized, migrated } =
      await migrateSecretsFromConfig(raw as Record<string, unknown>);
    if (migrated.length > 0) {
      console.log(
        `[config] Migrated ${migrated.length} secret(s) to secure storage: ${migrated.join(", ")}`
      );
      await writeJsonFile(p, sanitized);
      return sanitized as NyteShiftConfig;
    }
  }

  return raw;
}

/** Write user-level global config. */
export async function writeGlobalConfig(config: NyteShiftConfig): Promise<void> {
  // Never persist API keys or tokens in plaintext — strip them before writing.
  const safe = stripSecretsFromConfig(config as Record<string, unknown>);
  await writeJsonFile(globalConfigPath(), safe);
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
  kind: "skill" | "tool" | "channel",
  qualifiedName: string,
  agentName?: string,
): Promise<Record<string, unknown>> {
  const ns = kind === "skill" ? "skillConfig" : kind === "channel" ? "channelConfig" : "toolConfig";

  // Global layer
  const globalCfg = await readGlobalConfig();
  const globalValues: Record<string, unknown> =
    ((globalCfg as any)[ns] as Record<string, Record<string, unknown>> | undefined)?.[qualifiedName] ?? {};

  // Agent layer (optional)
  let agentValues: Record<string, unknown> = {};
  if (agentName) {
    const agentCfg = await readAgentConfig(agentName) as Record<string, unknown>;
    agentValues =
      ((agentCfg as any)[ns] as Record<string, Record<string, unknown>> | undefined)?.[qualifiedName] ?? {};
  }

  // Merge layers (agent overrides global)
  const merged: Record<string, unknown> = { ...globalValues, ...agentValues };

  // If the tool/skill declares config fields of type `secret`, prefer values
  // from the secret store (agent-scoped first, then global) when present.
  try {
    let configDefs: Array<{ key: string; type?: string }> = [];
    if (kind === "skill") {
      const skill = await getSkill(qualifiedName);
      configDefs = (skill?.frontmatter?.config ?? []) as Array<{ key: string; type?: string }>;
    } else if (kind === "channel") {
      const ch = await getChannel(qualifiedName);
      configDefs = (ch?.config ?? []) as Array<{ key: string; type?: string }>;
    } else {
      const tool = await getTool(qualifiedName);
      configDefs = (tool?.config ?? []) as Array<{ key: string; type?: string }>;
    }

    for (const f of configDefs) {
      if (f.type === "secret") {
        let val: string | undefined;
        if (agentName) {
          val = await getSecret(secretNameFor(kind, qualifiedName, f.key, agentName));
        }
        if (typeof val === "undefined") {
          val = await getSecret(secretNameFor(kind, qualifiedName, f.key));
        }
        if (typeof val !== "undefined") merged[f.key] = val;
      }
    }
  } catch (err) {
    // Be tolerant: if loader fails, fall back to merged config values.
    // The caller/UI can still edit values; secrets will be handled when
    // the contract definitions are available on subsequent writes.
  }

  return merged;
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
  kind: "skill" | "tool" | "channel",
  qualifiedName: string,
  values: Record<string, unknown>,
  agentName?: string,
): Promise<void> {
  const ns = kind === "skill" ? "skillConfig" : kind === "channel" ? "channelConfig" : "toolConfig";

  // If the tool/skill declares `secret` fields, persist those into the
  // secret store and remove them from the JSON config before writing.
  let persistValues: Record<string, unknown> = { ...(values ?? {}) };
  try {
    let configDefs: Array<{ key: string; type?: string }> = [];
    if (kind === "skill") {
      const skill = await getSkill(qualifiedName);
      configDefs = (skill?.frontmatter?.config ?? []) as Array<{ key: string; type?: string }>;
    } else if (kind === "channel") {
      const ch = await getChannel(qualifiedName);
      configDefs = (ch?.config ?? []) as Array<{ key: string; type?: string }>;
    } else {
      const tool = await getTool(qualifiedName);
      configDefs = (tool?.config ?? []) as Array<{ key: string; type?: string }>;
    }

    for (const f of configDefs) {
      if (f.type === "secret") {
        const v = values[f.key];
        const secretName = agentName
          ? secretNameFor(kind, qualifiedName, f.key, agentName)
          : secretNameFor(kind, qualifiedName, f.key);

        if (typeof v === "string") {
          if (v.trim() === "") {
            await deleteSecret(secretName);
          } else {
            await setSecret(secretName, v);
          }
        }

        // Ensure we never persist secret values into the JSON config.
        delete persistValues[f.key];
      }
    }
  } catch (err) {
    // If we can't obtain the contract/definitions, fall back to naive
    // behaviour (persist everything). This keeps the system tolerant to
    // loader ordering during startup.
    persistValues = { ...(values ?? {}) };
  }

  if (agentName) {
    // Agent-level
    const cfg = await readAgentConfig(agentName) as Record<string, unknown>;
    const bucket = ((cfg as any)[ns] as Record<string, Record<string, unknown>>) ?? {};
    bucket[qualifiedName] = { ...(bucket[qualifiedName] ?? {}), ...persistValues };
    (cfg as any)[ns] = bucket;
    await writeAgentConfig(agentName, cfg as any);
  } else {
    // Global level
    const cfg = await readGlobalConfig() as Record<string, unknown>;
    const bucket = ((cfg as any)[ns] as Record<string, Record<string, unknown>>) ?? {};
    bucket[qualifiedName] = { ...(bucket[qualifiedName] ?? {}), ...persistValues };
    (cfg as any)[ns] = bucket;
    await writeGlobalConfig(cfg as any);
  }
}
