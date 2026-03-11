/**
 * Chat session persistence for NyteShift agents.
 *
 * Sessions are stored as JSON files under:
 *   ~/.nyteshift/agents/<agentName>/chats/<sessionId>.json
 *
 * Each session contains the full message history, metadata, and run state.
 */

import { readdir, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  agentsDir,
  toKebab,
  pathExists,
  writeJsonFile,
  readJsonFile,
} from "../../utils/index.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  thinking?: string;
  ts: number; // epoch ms (Date not JSON-safe)
  steps?: Array<{
    index: number;
    action: string;
    output: unknown;
    thinking?: string;
  }>;
}

export interface ChatSession {
  id: string;
  agentName: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ChatSessionSummary {
  id: string;
  agentName: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** First user message preview (truncated). */
  preview: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function chatsDir(agentName: string): string {
  return join(agentsDir(), toKebab(agentName), "chats");
}

function sessionPath(agentName: string, sessionId: string): string {
  return join(chatsDir(agentName), `${sessionId}.json`);
}

/** Auto-generate a title from the first user message. */
function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New Chat";
  const text = first.content.trim();
  if (text.length <= 50) return text;
  return text.slice(0, 47) + "…";
}

// ── Public API ─────────────────────────────────────────────────────────

/** List all chat sessions for an agent (newest first). */
export async function listChatSessions(
  agentName: string,
): Promise<ChatSessionSummary[]> {
  const dir = chatsDir(agentName);
  if (!(await pathExists(dir))) return [];

  const entries = await readdir(dir);
  const summaries: ChatSessionSummary[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const session = await readJsonFile<ChatSession>(join(dir, entry));
      const firstUser = session.messages.find((m) => m.role === "user");
      summaries.push({
        id: session.id,
        agentName: session.agentName,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        preview: firstUser
          ? firstUser.content.slice(0, 80)
          : "",
      });
    } catch {
      // Corrupted file — skip
    }
  }

  // Newest first
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

/** Load a single chat session. */
export async function loadChatSession(
  agentName: string,
  sessionId: string,
): Promise<ChatSession | null> {
  const p = sessionPath(agentName, sessionId);
  if (!(await pathExists(p))) return null;
  try {
    return await readJsonFile<ChatSession>(p);
  } catch {
    return null;
  }
}

/** Save (create or update) a chat session. */
export async function saveChatSession(
  session: ChatSession,
): Promise<void> {
  const dir = chatsDir(session.agentName);
  await mkdir(dir, { recursive: true });

  // Auto-derive title if empty
  if (!session.title || session.title === "New Chat") {
    session.title = deriveTitle(session.messages);
  }
  session.updatedAt = Date.now();

  await writeJsonFile(sessionPath(session.agentName, session.id), session);
}

/** Delete a single chat session. */
export async function deleteChatSession(
  agentName: string,
  sessionId: string,
): Promise<void> {
  const p = sessionPath(agentName, sessionId);
  if (await pathExists(p)) {
    await rm(p, { force: true });
  }
}

/**
 * Soft-delete a chat session by archiving it rather than destroying it.
 *
 * The active session file is moved to:
 *   ~/.nyteshift/agents/<agentName>/chats/archived/<sessionId>-<iso-timestamp>.json
 *
 * This preserves history for audit / recovery while giving the channel a
 * completely blank context window on the next message — following the
 * principle of safe, reversible operations recommended by Anthropic for
 * agentic systems.
 */
export async function archiveChatSession(
  agentName: string,
  sessionId: string,
): Promise<void> {
  const src = sessionPath(agentName, sessionId);
  if (!(await pathExists(src))) return;

  const archiveDir = join(chatsDir(agentName), "archived");
  await mkdir(archiveDir, { recursive: true });

  // ISO timestamp with colons replaced so the filename is valid on Windows.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(archiveDir, `${sessionId}-${ts}.json`);
  await rename(src, dest);
}

/** Delete all chat sessions for an agent. */
export async function deleteAllChatSessions(
  agentName: string,
): Promise<void> {
  const dir = chatsDir(agentName);
  if (await pathExists(dir)) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }
}
