/**
 * Built-in Sub-Agent Tools — SolixAI
 *
 * Implements Anthropic's **orchestrator-workers** pattern for multi-agent
 * delegation.  A parent agent can dynamically break down complex tasks and
 * delegate sub-tasks to other agents (or to itself with a focused prompt).
 *
 * From Anthropic's "Building Effective Agents" guide:
 *
 *   "In the orchestrator-workers workflow, a central LLM dynamically breaks
 *    down tasks, delegates them to worker LLMs, and synthesizes their results."
 *
 * Key design decisions (grounded in Anthropic's best practices):
 *
 *   1. **Sub-agents are tool calls** — the parent's ReAct loop treats
 *      delegation like any other tool.  The sub-agent's final answer flows
 *      back as a `<tool_result>` so the parent can reason about it and
 *      continue.
 *
 *   2. **Bounded recursion** — a configurable `maxDepth` (default 3)
 *      prevents infinite delegation chains.  Each spawned sub-agent
 *      inherits the remaining depth budget minus one.
 *
 *   3. **Isolation** — sub-agents run their own ReAct loop with a fresh
 *      message history.  They inherit the parent's provider/model config
 *      unless explicitly overridden, but do NOT share conversation state.
 *
 *   4. **Observability** — every sub-agent run is recorded as a
 *      `SubAgentResult` on the parent step, enabling the UI to show
 *      nested delegation trees.
 *
 *   5. **Existing agents as workers** — the parent can delegate to any
 *      agent that exists in ~/.solix/agents/.  Each worker agent's soul,
 *      skills and tools are loaded normally, so specialised agents can be
 *      composed into larger workflows.
 *
 * Available tools:
 *   solix/sub_agent_run  — delegate a task to a named agent
 *   solix/sub_agent_list — list available agents for delegation
 */

import type { ToolContract, SubAgentResult, AutonomousTaskOptions } from "../../types/index.js";
import { listAgents, loadAgentConfig } from "../agents/agentManager.js";

// ── Logging ────────────────────────────────────────────────────────────
const log  = (...args: unknown[]) => console.log("[subagent]", ...args);
const logW = (...args: unknown[]) => console.warn("[subagent]", ...args);
const logE = (...args: unknown[]) => console.error("[subagent]", ...args);

/**
 * Default maximum nesting depth.  Prevents runaway delegation:
 *   depth 0 = top-level run (user)
 *   depth 1 = first sub-agent
 *   depth 2 = sub-sub-agent
 *   depth 3 = deepest allowed
 */
const DEFAULT_MAX_DEPTH = 3;

// ── Deferred import ────────────────────────────────────────────────────
// runAutonomousTask is imported lazily to avoid circular dependency
// (autonomous.ts imports this module, and this module calls back into it).
let _runAutonomousTask: typeof import("../pipeline/autonomous.js").runAutonomousTask | null = null;

async function getRunner() {
  if (!_runAutonomousTask) {
    const mod = await import("../pipeline/autonomous.js");
    _runAutonomousTask = mod.runAutonomousTask;
  }
  return _runAutonomousTask;
}

// ── Factory ────────────────────────────────────────────────────────────

export interface SubAgentToolsOptions {
  /** Name of the parent (orchestrator) agent. */
  parentAgentName: string;
  /** Current nesting depth of the parent (0 for top-level). */
  currentDepth: number;
  /** Maximum allowed depth (default 3). */
  maxDepth?: number;
  /** Provider the parent is using (inherited by sub-agents unless overridden). */
  parentProvider?: string;
  /** Model the parent is using (inherited by sub-agents unless overridden). */
  parentModel?: string;
  /** AbortSignal from the parent run — propagated to children. */
  signal?: AbortSignal;
  /** Unique ID of the parent run for lineage tracking. */
  parentRunId?: string;
  /** Callback for sub-agent step events (forwarded to parent's onStep). */
  onSubAgentStep?: (subAgentName: string, step: any) => void;
  /**
   * Whether the agent is allowed to fire sub-agents asynchronously.
   * Read from the agent's `allowAsyncSubAgents` config flag.
   * When true a third built-in tool `solix/sub_agent_collect` is injected.
   */
  allowAsync?: boolean;
}

