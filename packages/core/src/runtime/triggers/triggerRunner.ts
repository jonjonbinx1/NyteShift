import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { TriggerEvent } from "../../types/index.js";
import { triggersDir, pathExists } from "../../utils/index.js";

/**
 * List all trigger directories under ~/.solix/triggers.
 */
export async function listTriggers(): Promise<string[]> {
  const root = triggersDir();
  if (!(await pathExists(root))) return [];

  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * Fire a trigger for a given agent.
 *
 * The trigger module is expected at:
 *   ~/.solix/triggers/<triggerName>/trigger.js
 *
 * It must default-export `{ run: (event: TriggerEvent) => Promise<void> }`.
 */
export async function fireTrigger(triggerName: string, event: TriggerEvent): Promise<void> {
  const triggerPath = join(triggersDir(), triggerName, "trigger.js");
  if (!(await pathExists(triggerPath))) {
    throw new Error(`Trigger "${triggerName}" not found at ${triggerPath}`);
  }

  const { pathToFileURL } = await import("node:url");
  const mod = await import(pathToFileURL(triggerPath).href);
  const runner = mod.default ?? mod;

  if (typeof runner.run !== "function") {
    throw new Error(`Trigger "${triggerName}" does not export a run() function.`);
  }

  await runner.run(event);
}
