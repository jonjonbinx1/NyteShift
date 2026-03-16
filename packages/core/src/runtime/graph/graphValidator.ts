// ── Agent Graph Validator ───────────────────────────────────────────────
//
// Validates a GraphDefinition for structural correctness:
//   • unique node / edge IDs
//   • valid edge references
//   • SCC-based cycle check: allows condition-guarded loops, rejects bare cycles
//   • per-node-type field requirements

import type { GraphDefinition, GraphNode } from "./types.js";

// ── Public types ───────────────────────────────────────────────────────

export interface GraphValidationError {
  nodeId?: string;
  edgeId?: string;
  field?: string;
  message: string;
}

// ── Validator ──────────────────────────────────────────────────────────

/**
 * Validate a graph definition.
 *
 * Returns an empty array when the graph is valid.
 */
export function validateGraph(graph: GraphDefinition): GraphValidationError[] {
  const errors: GraphValidationError[] = [];

  // ── Basic fields ──────────────────────────────────────────────────────
  if (!graph.id) errors.push({ message: "Graph must have an id." });
  if (!graph.name) errors.push({ message: "Graph must have a name." });
  if (!graph.version) errors.push({ message: "Graph must have a version." });
  if (!graph.nodes?.length) {
    errors.push({ message: "Graph must contain at least one node." });
    return errors; // cannot continue without nodes
  }

  // ── Unique node IDs ───────────────────────────────────────────────────
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id) {
      errors.push({ nodeId: node.id, message: "Node is missing an id." });
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push({ nodeId: node.id, message: `Duplicate node id "${node.id}".` });
    }
    nodeIds.add(node.id);
  }

  // ── Unique edge IDs & referential integrity ───────────────────────────
  const edgeIds = new Set<string>();
  for (const edge of graph.edges ?? []) {
    if (!edge.id) {
      errors.push({ edgeId: edge.id, message: "Edge is missing an id." });
      continue;
    }
    if (edgeIds.has(edge.id)) {
      errors.push({ edgeId: edge.id, message: `Duplicate edge id "${edge.id}".` });
    }
    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.source)) {
      errors.push({ edgeId: edge.id, message: `Edge source "${edge.source}" references a non-existent node.` });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ edgeId: edge.id, message: `Edge target "${edge.target}" references a non-existent node.` });
    }
  }

  // ── Condition-branch references ───────────────────────────────────────
  for (const node of graph.nodes) {
    if (node.type === "condition" && node.branches) {
      for (const branch of node.branches) {
        if (!nodeIds.has(branch.target)) {
          errors.push({
            nodeId: node.id,
            message: `Branch target "${branch.target}" references a non-existent node.`,
          });
        }
      }
      if (node.defaultTarget && !nodeIds.has(node.defaultTarget)) {
        errors.push({
          nodeId: node.id,
          message: `Default target "${node.defaultTarget}" references a non-existent node.`,
        });
      }
    }
  }

  // ── Cycle / SCC validation ────────────────────────────────────────────
  // Cycles are allowed when guarded by a condition node that has at least
  // one branch exiting the SCC.  Unguarded cycles (no exit path) are rejected.
  errors.push(...validateSCCs(graph, nodeIds));

  // ── Per-node validation ───────────────────────────────────────────────
  for (const node of graph.nodes) {
    errors.push(...validateNode(node));
  }

  return errors;
}

// ── Helpers ────────────────────────────────────────────────────────────

