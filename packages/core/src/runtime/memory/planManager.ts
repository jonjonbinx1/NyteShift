/**
 * Agent Plan Manager — NyteShift
 *
 * Implements structured, disk-backed checkpointing for long-running agent
 * tasks, following Anthropic's guidance on context management for agentic
 * systems:
 *
 *   "For complex long-horizon tasks, agents should offload state to external
 *    storage so the context window stays lean and the task can be resumed,
 *    inspected, or recovered if something goes wrong."
 *    — Anthropic, "Building Effective Agents"
 *
 * Design principles (grounded in Anthropic best practices):
 *
 *  1. **Run-scoped plans** — each plan is tied to one task run (not a
 *     session or conversation). Creating a plan immediately anchors the
 *     agent's goal and gives it a stable reference across many steps.
 *
 *  2. **Rolling summarization** — detail from older steps is compressed
 *     into a single `summary` string and the raw step entries are pruned.
 *     This prevents the plan from growing unboundedly and ensures that
 *     when the agent reads the plan back only the most relevant context
 *     is loaded into the prompt.
 *
 *  3. **Explicit retrieval** — nothing is injected automatically.  The
 *     agent calls plan tools when it needs to read, update or summarize.
 *     This follows the Anthropic principle of keeping retrieval explicit
 *     so the model can reason about *whether* it needs a piece of context
 *     before spending tokens on it.
 *
 *  4. **Artifacts** — structured side-outputs (search results, generated
 *     content, intermediate computations) are stored as named artifact
 *     entries inside the plan so the agent can retrieve them later without
 *     having to re-execute expensive tool calls.
 *
 * Storage layout:
 *   ~/.nyteshift/agents/<agentName>/plans/<planId>.json
 *
 * Plan file shape: {@link PlanEntry}
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  agentsDir,
  toKebab,
  pathExists,
  writeJsonFile,
  readJsonFile,
} from "../../utils/index.js";

// ── Types ──────────────────────────────────────────────────────────────

/** A single recorded step within a plan. */
export interface PlanStep {
  /** 1-based sequential index. */
  index: number;
  /** Short description of the action that was taken. */
  action: string;
  /** Short description of the outcome / result. */
  result: string;
  /** Unix epoch ms. */
  timestamp: number;
}

/**
 * A named artifact produced during a plan run (e.g. a search result,
 * generated document, intermediate computation).  Stored inside the plan
 * so the agent can retrieve it without re-executing an expensive tool call.
 */
export interface PlanArtifact {
  /** Stable identifier (e.g. "search-results", "draft-email"). */
  key: string;
  /** Human-readable description of what this artifact contains. */
  description: string;
  /**
   * The artifact data as a string.  Use JSON.stringify for structured data.
   * Keep this reasonably compact — large blobs should be written to a
   * separate file and referenced here by path.
   */
  value: string;
  /** Unix epoch ms. */
  timestamp: number;
}

export type PlanStatus = "in-progress" | "completed" | "failed" | "aborted";

/**
 * A full plan entry as persisted to disk.
 *
 * Agents should load and work with this type via the plan tools, not
 * directly, so the rolling-summarization invariants are maintained.
 */
export interface PlanEntry {
  /** Unique identifier for this plan run. */
  planId: string;
  /** Original task description passed to the agent. */
  task: string;
  /** Current lifecycle status. */
  status: PlanStatus;
  /**
   * Initial outline — the list of high-level steps the agent planned at
   * creation time.  Never mutated after creation so the original intent
   * is always recoverable.
   */
  outline: string[];
  /**
   * Rolling compressed summary of progress so far.
   * Updated by `plan_summarize`; starts as an empty string.
   * Contains synthesized narrative of completed work, decisions made, and
   * key findings.  Older individual step entries are pruned once compressed
   * here so the summary is the primary context for rehydration.
   */
  summary: string;
  /**
   * Recent step log.  Entries older than `STEPS_RETAINED_AFTER_SUMMARIZE`
   * are pruned when `plan_summarize` is called.
   */
  steps: PlanStep[];
  /**
   * Named artifacts produced during the run.  Retrieved on demand — not
   * included in the default `plan_read` response to avoid unnecessary
   * context bloat.
   */
  artifacts: PlanArtifact[];
  /** Unix epoch ms when the plan was created. */
  createdAt: number;
  /** Unix epoch ms of the last mutation. */
  updatedAt: number;
  /**
   * Optional final outcome note written when `plan_finish` is called.
   * Persists the agent's own assessment of whether the task succeeded.
   */
  outcome?: string;
}

// ── Constants ──────────────────────────────────────────────────────────

/**
 * Number of recent step entries retained in the step log after a
 * summarization pass.  Older entries are pruned so only the most recent
 * context remains alongside the compressed summary.
 */
const STEPS_RETAINED_AFTER_SUMMARIZE = 3;

// ── Path helpers ───────────────────────────────────────────────────────

function plansDir(agentName: string): string {
  return join(agentsDir(), toKebab(agentName), "plans");
}

