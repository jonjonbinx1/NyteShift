/**
 * graphDeps.ts
 *
 * Analyses a GraphDefinition and checks whether all the tools, skills, and
 * agents it references are currently installed on the local machine.
 *
 * Used by the marketplace UI to warn users before they download a graph that
 * has unsatisfied dependencies, and to offer one-click installation of the
 * missing items.
 */

import type { GraphDefinition } from "./types.js";
import { loadTools } from "../tools/toolLoader.js";
import { loadSkills } from "../skills/skillLoader.js";
import { listAgents } from "../agents/agentManager.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface GraphDepsResult {
  /** All tool names referenced by tool-type nodes (and LLM node tool lists). */
  tools: string[];
  /** All skill refs referenced by skill-type nodes (and LLM node skill lists). */
  skills: string[];
  /** All agent names referenced by agent-type nodes. */
  agents: string[];
  /** Subset of `tools` that are NOT currently installed. */
  missingTools: string[];
  /** Subset of `skills` that are NOT currently installed. */
  missingSkills: string[];
  /** Subset of `agents` that are NOT currently installed / created. */
  missingAgents: string[];
  /** True when missingTools, missingSkills, and missingAgents are all empty. */
  allSatisfied: boolean;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Check whether all dependencies of `graph` are available locally.
 *
 * Collects all tool / skill / agent references from the graph's node list
 * (including refs embedded in LLM node connection arrays), then queries the
 * installed tools, skills, and agent directories to identify what is missing.
 */
export async function checkGraphDeps(graph: GraphDefinition): Promise<GraphDepsResult> {
  const toolRefs = new Set<string>();
  const skillRefs = new Set<string>();
  const agentRefs = new Set<string>();

  for (const node of graph.nodes) {
    switch (node.type) {
      case "tool":
        if (node.toolName) toolRefs.add(node.toolName);
        break;
      case "skill":
        if ((node as any).skillRef) skillRefs.add((node as any).skillRef);
        break;
      case "agent":
        if (node.agentName) agentRefs.add(node.agentName);
        break;
      case "llm":
        // LLM nodes may declare connected skills / tools in their config arrays
        if (node.skills) {
          for (const s of node.skills) skillRefs.add(s);
        }
        if (node.tools) {
          for (const t of node.tools) toolRefs.add(t);
        }
        break;
      default:
        break;
    }
  }

  // ── Parallel load of installed items ──────────────────────────────────────
  const [installedTools, installedSkills, installedAgentNames] = await Promise.all([
    loadTools(),
    loadSkills(),
    listAgents(),
  ]);

  // Build fast-lookup sets.  Each item is indexed under both its bare name and
  // its fully-qualified "contributor/name" form so that either format in the
  // graph node refs will match.
  const installedToolNames = new Set<string>();
  for (const t of installedTools) {
    installedToolNames.add(t.name);
    if (t.contributor) installedToolNames.add(`${t.contributor}/${t.name}`);
  }

  const installedSkillRefs = new Set<string>();
  for (const s of installedSkills) {
    installedSkillRefs.add(s.frontmatter.name);
    if (s.frontmatter.contributor) {
      installedSkillRefs.add(`${s.frontmatter.contributor}/${s.frontmatter.name}`);
    }
  }

  const installedAgents = new Set(installedAgentNames);

  // ── Compute missing sets ──────────────────────────────────────────────────
  const missingTools = [...toolRefs].filter((r) => !installedToolNames.has(r));
  const missingSkills = [...skillRefs].filter((r) => !installedSkillRefs.has(r));
  const missingAgents = [...agentRefs].filter((r) => !installedAgents.has(r));

  return {
    tools: [...toolRefs],
    skills: [...skillRefs],
    agents: [...agentRefs],
    missingTools,
    missingSkills,
    missingAgents,
    allSatisfied:
      missingTools.length === 0 &&
      missingSkills.length === 0 &&
      missingAgents.length === 0,
  };
}
