/**
 * Built-in Plan Tools — NyteShift
 *
 * Provides five agent-callable tools for structured, disk-backed task
 * management following Anthropic's best practices for long-running agentic
 * workflows:
 *
 *   "Store task progress and context in external storage so context windows
 *    stay lean and long-horizon tasks can be managed reliably."
 *    — Anthropic, "Building Effective Agents"
 *
 * Tools exposed:
 *   nyteshift/plan_start      — create a plan with an outline
 *   nyteshift/plan_checkpoint — append a step checkpoint
 *   nyteshift/plan_summarize  — compress older steps into a summary
 *   nyteshift/plan_read       — rehydrate plan state
 *   nyteshift/plan_finish     — mark plan complete / failed / aborted
 *
 * Plans are always available (injected like memory tools) so every agent
 * can manage long tasks without marketplace installation.  Retrieval is
 * always explicit — nothing is auto-injected into context.
 */

import type { ToolContract } from "../../types/index.js";
import {
  createPlan,
  readPlan,
  checkpointPlan,
  summarizePlan,
  finishPlan,
  writePlanArtifact,
  listPlans,
} from "./planManager.js";

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Build the built-in plan {@link ToolContract} objects scoped to a specific
 * agent.  Created once per `runAutonomousTask` call (same lifecycle as
 * memory tools and sub-agent tools).
 *
 * @param agentName  The name of the agent these tools operate on.
 */