/**
 * Build the built-in sub-agent {@link ToolContract} objects.
 *
 * These tools are automatically injected into every autonomous run
 * (alongside memory tools) so any agent can delegate to others.
 *
 * @param opts  Context from the parent agent's run.
 */
export function createSubAgentTools(opts: SubAgentToolsOptions): ToolContract[] {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const childDepth = opts.currentDepth + 1;
  const canDelegate = childDepth <= maxDepth;

  // ── Per-run async registry ─────────────────────────────────────────
  // Shared by closure between sub_agent_run and sub_agent_collect.
  // Each entry tracks a fire-and-forget sub-agent launched in this run.
  interface AsyncEntry {
    runId: string;
    agentName: string;
    task: string;
    startedAt: number;
    status: "running" | "completed" | "failed";
    result?: SubAgentResult;
    error?: string;
  }
  const asyncRegistry = new Map<string, AsyncEntry>();

  return [

    // ── sub_agent_run ─────────────────────────────────────────────────
    {
      contributor: "solix",
      name: "sub_agent_run",
      version: "1.0.0",
      description: canDelegate
        ? "Delegate a sub-task to another agent. " +
          "The target agent runs an independent ReAct loop with its own skills, tools and personality. " +
          "Use this when a task is complex enough to benefit from decomposition, or when a " +
          "specialised agent exists for a specific domain. " +
          `Current delegation depth: ${opts.currentDepth}/${maxDepth}. ` +
          (opts.allowAsync
            ? "Set async=true to fire the sub-agent in the background and continue your own loop immediately; " +
              "use sub_agent_collect to retrieve results when ready. " +
              "Omit async (or set false) for the default synchronous behaviour where you wait for the result."
            : "The sub-agent's final answer will be returned to you as the tool result.")
        : "Sub-agent delegation is disabled — maximum nesting depth reached. " +
          "Answer directly using your own capabilities.",
      spec: {
        inputSchema: {
          type: "object",
          required: ["agent", "task"],
          properties: {
            agent: {
              type: "string",
              description:
                "Name of the agent to delegate to (kebab-case). " +
                "Use sub_agent_list to see available agents. " +
                'Use "self" to delegate to yourself with a focused sub-task ' +
                "(useful for divide-and-conquer on complex problems).",
            },
            task: {
              type: "string",
              description:
                "A clear, self-contained task description for the sub-agent. " +
                "Include all necessary context — the sub-agent does NOT have " +
                "access to your conversation history.",
            },
            provider: {
              type: "string",
              description: "Override the LLM provider for this sub-agent run (optional).",
            },
            model: {
              type: "string",
              description: "Override the model for this sub-agent run (optional).",
            },
            maxSteps: {
              type: "number",
              description: "Maximum ReAct steps for the sub-agent (default: 10).",
            },
            ...(opts.allowAsync
              ? {
                  async: {
                    type: "boolean",
                    description:
                      "When true, starts the sub-agent in the background and returns a runId immediately. " +
                      "Use sub_agent_collect with the runId to check status and retrieve the result. " +
                      "Default: false (synchronous — you wait for the result before proceeding).",
                  },
                }
              : {}),
          },
        },
      },
      async run({ input }) {
        const {
          agent: targetAgent,
          task,
          provider,
          model,
          maxSteps,
          async: runAsync = false,
        } = input as {
          agent: string;
          task: string;
          provider?: string;
          model?: string;
          maxSteps?: number;
          async?: boolean;
        };

        // ── Depth guard ──────────────────────────────────────────────
        if (!canDelegate) {
          logW(`delegation blocked — depth ${childDepth} exceeds maxDepth ${maxDepth}`);
          return {
            ok: false,
            error:
              `Maximum delegation depth (${maxDepth}) reached. ` +
              "You cannot spawn further sub-agents. Answer directly.",
          };
        }

        // ── Resolve target agent ─────────────────────────────────────
        const resolvedAgent =
          targetAgent === "self" ? opts.parentAgentName : targetAgent;

        // Verify agent exists
        const agents = await listAgents();
        if (!agents.includes(resolvedAgent)) {
          logW(`agent "${resolvedAgent}" not found`);
          return {
            ok: false,
            error:
              `Agent "${resolvedAgent}" does not exist. ` +
              `Available agents: ${agents.join(", ") || "none"}. ` +
              "Create the agent first or choose an existing one.",
          };
        }

        const subOpts: AutonomousTaskOptions = {
          provider: provider ?? opts.parentProvider,
          model: model ?? opts.parentModel,
          maxSteps: maxSteps ?? 10,
          signal: opts.signal,
          _depth: childDepth,
          maxDepth,
          parentAgent: opts.parentAgentName,
          parentRunId: opts.parentRunId,
          onStep: (step) => {
            opts.onSubAgentStep?.(resolvedAgent, step);
          },
        };

        // ── Async (fire-and-forget) path ─────────────────────────────
        if (runAsync && opts.allowAsync) {
          const runId = `async:${resolvedAgent}:${Date.now()}`;
          const startedAt = Date.now();

          const entry: AsyncEntry = {
            runId,
            agentName: resolvedAgent,
            task,
            startedAt,
            status: "running",
          };
          asyncRegistry.set(runId, entry);

          // Fire without await
          getRunner().then((runAutonomousTask) => {
            return runAutonomousTask(resolvedAgent, task, subOpts);
          }).then((result) => {
            const elapsed = Date.now() - startedAt;
            const subResult: SubAgentResult = {
              agentName: resolvedAgent,
              task,
              finalOutput: result.finalOutput,
              stepCount: result.steps.length,
              elapsedMs: elapsed,
              aborted: result.aborted,
              depth: childDepth,
              steps: result.steps,
              children: result.subAgentRuns,
              isAsync: true,
              runId,
              status: "completed",
            };
            entry.status = "completed";
            entry.result = subResult;
            log(`async sub-agent "${resolvedAgent}" completed in ${elapsed}ms (runId=${runId})`);
          }).catch((err: unknown) => {
            const elapsed = Date.now() - startedAt;
            const msg = (err as Error).message ?? String(err);
            entry.status = "failed";
            entry.error = msg;
            logE(`async sub-agent "${resolvedAgent}" failed after ${elapsed}ms (runId=${runId}):`, msg);
          });

          log(
            `async sub-agent "${resolvedAgent}" fired at depth ${childDepth}/${maxDepth} — ` +
            `runId=${runId} task="${task.slice(0, 80)}${task.length > 80 ? "…" : ""}"`,
          );

          return {
            ok: true,
            async: true,
            runId,
            agentName: resolvedAgent,
            task,
            startedAt,
            message:
              `Sub-agent "${resolvedAgent}" is running asynchronously (runId: ${runId}). ` +
              "Continue your work and use sub_agent_collect to retrieve the result when needed.",
          };
        }

        // ── Synchronous path (default) ────────────────────────────────
        log(
          `spawning sub-agent "${resolvedAgent}" at depth ${childDepth}/${maxDepth} — ` +
          `task: "${task.slice(0, 100)}${task.length > 100 ? "…" : ""}"`,
        );

        const runStart = Date.now();

        try {
          const runAutonomousTask = await getRunner();

          const result = await runAutonomousTask(resolvedAgent, task, subOpts);

          const elapsed = Date.now() - runStart;
          log(
            `sub-agent "${resolvedAgent}" completed in ${elapsed}ms — ` +
            `steps=${result.steps.length} aborted=${result.aborted}`,
          );

          const subResult: SubAgentResult = {
            agentName: resolvedAgent,
            task,
            finalOutput: result.finalOutput,
            stepCount: result.steps.length,
            elapsedMs: elapsed,
            aborted: result.aborted,
            depth: childDepth,
            steps: result.steps,
            children: result.subAgentRuns,
            status: "completed",
          };

          return {
            ok: true,
            agentName: resolvedAgent,
            task,
            finalOutput: result.finalOutput,
            stepCount: result.steps.length,
            elapsedMs: elapsed,
            aborted: result.aborted,
            depth: childDepth,
            // Attach the full SubAgentResult for the pipeline to capture
            _subAgentResult: subResult,
          };
        } catch (err) {
          const elapsed = Date.now() - runStart;
          const msg = (err as Error).message ?? String(err);
          logE(`sub-agent "${resolvedAgent}" failed after ${elapsed}ms:`, msg);
          return {
            ok: false,
            error: `Sub-agent "${resolvedAgent}" failed: ${msg}`,
            elapsedMs: elapsed,
          };
        }
      },
    },

    // ── sub_agent_list ────────────────────────────────────────────────
    {
      contributor: "solix",
      name: "sub_agent_list",
      version: "1.0.0",
      description:
        "List all available agents that can be delegated to via sub_agent_run. " +
        "Returns agent names and their configured descriptions/models.",
      spec: {
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      async run() {
        const agents = await listAgents();
        const summaries: Array<{
          name: string;
          provider?: string;
          model?: string;
          description?: string;
        }> = [];

        for (const name of agents) {
          try {
            const cfg = await loadAgentConfig(name);
            summaries.push({
              name,
              provider: cfg.provider,
              model: cfg.model,
              description: (cfg as any).description,
            });
          } catch {
            summaries.push({ name });
          }
        }

        return {
          ok: true,
          currentAgent: opts.parentAgentName,
          delegationDepth: `${opts.currentDepth}/${maxDepth}`,
          canDelegate,
          agents: summaries,
          hint: canDelegate
            ? 'Use sub_agent_run with agent="<name>" and a clear task description. ' +
              'Use agent="self" to delegate to yourself with a focused sub-prompt.'
            : "Maximum depth reached — you cannot delegate further.",
        };
      },
    },

    // ── sub_agent_collect (async mode only) ───────────────────────────
    ...(opts.allowAsync
      ? [{
          contributor: "solix",
          name: "sub_agent_collect",
          version: "1.0.0",
          description:
            "Check the status of an async sub-agent run and retrieve its result when complete. " +
            "Use the runId returned by sub_agent_run when called with async=true.",
          spec: {
            inputSchema: {
              type: "object",
              required: ["runId"],
              properties: {
                runId: {
                  type: "string",
                  description: "The runId returned by sub_agent_run (async=true).",
                },
              },
            },
          },
          async run({ input }: { input: unknown }) {
            const { runId } = input as { runId: string };
            const entry = asyncRegistry.get(runId);

            if (!entry) {
              return {
                ok: false,
                error:
                  `No async sub-agent run found with runId "${runId}". ` +
                  "Verify the runId returned by sub_agent_run.",
              };
            }

            if (entry.status === "running") {
              const elapsedMs = Date.now() - entry.startedAt;
              log(`sub_agent_collect: runId=${runId} still running (${(elapsedMs / 1000).toFixed(1)}s elapsed)`);
              return {
                ok: true,
                runId,
                agentName: entry.agentName,
                status: "running",
                elapsedMs,
                message:
                  `Sub-agent "${entry.agentName}" is still running (${(elapsedMs / 1000).toFixed(1)}s elapsed). ` +
                  "Check again later or continue with other work.",
              };
            }

            if (entry.status === "failed") {
              log(`sub_agent_collect: runId=${runId} failed — ${entry.error}`);
              return {
                ok: false,
                runId,
                agentName: entry.agentName,
                status: "failed",
                error: entry.error,
              };
            }

            // Completed — return full result
            const result = entry.result!;
            const elapsedMs = Date.now() - entry.startedAt;
            log(
              `sub_agent_collect: runId=${runId} completed — ` +
              `steps=${result.stepCount} elapsed=${result.elapsedMs}ms`,
            );

            return {
              ok: true,
              runId,
              agentName: result.agentName,
              status: "completed",
              finalOutput: result.finalOutput,
              stepCount: result.stepCount,
              elapsedMs: result.elapsedMs,
              totalElapsedMs: elapsedMs,
              aborted: result.aborted,
              depth: result.depth,
              // Attach full result for pipeline capture + UI
              _subAgentResult: result,
            };
          },
        } as unknown as ToolContract]
      : []),
  ];
}