function planPath(agentName: string, planId: string): string {
  return join(plansDir(agentName), `${planId}.json`);
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Create a new plan for the given agent and task.
 *
 * @param agentName  The agent that owns this plan.
 * @param task       The top-level task description.
 * @param outline    Initial list of high-level steps (optional but recommended).
 * @param planId     Custom plan ID; defaults to a timestamp-based slug.
 */
export async function createPlan(
  agentName: string,
  task: string,
  outline: string[] = [],
  planId?: string,
): Promise<PlanEntry> {
  const dir = plansDir(agentName);
  await mkdir(dir, { recursive: true });

  const id = planId ?? `plan-${Date.now()}`;
  const now = Date.now();

  const entry: PlanEntry = {
    planId: id,
    task,
    status: "in-progress",
    outline,
    summary: "",
    steps: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };

  await writeJsonFile(planPath(agentName, id), entry);
  return entry;
}

/**
 * Read a plan by ID.  Returns null if not found.
 */
export async function readPlan(
  agentName: string,
  planId: string,
): Promise<PlanEntry | null> {
  const p = planPath(agentName, planId);
  if (!(await pathExists(p))) return null;
  try {
    return await readJsonFile<PlanEntry>(p);
  } catch {
    return null;
  }
}

/**
 * Append a checkpoint step to an existing plan.
 *
 * @param agentName  The owning agent.
 * @param planId     The plan to update.
 * @param action     Short description of the action taken.
 * @param result     Short description of the outcome.
 */
export async function checkpointPlan(
  agentName: string,
  planId: string,
  action: string,
  result: string,
): Promise<PlanEntry> {
  const plan = await _requirePlan(agentName, planId);

  const step: PlanStep = {
    index: (plan.steps[plan.steps.length - 1]?.index ?? 0) + 1,
    action,
    result,
    timestamp: Date.now(),
  };

  plan.steps.push(step);
  plan.updatedAt = Date.now();

  await writeJsonFile(planPath(agentName, planId), plan);
  return plan;
}

/**
 * Compress the step log into the rolling `summary` field and prune older
 * step entries, retaining only the most recent {@link STEPS_RETAINED_AFTER_SUMMARIZE}.
 *
 * The caller passes a `compression` string — typically a short paragraph
 * generated by the agent (or a summarization tool call) describing the
 * work done so far.  This approach leaves summarization in the model's
 * hands, following Anthropic's principle that the agent should own its
 * own context management.
 *
 * @param agentName    The owning agent.
 * @param planId       The plan to summarize.
 * @param compression  A concise summary of the steps being compressed.
 */
export async function summarizePlan(
  agentName: string,
  planId: string,
  compression: string,
): Promise<PlanEntry> {
  const plan = await _requirePlan(agentName, planId);

  // Append the compression to any existing summary.
  plan.summary = plan.summary
    ? `${plan.summary}\n\n${compression}`
    : compression;

  // Retain only the most recent steps — older ones are now in the summary.
  if (plan.steps.length > STEPS_RETAINED_AFTER_SUMMARIZE) {
    plan.steps = plan.steps.slice(-STEPS_RETAINED_AFTER_SUMMARIZE);
  }

  plan.updatedAt = Date.now();
  await writeJsonFile(planPath(agentName, planId), plan);
  return plan;
}

/**
 * Write or overwrite a named artifact inside the plan.
 *
 * @param agentName    The owning agent.
 * @param planId       The plan that owns this artifact.
 * @param key          Stable identifier for the artifact.
 * @param description  Human-readable note about the artifact's contents.
 * @param value        The artifact data (string or JSON.stringify'd object).
 */
export async function writePlanArtifact(
  agentName: string,
  planId: string,
  key: string,
  description: string,
  value: string,
): Promise<PlanEntry> {
  const plan = await _requirePlan(agentName, planId);

  const existing = plan.artifacts.find((a) => a.key === key);
  if (existing) {
    existing.description = description;
    existing.value = value;
    existing.timestamp = Date.now();
  } else {
    plan.artifacts.push({ key, description, value, timestamp: Date.now() });
  }

  plan.updatedAt = Date.now();
  await writeJsonFile(planPath(agentName, planId), plan);
  return plan;
}

/**
 * Mark a plan as finished and optionally record the final outcome.
 *
 * @param agentName  The owning agent.
 * @param planId     The plan to finish.
 * @param status     Final status — "completed", "failed", or "aborted".
 * @param outcome    Optional plain-text description of the final outcome.
 */
export async function finishPlan(
  agentName: string,
  planId: string,
  status: Exclude<PlanStatus, "in-progress">,
  outcome?: string,
): Promise<PlanEntry> {
  const plan = await _requirePlan(agentName, planId);

  plan.status = status;
  plan.outcome = outcome;
  plan.updatedAt = Date.now();

  await writeJsonFile(planPath(agentName, planId), plan);
  return plan;
}

/**
 * List all plans for an agent, optionally filtered by status.
 * Returns plans sorted by `updatedAt` descending (most recent first).
 */
export async function listPlans(
  agentName: string,
  status?: PlanStatus,
): Promise<PlanEntry[]> {
  const dir = plansDir(agentName);
  if (!(await pathExists(dir))) return [];

  const { readdir } = await import("node:fs/promises");
  const files = await readdir(dir);
  const plans: PlanEntry[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const p = await readJsonFile<PlanEntry>(join(dir, file));
      if (status && p.status !== status) continue;
      plans.push(p);
    } catch {
      // Corrupted plan — skip silently.
    }
  }

  plans.sort((a, b) => b.updatedAt - a.updatedAt);
  return plans;
}

/**
 * Delete a plan file entirely.  Irreversible.
 */
export async function deletePlan(
  agentName: string,
  planId: string,
): Promise<void> {
  const p = planPath(agentName, planId);
  if (await pathExists(p)) {
    await rm(p, { force: true });
  }
}

// ── Private helpers ────────────────────────────────────────────────────

async function _requirePlan(
  agentName: string,
  planId: string,
): Promise<PlanEntry> {
  const plan = await readPlan(agentName, planId);
  if (!plan) {
    throw new Error(
      `Plan "${planId}" not found for agent "${agentName}". ` +
      "Create it first with plan_start.",
    );
  }
  return plan;
}
