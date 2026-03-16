import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext.js";
import type { ThemePalette } from "../theme/themes.js";
import type { GraphDefinitionInfo, GraphNodeInfo, GraphEdgeInfo, GraphExecutionResultInfo, GraphRunRecordInfo, ToolInfo, NodeRunState, NodeRunEvent, CatchTrigger, GraphInputInfo } from "../global.js";
import { GraphCanvas, NODE_TYPE_STYLES } from "../components/GraphCanvas.js";
import { NodeConfigPanel } from "../components/NodeConfigPanel.js";
import type { SkillInfo } from "../components/NodeConfigPanel.js";
import VarsEditor from "../components/VarsEditor.js";
import InputVariablesEditor from "../components/InputVariablesEditor.js";

// ── Defaults ──────────────────────────────────────────────────────────────────

function newGraph(): GraphDefinitionInfo {
  return {
    id: `graph-${Date.now()}`,
    name: "New Graph",
    description: "",
    version: "1.0.0",
    nodes: [
      { id: "input-1", name: "Input", type: "input", position: { x: 80, y: 160 } },
      { id: "output-1", name: "Output", type: "output", position: { x: 520, y: 160 } },
    ],
    edges: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function nextId(type: string): string {
  return `${type}-${Date.now().toString(36)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GraphBuilderPage(): React.JSX.Element {
  const { palette: C } = useTheme();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";

  const [graph, setGraph] = useState<GraphDefinitionInfo>(newGraph);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"visual" | "json" | "runs">("visual");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [varsOpen, setVarsOpen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"" | "saved" | "error">("");
  const [edgeError, setEdgeError] = useState<string | null>(null);

  // Run state
  const [runOpen, setRunOpen] = useState(false);
  const [runInput, setRunInput] = useState("{}");
  const [runInputError, setRunInputError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runNodeStates, setRunNodeStates] = useState<Record<string, NodeRunState>>({});
  const [runLog, setRunLog] = useState<NodeRunEvent[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runResult, setRunResult] = useState<GraphExecutionResultInfo | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runIdRef = useRef<string | null>(null);
  // Keep a ref to the latest graph so IPC callbacks can read current node types
  const graphRef = useRef<GraphDefinitionInfo>(graph);
  useEffect(() => { graphRef.current = graph; }, [graph]);

  // Past runs for this graph (loaded when switching to Runs tab)
  const [pastRuns, setPastRuns] = useState<GraphRunRecordInfo[]>([]);
  const [pastRunsLoading, setPastRunsLoading] = useState(false);

  // Meta for config panel dropdowns
  const [agents, setAgents] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  // ── Load graph ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isNew) return;
    (async () => {
      setLoading(true);
      try {
        const g = await window.nyteShiftApi?.graphLoad(id!);
        if (g) { setGraph(g); setJsonText(JSON.stringify(g, null, 2)); }
        else navigate("/graphs");
      } catch { navigate("/graphs"); }
      finally { setLoading(false); }
    })();
  }, [id, isNew, navigate]);

  // Load agent/provider/tool lists for dropdown configuration
  useEffect(() => {
    (async () => {
      try {
        const ags = await window.nyteShiftApi?.listAgents() ?? [];
        // listAgents historically returned string[]; some callers may return
        // { name } records — normalize to string names for dropdowns.
        const names = (ags as any[]).map((a) => (typeof a === "string" ? a : (a?.name ?? String(a))));
        setAgents(names);
      } catch { /* best effort */ }
      // Providers: prefer the runtime-registered providers (same pattern as ProviderConfig)
      try {
        const ps = await window.nyteShiftApi?.listProviders() ?? [];
        setProviders(ps.map((p: any) => p.id));
      } catch {
        // fallback to a small known list if provider enumeration fails
        setProviders(["anthropic", "openai", "openrouter"]);
      }
      // subscribe to provider changes (e.g. user added providers at runtime)
      try {
        window.nyteShiftApi?.onProvidersChanged?.(() => {
          window.nyteShiftApi?.listProviders().then((ps: any) => setProviders(ps.map((p: any) => p.id))).catch(console.error);
        });
      } catch {}
      // Tools: populate available tools (detailed info) for tool node dropdowns
      try {
        const ts = await window.nyteShiftApi?.listTools() ?? [];
        setTools(ts as ToolInfo[]);
      } catch {
        setTools([]);
      }
      try {
        window.nyteShiftApi?.onToolsChanged?.(() => {
          window.nyteShiftApi?.listTools().then((ts: any) => setTools(ts as ToolInfo[])).catch(console.error);
        });
      } catch {}
      try {
        const ss = await window.nyteShiftApi?.listSkills() ?? [];
        setSkills(ss as SkillInfo[]);
      } catch {
        setSkills([]);
      }
    })();
  }, []);

  // ── Register IPC listeners for run events ──────────────────────────────────
  useEffect(() => {
    const cleanupStart = window.nyteShiftApi?.onGraphNodeStart?.((data: any) => {
      if (data.runId !== runIdRef.current) return;
      const nodeId: string = data.nodeId;
      const nodeName: string = data.nodeName;
      const nodeInfo = graphRef.current.nodes.find(n => n.id === nodeId);
      const startedAt = Date.now();
      setRunNodeStates(prev => ({
        ...prev,
        [nodeId]: { status: "running", startedAt },
      }));
      setRunLog(prev => [...prev, {
        nodeId,
        nodeName,
        nodeType: nodeInfo?.type ?? "llm",
        startedAt,
        status: "running",
      } as NodeRunEvent]);
    });
    const cleanupComplete = window.nyteShiftApi?.onGraphNodeComplete?.((data: any) => {
      if (data.runId !== runIdRef.current) return;
      const no = data.nodeOutput;
      const nodeId: string = no.nodeId;
      const elapsedMs: number | undefined = no.metadata?.elapsedMs;
      const iteration: number | undefined = no.metadata?.iteration;
      const now = Date.now();
      setRunNodeStates(prev => ({
        ...prev,
        [nodeId]: {
          ...(prev[nodeId] ?? { startedAt: now }),
          status: no.status as NodeRunState["status"],
          elapsedMs,
          iteration,
          output: no.output,
          error: no.error,
        },
      }));
      setRunLog(prev => {
        // Find the last "running" entry for this nodeId and update it
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i]!.nodeId === nodeId && prev[i]!.status === "running") {
            const updated = [...prev];
            updated[i] = {
              ...updated[i]!,
              status: no.status as NodeRunEvent["status"],
              endedAt: now,
              elapsedMs: elapsedMs ?? (now - updated[i]!.startedAt),
              iteration,
              output: no.output,
              error: no.error,
            };
            return updated;
          }
        }

        // If there was no prior "running" entry (listener missed the start event),
        // append a completed entry so the run log includes this node's output.
        const nodeInfo = graphRef.current.nodes.find(n => n.id === nodeId);
        const startedAtApprox = (no.timestamp as number | undefined) ?? (now - (elapsedMs ?? 0));
        const newEntry: NodeRunEvent = {
          nodeId,
          nodeName: nodeInfo?.name ?? (no.nodeName ?? nodeId),
          nodeType: nodeInfo?.type ?? "llm",
          startedAt: startedAtApprox,
          endedAt: now,
          elapsedMs: elapsedMs ?? Math.max(0, now - startedAtApprox),
          status: no.status as NodeRunEvent["status"],
          output: no.output,
          error: no.error,
          iteration,
        } as NodeRunEvent;
        return [...prev, newEntry];
      });
    });
    const cleanupRunComplete = window.nyteShiftApi?.onGraphRunComplete?.((data: any) => {
      if (data.runId !== runIdRef.current) return;
      setRunning(false);
      if (data.result) setRunResult(data.result);
      if (data.error) setRunError(data.error);
    });

    return () => {
      cleanupStart?.();
      cleanupComplete?.();
      cleanupRunComplete?.();
    };
  }, []); // register once on mount

  // ── Restore any active runs for this graph when graph is available ─────
  useEffect(() => {
    if (isNew || !graph?.id) return;

    let cancelled = false;
    // Snapshot the ref value NOW (before any async work).  If handleRun fires
    // while the IPC is in-flight and writes a NEW runId into the ref, we bail
    // rather than overwriting it with a stale restored ID — that was the root
    // cause of event-filter mismatches that left the run panel stuck on
    // "Starting execution...".
    const runIdSnapshot = runIdRef.current;
    const graphId = graph.id;

    (async () => {
      try {
        // Use the per-graph query instead of graphRuns() so we don't
        // deserialise all 2000+ runs over IPC on every page load.
        const runs = await window.nyteShiftApi?.graphRunsForGraph(graphId) ?? [];
        if (cancelled) return;
        // If handleRun already started a new run while we were waiting, skip.
        if (runIdRef.current !== runIdSnapshot) return;
        if (!runs || runs.length === 0) return;
        const latest = (runs as any[]).reduce((a: any, b: any) =>
          ((a.startedAt ?? 0) > (b.startedAt ?? 0) ? a : b));
        if (!latest) return;

        setRunId(latest.runId);
        runIdRef.current = latest.runId;
        setRunOpen(true);
        setRunning(latest.status === "running");
        setRunResult(latest.result ?? null);
        setRunError(latest.error ?? null);
        if ((latest as any).startedAt) setRunStartedAt((latest as any).startedAt as number);

        if (Array.isArray((latest as any).nodeProgress)) {
          const seeded = (latest as any).nodeProgress.map((n: any) => ({
            nodeId: n.nodeId,
            nodeName: n.nodeName,
            nodeType: n.nodeType ?? "llm",
            startedAt: n.timestamp ?? Date.now(),
            endedAt: n.timestamp ?? undefined,
            elapsedMs: n.metadata?.elapsedMs ?? undefined,
            status: n.status,
            output: n.output,
            error: n.error,
            iteration: n.metadata?.iteration,
          } as NodeRunEvent));
          setRunLog(seeded);

          const states: Record<string, NodeRunState> = {};
          for (const n of (latest as any).nodeProgress) {
            states[n.nodeId] = {
              status: n.status,
              startedAt: n.timestamp ?? Date.now(),
              elapsedMs: n.metadata?.elapsedMs,
              iteration: n.metadata?.iteration,
              output: n.output,
              error: n.error,
            } as NodeRunState;
          }
          setRunNodeStates(states);
        }
      } catch (err) {
        console.error("error restoring graph runs:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [graph?.id, isNew]);

  // ── Graph mutations ─────────────────────────────────────────────────────────
  // Normalize tool names to installed canonical names (e.g. nyteshift/gmail)
  const canonicalizeToolName = useCallback((name?: string) => {
    if (!name) return undefined;
    const trimmed = String(name).trim();
    if (!trimmed) return undefined;

    // prefer exact qualified match: contributor/name
    const exactQualified = tools.find(t => `${t.contributor}/${t.name}` === trimmed);
    if (exactQualified) return `${exactQualified.contributor}/${exactQualified.name}`;

    // direct name match
    const byName = tools.find(t => t.name === trimmed);
    if (byName) return `${byName.contributor}/${byName.name}`;

    // case-insensitive checks
    const lower = trimmed.toLowerCase();
    const byQualifiedCi = tools.find(t => `${t.contributor}/${t.name}`.toLowerCase() === lower);
    if (byQualifiedCi) return `${byQualifiedCi.contributor}/${byQualifiedCi.name}`;
    const byNameCi = tools.find(t => t.name.toLowerCase() === lower);
    if (byNameCi) return `${byNameCi.contributor}/${byNameCi.name}`;

    // trailing segment match (e.g., saved "gmail" matches "nyteshift/gmail")
    const byTrailing = tools.find(t => `${t.contributor}/${t.name}`.toLowerCase().endsWith(`/${lower}`));
    if (byTrailing) return `${byTrailing.contributor}/${byTrailing.name}`;

    return trimmed;
  }, [tools]);

  const normalizeGraphToolNames = useCallback((g: GraphDefinitionInfo) => {
    return {
      ...g,
      nodes: g.nodes.map(n => {
        if (n.type !== "tool") return n;
        const canonical = canonicalizeToolName(n.toolName ?? "");
        if (!canonical) return n;
        if (canonical === (n.toolName ?? "")) return n;
        return { ...n, toolName: canonical };
      }),
    } as GraphDefinitionInfo;
  }, [canonicalizeToolName]);

  const updateGraph = useCallback((patch: Partial<GraphDefinitionInfo>) => {
    setGraph(g => ({ ...g, ...patch, updatedAt: Date.now() }));
  }, []);

  const addNode = useCallback((type: GraphNodeInfo["type"], position?: { x: number; y: number }) => {
    const id = nextId(type);
    const count = graph.nodes.filter(n => n.type === type).length;
    const defaults: Partial<GraphNodeInfo> = type === "llm"
      ? { promptTemplate: "{{input.query}}", temperature: 0.7 }
      : type === "skill"
      ? { skillRef: "", params: {} }
      : type === "agent"
      ? { promptTemplate: "{{input.task}}", maxSteps: 20 }
      : type === "trigger"
      ? { targetType: "graph", targetId: "", awaitResult: false, triggerInput: {} }
      : type === "condition"
      ? { branches: [{ label: "Branch 1", condition: { ref: "input.value", operator: "exists" }, target: "" }] }
      : type === "operation"
      ? { operationAction: { op: "inc", varName: "page", amount: 1 } }
      : type === "catch"
      ? { catchTriggers: ["maxIterations", "error"] as CatchTrigger[] }
      : {};

    const name = `${NODE_TYPE_STYLES[type]?.label ?? type} ${count + 1}`;
    // Place at drop position when provided, otherwise near center of viewport staggered
    const x = position?.x ?? (220 + (graph.nodes.length % 3) * 240);
    const y = position?.y ?? (120 + Math.floor(graph.nodes.length / 3) * 150);

    setGraph(g => ({
      ...g,
      updatedAt: Date.now(),
      nodes: [...g.nodes, { id, name, type, position: { x, y }, ...defaults }],
    }));
    setSelectedNodeId(id);
  }, [graph.nodes]);

  const deleteNode = useCallback((nodeId: string) => {
    setGraph(g => {
      const nodes = g.nodes
        .filter(n => n.id !== nodeId)
        .map(n => n.type !== "condition" ? n : {
          ...n,
          branches: n.branches?.map(b => b.target === nodeId ? { ...b, target: "" } : b),
          defaultTarget: n.defaultTarget === nodeId ? undefined : n.defaultTarget,
        });
      const edges = g.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
      return { ...g, nodes, edges, updatedAt: Date.now() };
    });
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

  const updateNode = useCallback((updated: GraphNodeInfo) => {
    setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === updated.id ? updated : n), updatedAt: Date.now() }));
  }, []);

  const nodeMoved = useCallback((nodeId: string, pos: { x: number; y: number }) => {
    setGraph(g => ({
      ...g,
      nodes: g.nodes.map(n => n.id === nodeId ? { ...n, position: pos } : n),
      updatedAt: Date.now(),
    }));
  }, []);

  const addEdge = useCallback((source: string, target: string) => {
    if (source === target) return;
    // UI: prevent drawing incoming edges to a catch node (catch nodes fire
    // on loop exit; incoming edges are unnecessary and may confuse users)
    const targetNode = graphRef.current.nodes.find(n => n.id === target);
    if (targetNode?.type === "catch") {
      setEdgeError("Cannot connect to Catch node — it fires on loop exit.");
      // clear after a short delay
      setTimeout(() => setEdgeError(null), 3000);
      return;
    }

    setGraph(g => {
      // no duplicate edges
      if (g.edges.some(e => e.source === source && e.target === target)) return g;
      const id = `edge-${Date.now().toString(36)}`;
      return { ...g, edges: [...g.edges, { id, source, target }], updatedAt: Date.now() };
    });
  }, []);

  const deleteEdge = useCallback((edgeId: string) => {
    setGraph(g => ({ ...g, edges: g.edges.filter(e => e.id !== edgeId), updatedAt: Date.now() }));
  }, []);

  const setBranchTarget = useCallback((nodeId: string, branchIndex: number, targetNodeId: string) => {
    setGraph(g => ({
      ...g,
      updatedAt: Date.now(),
      nodes: g.nodes.map(n => {
        if (n.id !== nodeId || n.type !== "condition") return n;
        if (branchIndex === -1) return { ...n, defaultTarget: targetNodeId || undefined };
        const branches = [...(n.branches ?? [])];
        if (branches[branchIndex]) branches[branchIndex] = { ...branches[branchIndex]!, target: targetNodeId };
        return { ...n, branches };
      }),
    }));
  }, []);

  const clearBranchTarget = useCallback((nodeId: string, branchIndex: number) => {
    setBranchTarget(nodeId, branchIndex, "");
  }, [setBranchTarget]);

  const duplicateNode = useCallback((nodeId: string) => {
    const original = graph.nodes.find(n => n.id === nodeId);
    if (!original) return;
    const newId = nextId(original.type);
    const copy: GraphNodeInfo = {
      ...original,
      id: newId,
      name: `${original.name} (copy)`,
      position: { x: (original.position?.x ?? 0) + 30, y: (original.position?.y ?? 0) + 30 },
    };
    setGraph(g => ({ ...g, nodes: [...g.nodes, copy], updatedAt: Date.now() }));
    setSelectedNodeId(newId);
  }, [graph.nodes]);

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("");
    try {
      const toSave = normalizeGraphToolNames(graph);
      // persist canonicalized graph and update UI
      await window.nyteShiftApi?.graphSave(toSave);
      setGraph(toSave);
      setJsonText(JSON.stringify(toSave, null, 2));
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  // ── JSON tab sync ──────────────────────────────────────────────────────────

  const onSwitchToJson = () => {
    setJsonText(JSON.stringify(graph, null, 2));
    setJsonError(null);
    setTab("json");
  };

  const onApplyJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const normalized = normalizeGraphToolNames({ ...parsed, updatedAt: Date.now() } as GraphDefinitionInfo);
      setGraph(normalized);
      setJsonText(JSON.stringify(normalized, null, 2));
      setJsonError(null);
      setTab("visual");
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  // ── Run ────────────────────────────────────────────────────────────────────

  const handleRun = async () => {
    setRunInputError(null);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(runInput);
    } catch {
      setRunInputError("Invalid JSON for input variables.");
      return;
    }

    // Pre-generate and register the runId BEFORE the IPC call so that
    // node:start / node:complete events arriving via the registry listeners
    // pass the runId filter even if they fire before the invoke promise
    // resolves (the IPC round-trip takes longer than one main-process tick).
    const newRunId = `graph:${crypto.randomUUID()}`;
    runIdRef.current = newRunId;
    setRunId(newRunId);
    setRunOpen(true);

    setRunNodeStates({});
    setRunLog([]);
    setRunStartedAt(Date.now());
    setRunResult(null);
    setRunError(null);
    setRunning(true);

    try {
      // Normalize tool names, save first so runner can load by ID
      const toSave = normalizeGraphToolNames(graph);
      await window.nyteShiftApi?.graphSave(toSave);
      setGraph(toSave);
      setJsonText(JSON.stringify(toSave, null, 2));
      // Pass the pre-generated runId so both ends agree on the identifier.
      await window.nyteShiftApi?.graphRun(toSave.id, { input, runId: newRunId });
    } catch (e) {
      setRunning(false);
      setRunError((e as Error).message);
    }
  };

  const handleCancelRun = async () => {
    if (runId) await window.nyteShiftApi?.graphRunCancel(runId);
    setRunning(false);
  };

  // ── Validate ───────────────────────────────────────────────────────────────

  const [validating, setValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const handleValidate = async () => {
    setValidating(true);
    setValidationErrors(null);
    try {
      const result = await window.nyteShiftApi?.graphValidate(graph);
      if (result?.valid) setValidationErrors([]);
      else setValidationErrors(result?.errors?.map((e: any) => e.message || String(e)) ?? ["Unknown error"]);
    } catch (e) {
      setValidationErrors([(e as Error).message]);
    } finally {
      setValidating(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const selectedNode = selectedNodeId ? graph.nodes.find(n => n.id === selectedNodeId) ?? null : null;

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.subtext0 }}>
        Loading graph…
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    padding: "5px 8px", background: C.mantle,
    border: `1px solid ${C.surface2}`, borderRadius: 6,
    color: C.text, fontSize: "0.82rem", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ── Top Bar ───────────────────────────────────────────────────────── */}
      <div style={{
        height: 52, background: C.surface0, borderBottom: `1px solid ${C.surface1}`,
        display: "flex", alignItems: "center", gap: 10, padding: "0 14px",
        flexShrink: 0,
      }}>
        <button onClick={() => navigate("/graphs")} style={{ background: "none", border: "none", cursor: "pointer", color: C.subtext0, fontSize: "0.85rem", padding: "4px 6px", borderRadius: 6 }}>
          ← Back
        </button>

        <input
          style={{ ...inputStyle, width: 200, fontWeight: 600 }}
          value={graph.name}
          onChange={e => updateGraph({ name: e.target.value })}
          placeholder="Graph Name"
        />

        <input
          style={{ ...inputStyle, flex: 1, color: C.subtext0, fontStyle: "italic" }}
          value={graph.description ?? ""}
          onChange={e => updateGraph({ description: e.target.value || undefined })}
          placeholder="Description (optional)"
        />

        <input
          style={{ ...inputStyle, width: 90, opacity: graph.unbounded ? 0.45 : 1 }}
          type="number"
          min={1}
          disabled={graph.unbounded === true}
          value={graph.unbounded ? "" : (graph.maxIterations ?? "")}
          onChange={e => updateGraph({ maxIterations: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="Default: 100"
          title={graph.unbounded ? "Disabled — graph is set to Unbounded" : "Maximum loop iterations (default: 100)"}
        />
        <label
          title="Allow loops to run indefinitely. Only a condition-exit, error, or AbortSignal can stop the loop. The 'Max Iterations' catch trigger will never fire."
          style={{
            display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
            fontSize: "0.78rem",
            color: graph.unbounded ? C.red : C.subtext0,
            padding: "3px 7px", borderRadius: 5, userSelect: "none",
            background: graph.unbounded ? `${C.red}22` : "transparent",
            border: `1px solid ${graph.unbounded ? C.red : "transparent"}`,
          }}
        >
          <input
            type="checkbox"
            checked={graph.unbounded === true}
            onChange={e => updateGraph({ unbounded: e.target.checked ? true : undefined })}
            style={{ accentColor: C.red, cursor: "pointer", margin: 0 }}
          />
          ∞ Unbounded
        </label>
        <button onClick={() => setVarsOpen(true)} title="Edit graph variables"
          style={{ marginLeft: 8, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: "transparent", color: C.text, cursor: "pointer" }}>
          Vars
        </button>
        <button onClick={() => setInputsOpen(true)} title="Edit graph inputs"
          style={{ marginLeft: 8, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: "transparent", color: C.text, cursor: "pointer" }}>
          Inputs
        </button>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, background: C.mantle, borderRadius: 6, padding: 2 }}>
          {(["visual", "json", "runs"] as const).map(t => (
            <button key={t} onClick={() => {
              if (t === "json") onSwitchToJson();
              else if (t === "runs") {
                setTab("runs");
                // Refresh past runs list
                if (graph?.id && !isNew) {
                  setPastRunsLoading(true);
                  window.nyteShiftApi?.graphRunsForGraph(graph.id).then((r) => {
                    setPastRuns(r ?? []);
                  }).catch(console.error).finally(() => setPastRunsLoading(false));
                }
              } else setTab("visual");
            }}
              style={{
                padding: "4px 12px", border: "none", borderRadius: 5, cursor: "pointer",
                background: tab === t ? C.surface0 : "transparent",
                color: tab === t ? C.text : C.subtext0,
                fontSize: "0.8rem", fontWeight: tab === t ? 600 : 400,
              }}>
              {t === "visual" ? "🗺 Visual" : t === "json" ? "{ } JSON" : "▶ Runs"}
            </button>
          ))}
        </div>

        {/* Actions */}
        <button onClick={handleValidate} disabled={validating}
          style={{ ...actionBtn(C), background: "transparent", border: `1px solid ${C.surface2}`, color: C.text }}>
          {validating ? "…" : "Validate"}
        </button>
        <button onClick={() => setRunOpen(r => !r)}
          style={{ ...actionBtn(C), background: `${C.green}22`, border: `1px solid ${C.green}`, color: C.green }}>
          ▶ Run
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ ...actionBtn(C), background: C.mauve, color: "#1e1e2e" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <VarsEditor open={varsOpen} vars={graph.initVars ?? {}} onChange={(v) => updateGraph({ initVars: v })} onClose={() => setVarsOpen(false)} />
        <InputVariablesEditor open={inputsOpen} inputs={graph.inputs ?? []} onChange={(v) => updateGraph({ inputs: v })} onClose={() => setInputsOpen(false)} />

        {saveStatus === "saved" && <span style={{ color: C.green, fontSize: "0.78rem" }}>✓ Saved</span>}
        {saveStatus === "error" && <span style={{ color: C.red, fontSize: "0.78rem" }}>✗ Error</span>}
        {edgeError && <span style={{ color: C.yellow, fontSize: "0.78rem", marginLeft: 8 }}>{edgeError}</span>}
      </div>

      {/* ── Validation errors ──────────────────────────────────────── */}
      {validationErrors !== null && (
        <div style={{
          background: validationErrors.length === 0 ? `${C.green}15` : `${C.red}15`,
          borderBottom: `1px solid ${validationErrors.length === 0 ? C.green : C.red}44`,
          padding: "8px 16px", fontSize: "0.78rem",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <span style={{ color: validationErrors.length === 0 ? C.green : C.red }}>
            {validationErrors.length === 0
              ? "✓ Graph is valid"
              : `${validationErrors.length} validation error${validationErrors.length > 1 ? "s" : ""}: ${validationErrors.join(" · ")}`}
          </span>
          <button onClick={() => setValidationErrors(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.overlay0, fontSize: "0.9rem" }}>✕</button>
        </div>
      )}

      {/* ── Main area ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: Node Palette (visual tab only) */}
        {tab === "visual" && (
          <NodePalette onAdd={addNode} C={C} />
        )}

        {/* Center: Canvas, JSON, or Runs */}
        {tab === "visual" ? (
          <GraphCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            runProgress={running || !!runResult ? runNodeStates : undefined}
            onNodeSelect={setSelectedNodeId}
            onEdgeSelect={setSelectedEdgeId}
            onNodeMoved={nodeMoved}
            onAddEdge={addEdge}
            onSetBranchTarget={setBranchTarget}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
            onClearBranchTarget={clearBranchTarget}
            onDropAddNode={(type, pos) => addNode(type, pos)}
          />
        ) : tab === "json" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.mantle }}>
            <textarea
              style={{
                flex: 1, padding: 16, background: "transparent",
                color: C.text, fontFamily: "monospace", fontSize: "0.8rem",
                border: "none", outline: "none", resize: "none",
                borderBottom: `1px solid ${C.surface1}`,
              }}
              value={jsonText}
              onChange={e => { setJsonText(e.target.value); setJsonError(null); }}
              spellCheck={false}
            />
            <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, background: C.surface0 }}>
              <button onClick={onApplyJson}
                style={{ padding: "6px 16px", background: C.mauve, color: "#1e1e2e", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.8rem" }}>
                Apply JSON
              </button>
              {jsonError && <span style={{ color: C.red, fontSize: "0.78rem" }}>Parse error: {jsonError}</span>}
              <span style={{ color: C.overlay0, fontSize: "0.75rem", marginLeft: "auto" }}>
                Edit the graph definition directly, then click Apply.
              </span>
            </div>
          </div>
        ) : (
          <GraphRunsPanel
            C={C}
            graphId={graph.id}
            runs={pastRuns}
            loading={pastRunsLoading}
            currentRunId={runId}
            onNavigate={(id) => navigate(`/graph-run/${encodeURIComponent(id)}`)}
            onRefresh={() => {
              if (!graph?.id) return;
              setPastRunsLoading(true);
              window.nyteShiftApi?.graphRunsForGraph(graph.id).then((r) => {
                setPastRuns(r ?? []);
              }).catch(console.error).finally(() => setPastRunsLoading(false));
            }}
          />
        )}

        {/* Right: Node Config Panel (visual tab only) */}
        {tab === "visual" && selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            allNodes={graph.nodes}
            agents={agents}
            tools={tools}
            edges={graph.edges ?? []}
            skills={skills}
            providers={providers}
            vars={graph.initVars ?? {}}
            onChange={updateNode}
            onDelete={() => deleteNode(selectedNode.id)}
            onDuplicate={() => duplicateNode(selectedNode.id)}
            onOpenVars={() => setVarsOpen(true)}
          />
        )}
      </div>

      {/* ── Run Panel ─────────────────────────────────────────────────────── */}
      {runOpen && (
        <RunPanel
          C={C}
          running={running}
          runLog={runLog}
          runNodeStates={runNodeStates}
          runStartedAt={runStartedAt}
          runResult={runResult}
          runError={runError}
          runInput={runInput}
          graphInputs={graph.inputs ?? []}
          runInputError={runInputError}
          onRunInputChange={setRunInput}
          onRun={handleRun}
          onCancel={handleCancelRun}
          onClose={() => setRunOpen(false)}
        />
      )}
    </div>
  );
}

// ── Node Palette ──────────────────────────────────────────────────────────────

function NodePalette({ onAdd, C }: { onAdd(type: GraphNodeInfo["type"]): void; C: ThemePalette }) {
  const types = Object.entries(NODE_TYPE_STYLES).filter(([t]) => t !== "input" && t !== "output") as [GraphNodeInfo["type"], any][];
  const special = Object.entries(NODE_TYPE_STYLES).filter(([t]) => t === "input" || t === "output") as [GraphNodeInfo["type"], any][];

  const PaletteBtn = ([type, cfg]: [GraphNodeInfo["type"], any]) => (
    <button
      key={type}
      draggable={true}
      onDragStart={(e) => {
        try {
          e.dataTransfer.setData("application/nyteshift-node-type", type);
          e.dataTransfer.effectAllowed = "copy";
        } catch (err) { /* ignore */ }
      }}
      title={cfg.description}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", padding: "8px 10px", marginBottom: 4,
        background: "transparent", border: `1px solid ${C.surface1}`,
        borderRadius: 6, cursor: "pointer", textAlign: "left",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C.surface1; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{
        width: 24, height: 24, borderRadius: 5,
        background: cfg.color, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, flexShrink: 0,
      }}>
        {cfg.icon}
      </span>
      <div>
        <div style={{ fontSize: "0.75rem", fontWeight: 600, color: C.text }}>{cfg.label}</div>
      </div>
    </button>
  );

  return (
    <div style={{
      width: 160, background: C.surface0, borderRight: `1px solid ${C.surface1}`,
      padding: "12px 10px", flexShrink: 0, overflowY: "auto",
    }}>
      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: C.overlay0, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        Add Node
      </div>
      {types.map(PaletteBtn)}
      <div style={{ borderTop: `1px solid ${C.surface1}`, margin: "8px 0" }} />
      {special.map(PaletteBtn)}
    </div>
  );
}

// ── Run Panel ─────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function RunPanel({ C, running, runLog, runNodeStates, runStartedAt, runResult, runError, runInput, runInputError, onRunInputChange, onRun, onCancel, onClose, graphInputs }: {
  C: ThemePalette;
  running: boolean;
  runLog: NodeRunEvent[];
  runNodeStates: Record<string, NodeRunState>;
  runStartedAt: number | null;
  runResult: GraphExecutionResultInfo | null;
  runError: string | null;
  runInput: string;
  runInputError: string | null;
  onRunInputChange(v: string): void;
  onRun(): void;
  onCancel(): void;
  onClose(): void;
  graphInputs?: GraphInputInfo[];
}) {
  const [showRawInput, setShowRawInput] = useState(false);
  const [structuredInput, setStructuredInput] = useState<Record<string, unknown>>(() => {
    try { return runInput ? JSON.parse(runInput) : {}; } catch { return {}; }
  });

  useEffect(() => {
    try { setStructuredInput(runInput ? JSON.parse(runInput) : {}); } catch { setStructuredInput({}); }
  }, [runInput]);
  const [elapsed, setElapsed] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Live elapsed timer — ticks every 100ms while running
  useEffect(() => {
    if (!running || !runStartedAt) { setElapsed(0); return; }
    setElapsed(Date.now() - runStartedAt);
    const t = setInterval(() => setElapsed(Date.now() - runStartedAt!), 100);
    return () => clearInterval(t);
  }, [running, runStartedAt]);

  // Auto-scroll log to newest entry
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [runLog.length]);

  const activeEvent = runLog.slice().reverse().find(ev => ev.status === "running");

  return (
    <div style={{
      height: 310, background: C.surface0, borderTop: `1px solid ${C.surface1}`,
      display: "flex", flexDirection: "column", flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        height: 40, display: "flex", alignItems: "center",
        padding: "0 14px", borderBottom: `1px solid ${C.surface1}`,
        gap: 10, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: "0.82rem" }}>Run</span>
        {running && (
          <span style={{ fontSize: "0.75rem", color: C.yellow, display: "flex", alignItems: "center", gap: 6 }}>
            <span>⏳</span>
            <strong>{formatMs(elapsed)}</strong>
            {activeEvent && (
              <span style={{ color: C.overlay1 }}>· {activeEvent.nodeName}</span>
            )}
          </span>
        )}
        {!running && runResult && (
          <span style={{ fontSize: "0.75rem", color: C.green }}>
            ✓ Completed · <strong>{formatMs(runResult.elapsedMs)}</strong>
            <span style={{ color: C.overlay0, marginLeft: 6 }}>{runLog.length} nodes</span>
          </span>
        )}
        {!running && runError && (
          <span style={{ fontSize: "0.75rem", color: C.red }}>✗ {runError}</span>
        )}
        <div style={{ flex: 1 }} />
        {running
          ? <button onClick={onCancel} style={{ ...actionBtn(C), background: `${C.red}22`, border: `1px solid ${C.red}`, color: C.red }}>Stop</button>
          : <button onClick={onRun} style={{ ...actionBtn(C), background: C.green, color: "#1e1e2e" }}>▶ Run</button>
        }
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.overlay0, fontSize: "1rem" }}>✕</button>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Input variables */}
        <div style={{ width: 300, borderRight: `1px solid ${C.surface1}`, padding: 10, display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 600, color: C.subtext0, display: "flex", alignItems: "center", gap: 8 }}>
            <span>Input Variables</span>
            <button onClick={() => { setShowRawInput(s => !s); if (!showRawInput) onRunInputChange(JSON.stringify(structuredInput, null, 2)); }} style={{ border: "none", background: "transparent", color: C.subtext0, cursor: "pointer", fontSize: "0.75rem" }}>{showRawInput ? "Structured" : "Edit JSON"}</button>
          </div>

          {(!showRawInput && graphInputs && graphInputs.length > 0) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", paddingRight: 6 }}>
              {graphInputs.map((inp) => {
                const val = Object.prototype.hasOwnProperty.call(structuredInput, inp.key) ? structuredInput[inp.key] : (inp.default !== undefined ? inp.default : "");
                return (
                  <div key={inp.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ fontSize: "0.75rem", color: C.subtext0, fontWeight: 600 }}>{inp.label ?? inp.key}{inp.required ? " *" : ""}</label>
                    {inp.type === "boolean" ? (
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="checkbox" checked={!!val} onChange={e => {
                          const next = { ...structuredInput, [inp.key]: e.target.checked };
                          setStructuredInput(next);
                          onRunInputChange(JSON.stringify(next));
                        }} />
                        <span style={{ color: C.overlay0 }}>{inp.description ?? ""}</span>
                      </label>
                    ) : inp.type === "number" ? (
                      <input type="number" value={val === "" ? "" : String(val)} onChange={e => {
                        const nv = e.target.value === "" ? undefined : Number(e.target.value);
                        const next = { ...structuredInput, [inp.key]: nv };
                        setStructuredInput(next);
                        onRunInputChange(JSON.stringify(next));
                      }} style={{ padding: "6px 8px" }} />
                    ) : inp.type === "json" ? (
                      <textarea value={val === undefined ? "" : (typeof val === "string" ? val : JSON.stringify(val))} onChange={e => {
                        let parsed: unknown;
                        try { parsed = JSON.parse(e.target.value); } catch { parsed = e.target.value; }
                        const next = { ...structuredInput, [inp.key]: parsed };
                        setStructuredInput(next);
                        onRunInputChange(JSON.stringify(next));
                      }} style={{ padding: "6px 8px", fontFamily: "monospace" }} />
                    ) : (
                      <input value={val === undefined ? "" : String(val)} onChange={e => {
                        const next = { ...structuredInput, [inp.key]: e.target.value };
                        setStructuredInput(next);
                        onRunInputChange(JSON.stringify(next));
                      }} style={{ padding: "6px 8px" }} />
                    )}
                    {inp.description && <div style={{ fontSize: "0.72rem", color: C.overlay0 }}>{inp.description}</div>}
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setShowRawInput(true); onRunInputChange(JSON.stringify(structuredInput, null, 2)); }} style={{ border: "none", background: "transparent", color: C.subtext0, cursor: "pointer" }}>Edit as JSON</button>
              </div>
            </div>
          ) : (
            <textarea
              style={{
                flex: 1, padding: 8, background: C.mantle,
                border: `1px solid ${runInputError ? C.red : C.surface2}`, borderRadius: 6,
                color: C.text, fontFamily: "monospace", fontSize: "0.75rem",
                outline: "none", resize: "none",
              }}
              value={runInput}
              onChange={e => onRunInputChange(e.target.value)}
              disabled={running}
              placeholder={'{\n  "query": "Hello!"\n}'}
            />
          )}

          {runInputError && <div style={{ fontSize: "0.7rem", color: C.red }}>{runInputError}</div>}
        </div>

        {/* Execution log timeline */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {runLog.length === 0 && !runResult && !runError && (
            <div style={{ color: C.overlay0, fontSize: "0.78rem", padding: "10px 14px" }}>
              {running ? "Starting execution…" : "Configure inputs and click ▶ Run."}
            </div>
          )}

          {runLog.map(ev => {
            const key = `${ev.nodeId}-${ev.startedAt}`;
            const isExpanded = expandedKey === key;
            const nodeTypeCfg = NODE_TYPE_STYLES[ev.nodeType as keyof typeof NODE_TYPE_STYLES];
            const isActive = ev.status === "running";
            const statusColor = isActive ? C.yellow
              : ev.status === "success" ? C.green
              : ev.status === "error" ? C.red : C.overlay0;
            const statusIcon = isActive ? "⏳"
              : ev.status === "success" ? "✓"
              : ev.status === "error" ? "✗" : "—";
            const canExpand = ev.output !== undefined || !!ev.error;

            return (
              <div
                key={key}
                onClick={() => canExpand && setExpandedKey(isExpanded ? null : key)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "5px 12px",
                  background: isActive ? `${C.yellow}12` : "transparent",
                  borderLeft: `3px solid ${isActive ? C.yellow : "transparent"}`,
                  cursor: canExpand ? "pointer" : "default",
                  transition: "background 0.15s",
                }}
              >
                {/* Status icon */}
                <span style={{ fontSize: "0.72rem", color: statusColor, flexShrink: 0, marginTop: 3, width: 14, textAlign: "center" }}>
                  {statusIcon}
                </span>

                {/* Node type chip */}
                <span style={{
                  width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                  background: nodeTypeCfg?.color ?? C.surface2,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.6rem",
                }}>
                  {nodeTypeCfg?.icon ?? "?"}
                </span>

                {/* Name + iteration badge + output */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: "0.78rem",
                      fontWeight: isActive ? 700 : 500,
                      color: C.text,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {ev.nodeName}
                    </span>
                    {ev.iteration !== undefined && ev.iteration > 0 && (
                      <span style={{
                        fontSize: "0.62rem", padding: "1px 5px", borderRadius: 10,
                        background: `${C.teal}22`, color: C.teal, border: `1px solid ${C.teal}44`,
                        whiteSpace: "nowrap",
                      }}>
                        iter {ev.iteration + 1}
                      </span>
                    )}
                    {canExpand && !isExpanded && (
                      <span style={{ fontSize: "0.6rem", color: C.overlay0 }}>{isActive ? "" : "▸"}</span>
                    )}
                    {canExpand && isExpanded && (
                      <span style={{ fontSize: "0.6rem", color: C.overlay0 }}>▾</span>
                    )}
                  </div>

                  {/* Expanded output */}
                  {isExpanded && ev.output !== undefined && (
                    <pre style={{
                      marginTop: 4, padding: "4px 6px", background: C.mantle, borderRadius: 4,
                      fontSize: "0.67rem", color: C.text, overflow: "auto", maxHeight: 100,
                      border: `1px solid ${C.surface2}`, margin: "3px 0 0",
                    }}>
                      {typeof ev.output === "string" ? ev.output : JSON.stringify(ev.output, null, 2)}
                    </pre>
                  )}
                  {ev.error && (
                    <div style={{ fontSize: "0.67rem", color: C.red, marginTop: 2 }}>{ev.error}</div>
                  )}
                </div>

                {/* Elapsed time */}
                <div style={{ flexShrink: 0, textAlign: "right", minWidth: 42 }}>
                  {isActive ? (
                    <span style={{ fontSize: "0.67rem", color: `${C.yellow}aa` }}>…</span>
                  ) : ev.elapsedMs !== undefined ? (
                    <span style={{ fontSize: "0.67rem", color: C.overlay0 }}>{formatMs(ev.elapsedMs)}</span>
                  ) : null}
                </div>
              </div>
            );
          })}

          {/* Final output block */}
          {runResult && !runError && (
            <div style={{
              margin: "8px 12px 4px", padding: 8, background: C.mantle,
              borderRadius: 6, border: `1px solid ${C.green}44`,
            }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 600, color: C.green, marginBottom: 4 }}>
                ✓ Final Output
              </div>
              <pre style={{ margin: 0, fontSize: "0.7rem", color: C.text, overflow: "auto", maxHeight: 80 }}>
                {typeof runResult.finalOutput === "string"
                  ? runResult.finalOutput
                  : JSON.stringify(runResult.finalOutput, null, 2)}
              </pre>
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function actionBtn(C: ThemePalette): React.CSSProperties {
  return {
    padding: "5px 12px", border: "none", borderRadius: 6,
    cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap",
  };
}

// ── GraphRunsPanel ─────────────────────────────────────────────────────────

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function sourceLabel(run: GraphRunRecordInfo): string {
  if (run.source === "trigger") return `Trigger: ${run.triggerName ?? run.triggerId ?? "unknown"} (${run.triggerType ?? "?"})`;
  if (run.source === "trigger-node") return "Trigger Node";
  return "Manual";
}

interface GraphRunsPanelProps {
  C: ThemePalette;
  graphId: string;
  runs: GraphRunRecordInfo[];
  loading: boolean;
  currentRunId: string | null;
  onNavigate(runId: string): void;
  onRefresh(): void;
}

function GraphRunsPanel({ C, runs, loading, currentRunId, onNavigate, onRefresh }: GraphRunsPanelProps): React.JSX.Element {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.base }}>
      {/* Header */}
      <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.surface1}`, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Run History</span>
        <span style={{ color: C.overlay0, fontSize: "0.8rem" }}>{runs.length} run{runs.length !== 1 ? "s" : ""}</span>
        <div style={{ flex: 1 }} />
        <button onClick={onRefresh} disabled={loading}
          style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.surface0, color: C.text, cursor: "pointer", fontSize: "0.78rem" }}>
          {loading ? "Refreshing…" : "↺ Refresh"}
        </button>
      </div>

      {/* Run list */}
      <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
        {loading && runs.length === 0 && (
          <div style={{ color: C.overlay0, padding: "20px 0", textAlign: "center", fontSize: "0.85rem" }}>Loading…</div>
        )}
        {!loading && runs.length === 0 && (
          <div style={{ color: C.overlay0, padding: "40px 0", textAlign: "center", fontSize: "0.85rem" }}>
            No runs recorded yet. Run this graph manually or attach a trigger.
          </div>
        )}
        {runs.map((r) => {
          const isCurrent = r.runId === currentRunId;
          const statusColor = r.status === "done" ? C.green : r.status === "error" ? C.red : C.yellow;
          const statusIcon = r.status === "done" ? "✓" : r.status === "error" ? "✗" : "⏳";
          const sourceColor = r.source === "manual" ? C.mauve : r.source === "trigger" ? C.blue : C.peach;
          return (
            <div key={r.runId} style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 8,
              border: `1px solid ${isCurrent ? C.mauve : C.surface1}`,
              background: C.surface0,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{ width: 20, textAlign: "center", color: statusColor, fontWeight: 700 }}>{statusIcon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: "0.72rem", fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                    background: `${sourceColor}22`, color: sourceColor, border: `1px solid ${sourceColor}44`,
                  }}>
                    {r.source === "manual" ? "Manual" : r.source === "trigger-node" ? "Trigger Node" : "Trigger"}
                  </span>
                  {(r.source === "trigger" || r.source === "trigger-node") && (
                    <span style={{ color: C.subtext0, fontSize: "0.78rem" }}>{sourceLabel(r)}</span>
                  )}
                  {isCurrent && (
                    <span style={{ fontSize: "0.7rem", color: C.mauve }}>● current</span>
                  )}
                </div>
                <div style={{ marginTop: 3, fontSize: "0.78rem", color: C.overlay0 }}>
                  {relTime(r.startedAt)} · {r.nodeProgress.length} node event{r.nodeProgress.length !== 1 ? "s" : ""}
                  {r.error && <span style={{ color: C.red }}> · {r.error}</span>}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ color: statusColor, fontSize: "0.78rem", fontWeight: 600, marginBottom: 6 }}>
                  {r.status === "running" ? "Running…" : r.status === "done" ? "Done" : "Error"}
                </div>
                <button onClick={() => onNavigate(r.runId)}
                  style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text, cursor: "pointer", fontSize: "0.78rem" }}>
                  View
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
