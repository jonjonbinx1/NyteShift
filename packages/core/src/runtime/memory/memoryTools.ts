/**
 * Built-in Memory Tools — SolixAI
 *
 * Creates the four core memory tools that are available to every agent
 * without needing to install anything from the marketplace.
 *
 * These tools implement the "external storage + explicit retrieval" memory
 * pattern recommended by Anthropic for augmented-LLM agents:
 *
 *   "Our current models can actively use these capabilities — generating their
 *    own search queries, selecting appropriate tools, and determining what
 *    information to retain."
 *    — Anthropic, "Building Effective Agents"
 *
 * The agent decides when to use these tools.  Nothing is injected into
 * context automatically.  This ensures:
 *   • Chat sessions remain isolated (different conversations don't bleed).
 *   • The agent only pulls relevant memories when they are actually needed.
 *   • Memories persist across sessions, platforms and entry points (UI,
 *     CLI, Discord, scheduled triggers).
 *
 * Available tools:
 *   solix/memory_write   — store a key→value memory
 *   solix/memory_read    — retrieve a memory by key
 *   solix/memory_list    — list all memories (optionally by category)
 *   solix/memory_delete  — remove a memory by key
 *   solix/memory_search  — keyword search across all stored memories
 */

import type { ToolContract } from "../../types/index.js";
import {
  writeMemory,
  readMemory,
  listMemories,
  deleteMemory,
  searchMemories,
} from "./memoryManager.js";

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Build the five built-in memory {@link ToolContract} objects scoped to a
 * specific agent.  The agent name is captured in a closure so every tool
 * call automatically targets the correct agent's memory directory.
 *
 * @param agentName  The name of the agent these tools operate on.
 */
export function createMemoryTools(agentName: string): ToolContract[] {
  return [

    // ── memory_write ──────────────────────────────────────────────────
    {
      contributor: "solix",
      name: "memory_write",
      version: "1.0.0",
      description:
        "Store a persistent memory for this agent. " +
        "Use this to remember user preferences, important facts, goals, or any " +
        "information that should be available across future conversations. " +
        "Memories are NOT fed automatically — they must be explicitly retrieved " +
        "with memory_read or memory_list when needed.",
      spec: {
        inputSchema: {
          type: "object",
          required: ["key", "value"],
          properties: {
            key: {
              type: "string",
              description:
                "A stable, descriptive identifier for this memory " +
                "(e.g. 'user_preferred_language', 'project_name', 'notification_preference'). " +
                "Writing to an existing key overwrites it.",
            },
            value: {
              type: "string",
              description: "The value to store. Should be concise and human-readable.",
            },
            category: {
              type: "string",
              description:
                "Optional grouping tag to organise memories " +
                "(e.g. 'preferences', 'facts', 'goals', 'context'). " +
                "Enables filtered retrieval via memory_list.",
            },
            note: {
              type: "string",
              description:
                "Optional natural-language explanation of why this memory is important " +
                "and when it should be used. Helps future reasoning about relevance.",
            },
          },
        },
      },
      async run({ input }) {
        const { key, value, category, note } = input as {
          key: string;
          value: string;
          category?: string;
          note?: string;
        };
        const entry = await writeMemory(agentName, key, value, category, note);
        return {
          ok: true,
          message: `Memory "${entry.key}" stored successfully.`,
          entry,
        };
      },
    },

    // ── memory_read ───────────────────────────────────────────────────
    {
      contributor: "solix",
      name: "memory_read",
      version: "1.0.0",
      description:
        "Read a specific stored memory by its key. " +
        "Returns the value, category, note and timestamps if found, or " +
        "a not-found indicator if the key does not exist.",
      spec: {
        inputSchema: {
          type: "object",
          required: ["key"],
          properties: {
            key: {
              type: "string",
              description: "The key of the memory to retrieve.",
            },
          },
        },
      },
      async run({ input }) {
        const { key } = input as { key: string };
        const entry = await readMemory(agentName, key);
        if (!entry) {
          return {
            ok: false,
            found: false,
            message: `No memory found for key "${key}". Use memory_list to see all stored memories.`,
          };
        }
        return {
          ok: true,
          found: true,
          entry,
        };
      },
    },

    // ── memory_list ───────────────────────────────────────────────────
    {
      contributor: "solix",
      name: "memory_list",
      version: "1.0.0",
      description:
        "List all stored memories for this agent, optionally filtered by category. " +
        "Returns a summary of each memory (key, value, category, note) sorted " +
        "by most recently updated. Use this to discover what the agent remembers " +
        "before deciding whether to read a specific memory.",
      spec: {
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description:
                "If provided, only memories with this category tag are returned. " +
                "Leave empty to list all memories.",
            },
          },
        },
      },
      async run({ input }) {
        const { category } = (input ?? {}) as { category?: string };
        const entries = await listMemories(agentName, category);
        if (entries.length === 0) {
          return {
            ok: true,
            count: 0,
            memories: [],
            message: category
              ? `No memories found in category "${category}".`
              : "No memories stored yet.",
          };
        }
        return {
          ok: true,
          count: entries.length,
          memories: entries.map((e) => ({
            key: e.key,
            value: e.value,
            category: e.category,
            note: e.note,
            updatedAt: new Date(e.updatedAt).toISOString(),
          })),
        };
      },
    },

    // ── memory_delete ─────────────────────────────────────────────────
    {
      contributor: "solix",
      name: "memory_delete",
      version: "1.0.0",
      description:
        "Delete a stored memory by key. " +
        "Use this when a previously stored fact or preference is no longer relevant " +
        "or has been superseded. No-ops if the key does not exist.",
      spec: {
        inputSchema: {
          type: "object",
          required: ["key"],
          properties: {
            key: {
              type: "string",
              description: "The key of the memory to delete.",
            },
          },
        },
      },
      async run({ input }) {
        const { key } = input as { key: string };
        await deleteMemory(agentName, key);
        return {
          ok: true,
          message: `Memory "${key}" deleted (or did not exist).`,
        };
      },
    },

    // ── memory_search ─────────────────────────────────────────────────
    {
      contributor: "solix",
      name: "memory_search",
      version: "1.0.0",
      description:
        "Search stored memories by keyword. " +
        "Performs a case-insensitive substring match across memory keys, values, " +
        "notes and categories. Useful when you don't know the exact key but " +
        "remember a fragment of what was stored.",
      spec: {
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description:
                "The search term to look for across all memory fields " +
                "(key, value, note, category).",
            },
          },
        },
      },
      async run({ input }) {
        const { query } = input as { query: string };
        const results = await searchMemories(agentName, query);
        if (results.length === 0) {
          return {
            ok: true,
            count: 0,
            results: [],
            message: `No memories matched "${query}".`,
          };
        }
        return {
          ok: true,
          count: results.length,
          results: results.map((e) => ({
            key: e.key,
            value: e.value,
            category: e.category,
            note: e.note,
            updatedAt: new Date(e.updatedAt).toISOString(),
          })),
        };
      },
    },

  ];
}