function validateNode(n: GraphNode): GraphValidationError[] {
  const errors: GraphValidationError[] = [];

  switch (n.type) {
    case "llm":
      if (!n.promptTemplate && !n.systemPrompt) {
        errors.push({
          nodeId: n.id,
          field: "promptTemplate",
          message: "LLM node must have a promptTemplate or systemPrompt.",
        });
      }
      break;
    case "agent":
      if (!n.promptTemplate) {
        errors.push({
          nodeId: n.id,
          field: "promptTemplate",
          message: "Agent node must have a promptTemplate.",
        });
      }
      break;
    case "tool":
      if (!n.toolName) {
        errors.push({
          nodeId: n.id,
          field: "toolName",
          message: "Tool node must have a toolName.",
        });
      }
      break;
    case "condition":
      if (!n.branches?.length && !n.defaultTarget) {
        errors.push({
          nodeId: n.id,
          message: "Condition node must have at least one branch or a defaultTarget.",
        });
      }
      break;
    case "operation": {
      if (!n.operationAction) {
        errors.push({
          nodeId: n.id,
          field: "operationAction",
          message: "Operation node must have an operationAction.",
        });
        break;
      }
      if (!n.operationAction.varName?.trim()) {
        errors.push({
          nodeId: n.id,
          field: "operationAction.varName",
          message: "Operation node operationAction must specify a varName.",
        });
      }
      if (!n.operationAction.op) {
        errors.push({
          nodeId: n.id,
          field: "operationAction.op",
          message: "Operation node operationAction must specify an op.",
        });
      }
      if (n.operationAction.op === "copy" && !n.operationAction.fromRef?.trim()) {
        errors.push({
          nodeId: n.id,
          field: "operationAction.fromRef",
          message: "Operation node with op=\"copy\" must specify a fromRef.",
        });
      }
      if (n.operationAction.op === "extract" && !n.operationAction.fromRef?.trim()) {
        errors.push({
          nodeId: n.id,
          field: "operationAction.fromRef",
          message: "Operation node with op=\"extract\" must specify a fromRef.",
        });
      }
      break;
    }
    case "skill":
      if (!n.skillRef || !String(n.skillRef).trim()) {
        errors.push({
          nodeId: n.id,
          field: "skillRef",
          message: "Skill node must specify a skillRef (e.g. \"contributor/name\").",
        });
      }
      break;
    case "input":
    case "output":
      break;
    case "catch":
      if (!n.catchTriggers?.length) {
        errors.push({
          nodeId: n.id,
          field: "catchTriggers",
          message: "Catch node must specify at least one trigger (maxIterations, error, or abort).",
        });
      }
      break;
    case "trigger": {
      if (!n.targetType) {
        errors.push({
          nodeId: n.id,
          field: "targetType",
          message: "Trigger node must specify targetType (\"graph\" or \"agent\").",
        });
      }
      if (!n.targetId?.trim()) {
        errors.push({
          nodeId: n.id,
          field: "targetId",
          message: "Trigger node must specify a targetId (graph ID or agent name).",
        });
      }
      // Warn when a trigger node invokes another agent with no task source.
      // The task must come from triggerInput.task or promptTemplate.
      if (n.targetType === "agent" && !n.promptTemplate && !n.triggerInput?.["task"]) {
        errors.push({
          nodeId: n.id,
          field: "promptTemplate",
          message:
            "Trigger node targeting an agent should have a promptTemplate or " +
            "triggerInput.task to specify the task description.",
        });
      }
      break;
    }
    default:
      errors.push({ nodeId: n.id, message: `Unknown node type "${n.type}".` });
  }

  return errors;
}

/**
 * Build a unified adjacency map that includes both regular graph edges and
 * condition-node branch edges (which act as implicit edges for cycle detection).
 */
function buildAdjacency(
  graph: GraphDefinition,
  nodeIds: Set<string>,
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  // Build a set of catch-node IDs to exclude from SCC participation.
  // Catch nodes are triggered by the runtime at exit-reason time; they
  // are never loop participants and must never appear inside a cycle.
  const catchIds = new Set(graph.nodes.filter(n => n.type === "catch").map(n => n.id));

  for (const id of nodeIds) adj.set(id, []);

  for (const edge of graph.edges ?? []) {
    // Exclude edges whose target is a catch node — they have no role in
    // SCC/cycle analysis (catch nodes are runtime-fired, not edge-driven).
    if (catchIds.has(edge.target)) continue;
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adj.get(edge.source)!.push(edge.target);
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== "condition") continue;
    for (const branch of node.branches ?? []) {
      if (catchIds.has(branch.target)) continue; // catch targets are not flow edges
      if (nodeIds.has(branch.target)) {
        adj.get(node.id)!.push(branch.target);
      }
    }
    if (node.defaultTarget && !catchIds.has(node.defaultTarget) && nodeIds.has(node.defaultTarget)) {
      adj.get(node.id)!.push(node.defaultTarget);
    }
  }

  return adj;
}

// ── Tarjan SCC ───────────────────────────────────────────────────────────────

/**
 * Compute strongly connected components using Tarjan's algorithm.
 * Returns an array of SCCs; each SCC is a set of node IDs.
 * The result is in reverse topological order of the condensation.
 */
