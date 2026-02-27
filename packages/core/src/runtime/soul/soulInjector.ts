import type { Message } from "../../types/index.js";
import { agentSoulPath, pathExists, readTextFile, writeTextFile } from "../../utils/index.js";

/**
 * Load the Soul.md file for an agent and return it as a system {@link Message}.
 *
 * If no soul.md exists, returns `undefined`.
 */
export async function loadSoul(agentName: string): Promise<Message | undefined> {
  const p = agentSoulPath(agentName);
  if (!(await pathExists(p))) return undefined;

  const content = await readTextFile(p);
  if (!content.trim()) return undefined;

  return { role: "system", content };
}

/**
 * Inject the Soul.md system prompt at the beginning of a message array.
 *
 * If the agent has no soul.md the messages are returned unchanged.
 */
export async function injectSoul(agentName: string, messages: Message[]): Promise<Message[]> {
  const soul = await loadSoul(agentName);
  if (!soul) return messages;
  return [soul, ...messages];
}

/** Read the raw Soul.md text. */
export async function readSoul(agentName: string): Promise<string> {
  const p = agentSoulPath(agentName);
  if (!(await pathExists(p))) return "";
  return readTextFile(p);
}

/** Write (or create) the Soul.md file. */
export async function writeSoul(agentName: string, content: string): Promise<void> {
  await writeTextFile(agentSoulPath(agentName), content);
}
