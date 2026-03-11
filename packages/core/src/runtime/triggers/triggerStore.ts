/**
 * Persistence layer for trigger definitions.
 *
 * Trigger definitions are stored per-agent at:
 *   ~/.nyteshift/agents/<agent-name>/triggers.json
 *
 * This keeps trigger configuration co-located with the agent it belongs to,
 * matching Anthropic's assistant-level configuration pattern.
 */

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TriggerDefinition } from "../../types/index.js";
import {
  agentsDir,
  toKebab,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../utils/index.js";
import { listAgents } from "../agents/agentManager.js";

// ── Path helper ────────────────────────────────────────────────────────

function triggersFilePath(agentName: string): string {
  return join(agentsDir(), toKebab(agentName), "triggers.json");
}

// ── CRUD operations ────────────────────────────────────────────────────

/** Read all trigger definitions for a given agent. */
export async function readAgentTriggers(agentName: string): Promise<TriggerDefinition[]> {
  const p = triggersFilePath(agentName);
  if (!(await pathExists(p))) return [];
  try {
    return await readJsonFile<TriggerDefinition[]>(p);
  } catch {
    return [];
  }
}

/** Write all trigger definitions for a given agent. */
export async function writeAgentTriggers(
  agentName: string,
  triggers: TriggerDefinition[],
): Promise<void> {
  await writeJsonFile(triggersFilePath(agentName), triggers);
}

/** List all trigger definitions across every agent. */
export async function listAllTriggers(): Promise<TriggerDefinition[]> {
  const agents = await listAgents();
  const all: TriggerDefinition[] = [];
  for (const agentName of agents) {
    const triggers = await readAgentTriggers(agentName);
    all.push(...triggers);
  }
  return all;
}

/** Create a new trigger definition for an agent. */
export async function createTriggerDefinition(
  params: Omit<TriggerDefinition, "id" | "createdAt" | "updatedAt">,
): Promise<TriggerDefinition> {
  const agentName = toKebab(params.agentName);
  const triggers = await readAgentTriggers(agentName);

  const now = Date.now();
  const trigger: TriggerDefinition = {
    ...params,
    agentName,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };

  triggers.push(trigger);
  await writeAgentTriggers(agentName, triggers);
  return trigger;
}

/** Update an existing trigger definition. */
export async function updateTriggerDefinition(
  triggerId: string,
  updates: Partial<Omit<TriggerDefinition, "id" | "createdAt">>,
): Promise<TriggerDefinition | null> {
  // Find which agent owns the trigger.
  const agents = await listAgents();
  for (const agentName of agents) {
    const triggers = await readAgentTriggers(agentName);
    const idx = triggers.findIndex((t) => t.id === triggerId);
    if (idx === -1) continue;

    const updated: TriggerDefinition = {
      ...triggers[idx],
      ...updates,
      id: triggerId,
      createdAt: triggers[idx].createdAt,
      updatedAt: Date.now(),
    };
    triggers[idx] = updated;
    await writeAgentTriggers(agentName, triggers);
    return updated;
  }
  return null;
}

/** Delete a trigger definition by id. */
export async function deleteTriggerDefinition(triggerId: string): Promise<boolean> {
  const agents = await listAgents();
  for (const agentName of agents) {
    const triggers = await readAgentTriggers(agentName);
    const idx = triggers.findIndex((t) => t.id === triggerId);
    if (idx === -1) continue;

    triggers.splice(idx, 1);
    await writeAgentTriggers(agentName, triggers);
    return true;
  }
  return false;
}

/** Look up a single trigger definition by id. */
export async function getTriggerDefinition(triggerId: string): Promise<TriggerDefinition | null> {
  const agents = await listAgents();
  for (const agentName of agents) {
    const triggers = await readAgentTriggers(agentName);
    const found = triggers.find((t) => t.id === triggerId);
    if (found) return found;
  }
  return null;
}