export function tarjanSCC(adj: Map<string, string[]>): Set<string>[] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const sccs: Set<string>[] = [];
  let counter = 0;

  function strongconnect(v: string): void {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.set(v, true);

    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.get(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }

    if (lowlink.get(v) === index.get(v)) {
      const scc = new Set<string>();
      let w: string;
      do {
        w = stack.pop()!;
        onStack.set(w, false);
        scc.add(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const id of adj.keys()) {
    if (!index.has(id)) strongconnect(id);
  }

  return sccs;
}

// ── SCC-based loop validation ───────────────────────────────────────────────

/**
 * Validate strongly connected components.
 *
 * - Single-node SCCs with no self-loop are fine (acyclic).
 * - Single-node SCCs with a self-loop require a condition node (i.e. the
 *   node itself is a condition).
 * - Multi-node SCCs (true cycles / loops) require:
 *     1. At least one `condition` node inside the SCC.
 *     2. At least one branch of that condition node pointing OUTSIDE the SCC
 *        (the loop-exit path).
 *
 * Additional rule for trigger nodes in cycles:
 *   A sync trigger node (awaitResult !== false) inside a cycle will cause
 *   unbounded synchronous recursion unless a condition guard also breaks the
 *   cycle.  If a sync trigger node is found in a cycle we verify that the
 *   cycle ALSO satisfies the normal condition-exit rule above — the standard
 *   SCC validation already enforces this, but we emit a more helpful
 *   diagnostic that mentions the trigger node by name.
 *
 *   An async trigger node (awaitResult=false) inside a cycle is always fine
 *   because it fires and continues without blocking the stack.
 */
function validateSCCs(
  graph: GraphDefinition,
  nodeIds: Set<string>,
): GraphValidationError[] {
  const errors: GraphValidationError[] = [];
  const adj = buildAdjacency(graph, nodeIds);
  const sccs = tarjanSCC(adj);
  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  for (const scc of sccs) {
    if (scc.size === 1) {
      const [id] = scc;
      // Catch nodes are always valid as standalone nodes — they fire via
      // runtime exit reasons, not via graph edges or SCC membership.
      if (nodeMap.get(id!)?.type === "catch") continue;
      // Self-loop?
      const hasSelfLoop = (adj.get(id!) ?? []).includes(id!);
      if (!hasSelfLoop) continue; // Normal single node — ok

      // Self-loop: the node must be a condition (its default / branch provides the exit)
      const n = nodeMap.get(id!);
      if (n?.type !== "condition") {
        // Special case: a trigger node with awaitResult=false (async) may safely
        // self-loop because it never blocks the caller.
        if (n?.type === "trigger" && n.awaitResult === false) continue;
        errors.push({
          nodeId: id,
          message: `Node "${id}" has a self-loop but is not a condition node. \
A self-loop requires a condition node to provide a loop-exit branch.`,
        });
      }
      continue;
    }

    // Multi-node SCC — check for sync trigger nodes first to emit actionable advice.
    const syncTriggerIds = [...scc].filter((id) => {
      const n = nodeMap.get(id);
      return n?.type === "trigger" && n.awaitResult !== false;
    });

    // Must have a condition node with an exit branch.
    const hasCond = [...scc].some((id) => nodeMap.get(id)?.type === "condition");
    if (!hasCond) {
      if (syncTriggerIds.length > 0) {
        errors.push({
          message:
            `Cycle (${[...scc].join(", ")}) contains sync trigger node(s) ` +
            `(${syncTriggerIds.join(", ")}) with no condition node to guard the loop. ` +
            `Set awaitResult=false on the trigger node(s) for async fire-and-forget, ` +
            `or add a condition node with an exit branch to bound the recursion.`,
        });
      } else {
        errors.push({
          message: `Graph contains a cycle (${[...scc].join(", ")}) with no condition node. \
Add a condition node with at least one branch exiting the cycle to create a valid loop.`,
        });
      }
      continue;
    }

    // Check that at least one condition node in the SCC has an exit branch.
    const hasExit = [...scc].some((id) => {
      const n = nodeMap.get(id);
      if (n?.type !== "condition") return false;
      for (const branch of n.branches ?? []) {
        if (branch.target && !scc.has(branch.target)) return true;
      }
      if (n.defaultTarget && !scc.has(n.defaultTarget)) return true;
      return false;
    });

    if (!hasExit) {
      if (syncTriggerIds.length > 0) {
        errors.push({
          message:
            `Loop cycle (${[...scc].join(", ")}) contains sync trigger node(s) ` +
            `(${syncTriggerIds.join(", ")}) but the condition node has no exit branch — ` +
            `this would recurse indefinitely. Set awaitResult=false on the trigger node(s) ` +
            `or add a condition branch targeting a node outside the loop.`,
        });
      } else {
        errors.push({
          message: `Loop cycle (${[...scc].join(", ")}) has no exit branch — this would loop forever. \
Add a branch on the condition node that targets a node outside the loop.`,
        });
      }
    }
  }

  return errors;
}