export function createPlanTools(agentName: string): ToolContract[] {
  return [

    // ── plan_start ────────────────────────────────────────────────────
    {
      contributor: "nyteshift",
      name: "plan_start",
      version: "1.0.0",
      description:
        "Create a structured plan for managing a long-running or complex task. " +
        "The plan is persisted to disk so context can be freed as the task progresses. " +
        "Call this at the start of any task that will require more than a few steps, " +
        "involve multiple tool calls, or where progress should be tracked explicitly. " +
        "Returns a planId that you use in all subsequent plan tool calls.",
      spec: {
        inputSchema: {
          type: "object",
          required: ["task"],
          properties: {
            task: {
              type: "string",
              description:
                "A concise description of the overall task or goal this plan tracks.",
            },
            outline: {
              type: "string",
              description:
                "A newline-separated list of the high-level steps you intend to take. " +
                "This is written once at creation and preserved as a reference — " +
                "it is not updated as the task evolves.",
            },
            planId: {
              type: "string",
              description:
                "Optional custom plan identifier. " +
                "If omitted a unique ID is generated automatically.",
            },
          },
        },
      },
      async run({ input }) {
        const { task, outline, planId } = input as {
          task: string;
          outline?: string;
          planId?: string;
        };
        const outlineSteps = outline
          ? outline.split("\n").map((s) => s.trim()).filter(Boolean)
          : [];
        const plan = await createPlan(agentName, task, outlineSteps, planId);
        return {
          ok: true,
          planId: plan.planId,
          message:
            `Plan "${plan.planId}" created. ` +
            `Use plan_checkpoint to record progress after each significant action. ` +
            `Call plan_summarize every ~5 checkpoints to keep context lean. ` +
            `Call plan_finish when done.`,
          plan: {
            planId: plan.planId,
            task: plan.task,
            status: plan.status,
            outline: plan.outline,
            createdAt: new Date(plan.createdAt).toISOString(),
          },
        };
      },
    },

    // ── plan_checkpoint ───────────────────────────────────────────────
    {
      contributor: "nyteshift",
      name: "plan_checkpoint",
      version: "1.0.0",
      description:
        "Append a checkpoint to an existing plan recording what you just did and the result. " +
        "Call this after each significant action or tool call so the plan always reflects " +
        "the current state of the task. " +
        "Also supports writing optional named artifacts (search results, drafts, computed " +
        "values) so they can be retrieved later without re-executing expensive operations. " +
        "Tip: after ~5 checkpoints call plan_summarize to compress history.",
      spec: {
        inputSchema: {
          type: "object",
          required: ["planId", "action", "result"],
          properties: {
            planId: {
              type: "string",
              description: "The plan ID returned by plan_start.",
            },
            action: {
              type: "string",
              description:
                "A short description of what you just did (1–2 sentences).",
            },
            result: {
              type: "string",
              description:
                "A short description of the outcome — what you learned or produced (1–3 sentences). " +
                "Be specific enough that the plan can be understood without the full conversation.",
            },
            artifactKey: {
              type: "string",
              description:
                "Optional: a stable key for an artifact produced by this step " +
                "(e.g. 'search-results', 'draft-email'). " +
                "Pair with artifactValue and artifactDescription.",
            },
            artifactDescription: {
              type: "string",
              description: "What this artifact contains (required when artifactKey is set).",
            },
            artifactValue: {
              type: "string",
              description:
                "The artifact data as a string. " +
                "Use JSON.stringify for structured data (required when artifactKey is set).",
            },
          },
        },
      },
      async run({ input }) {
        const { planId, action, result, artifactKey, artifactDescription, artifactValue } =
          input as {
            planId: string;
            action: string;
            result: string;
            artifactKey?: string;
            artifactDescription?: string;
            artifactValue?: string;
          };

        let plan = await checkpointPlan(agentName, planId, action, result);

        if (artifactKey && artifactValue !== undefined) {
          plan = await writePlanArtifact(
            agentName,
            planId,
            artifactKey,
            artifactDescription ?? "",
            artifactValue,
          );
        }

        const stepCount = plan.steps.length;
        const shouldSummarize = stepCount > 0 && stepCount % 5 === 0;

        return {
          ok: true,
          planId,
          stepIndex: plan.steps[plan.steps.length - 1]?.index ?? stepCount,
          artifactStored: !!artifactKey,
          hint: shouldSummarize
            ? `You have recorded ${stepCount} checkpoints. ` +
              "Call plan_summarize now to compress older steps and keep context lean."
            : `Step logged (${stepCount} total). ` +
              `Call plan_summarize after ~${5 - (stepCount % 5)} more step(s).`,
        };
      },
    },

    // ── plan_summarize ────────────────────────────────────────────────
    {
      contributor: "nyteshift",
      name: "plan_summarize",
      version: "1.0.0",
      description:
        "Compress the current step log into a rolling summary, then prune older step entries. " +
        "This is the primary context-management operation for long tasks: " +
        "call it every ~5 checkpoints to keep the plan lean and ensure that when you " +
        "read the plan back later only the most relevant context is returned. " +
        "You write the compression — a concise narrative summary of the work done so far, " +
        "key findings, and any important decisions made. " +
        "The most recent 3 step entries are retained alongside your summary.",
      spec: {
        inputSchema: {
          type: "object",
          required: ["planId", "compression"],
          properties: {
            planId: {
              type: "string",
              description: "The plan ID to summarize.",
            },
            compression: {
              type: "string",
              description:
                "A concise paragraph (3–6 sentences) summarising the steps completed so far: " +
                "what was done, key findings, decisions made, and current status. " +
                "Write this as if briefing a colleague who needs to continue the task. " +
                "This replaces the detail of the pruned step entries.",
            },
          },
        },
      },
      async run({ input }) {
        const { planId, compression } = input as {
          planId: string;
          compression: string;
        };
        const plan = await summarizePlan(agentName, planId, compression);
        return {
          ok: true,
          planId,
          message:
            `Plan summarized. ${plan.steps.length} most recent step(s) retained alongside the summary. ` +
            "Older step entries have been pruned. " +
            "Use plan_read to rehydrate context when needed.",
          retainedSteps: plan.steps.length,
          summaryLength: plan.summary.length,
        };
      },
    },

    // ── plan_read ─────────────────────────────────────────────────────
    {
      contributor: "nyteshift",
      name: "plan_read",
      version: "1.0.0",
      description:
        "Read the current state of a plan to rehydrate your context about a long-running task. " +
        "Returns the task, status, outline, rolling summary, and recent step log. " +
        "Use this at the start of a new reasoning window, after returning from a sub-agent " +
        "delegation, or whenever you need to re-orient on what has been done and what remains. " +
        "Artifacts are excluded by default to avoid context bloat — set includeArtifacts=true " +
        "to retrieve them.",
      spec: {
        inputSchema: {
          type: "object",
          properties: {
            planId: {
              type: "string",
              description:
                "The plan ID to read. " +
                "Omit to list all in-progress plans (returns a summary index, not full plans).",
            },
            includeArtifacts: {
              type: "boolean",
              description:
                "When true, artifact entries are included in the response. " +
                "Default: false (artifacts are excluded to keep context lean).",
            },
          },
        },
      },
      async run({ input }) {
        const { planId, includeArtifacts = false } = (input ?? {}) as {
          planId?: string;
          includeArtifacts?: boolean;
        };

        // No planId: return index of all in-progress plans.
        if (!planId) {
          const plans = await listPlans(agentName, "in-progress");
          if (plans.length === 0) {
            return {
              ok: true,
              inProgressPlans: [],
              message: "No in-progress plans found. Use plan_start to create one.",
            };
          }
          return {
            ok: true,
            inProgressPlans: plans.map((p) => ({
              planId: p.planId,
              task: p.task,
              stepCount: p.steps.length,
              artifactCount: p.artifacts.length,
              updatedAt: new Date(p.updatedAt).toISOString(),
            })),
          };
        }

        const plan = await readPlan(agentName, planId);
        if (!plan) {
          return {
            ok: false,
            error:
              `Plan "${planId}" not found. ` +
              "Use plan_start to create a new plan, or check the planId.",
          };
        }

        const response: Record<string, unknown> = {
          ok: true,
          planId: plan.planId,
          task: plan.task,
          status: plan.status,
          outline: plan.outline,
          summary: plan.summary || "(no summary yet — call plan_summarize)",
          recentSteps: plan.steps.map((s) => ({
            index: s.index,
            action: s.action,
            result: s.result,
            at: new Date(s.timestamp).toISOString(),
          })),
          updatedAt: new Date(plan.updatedAt).toISOString(),
          outcome: plan.outcome,
        };

        if (includeArtifacts) {
          response.artifacts = plan.artifacts.map((a) => ({
            key: a.key,
            description: a.description,
            value: a.value,
            at: new Date(a.timestamp).toISOString(),
          }));
        } else if (plan.artifacts.length > 0) {
          response.artifactKeys = plan.artifacts.map((a) => a.key);
          response.artifactHint =
            `${plan.artifacts.length} artifact(s) stored. ` +
            "Call plan_read with includeArtifacts=true to retrieve them.";
        }

        return response;
      },
    },

    // ── plan_finish ───────────────────────────────────────────────────
    {
      contributor: "nyteshift",
      name: "plan_finish",
      version: "1.0.0",
      description:
        "Mark a plan as complete, failed, or aborted and record the final outcome. " +
        "Always call this when a long-running task concludes so the plan is not left " +
        "in an in-progress state. The outcome is stored alongside the plan for future " +
        "reference and debugging.",
      spec: {
        inputSchema: {
          type: "object",
          required: ["planId", "status"],
          properties: {
            planId: {
              type: "string",
              description: "The plan ID to finish.",
            },
            status: {
              type: "string",
              enum: ["completed", "failed", "aborted"],
              description:
                "Final status: " +
                "'completed' = task succeeded, " +
                "'failed' = task could not be completed due to an error, " +
                "'aborted' = task was deliberately stopped before completion.",
            },
            outcome: {
              type: "string",
              description:
                "A concise description of the final outcome (1–4 sentences). " +
                "Summarise what was accomplished and any important caveats. " +
                "This is preserved for future inspection and debugging.",
            },
          },
        },
      },
      async run({ input }) {
        const { planId, status, outcome } = input as {
          planId: string;
          status: "completed" | "failed" | "aborted";
          outcome?: string;
        };
        const plan = await finishPlan(agentName, planId, status, outcome);
        return {
          ok: true,
          planId,
          status: plan.status,
          message: `Plan "${planId}" marked as ${plan.status}.`,
          outcome: plan.outcome,
          totalStepsLogged: plan.steps.length,
          artifactsStored: plan.artifacts.length,
        };
      },
    },

  ]; // end tools array
}
