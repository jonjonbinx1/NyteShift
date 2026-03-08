import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext.js";
import type { ThemePalette } from "../theme/themes.js";
import type { GraphDefinitionInfo, GraphNodeInfo, GraphEdgeInfo, GraphExecutionResultInfo, ToolInfo, NodeRunState, NodeRunEvent } from "../global.js";
import { GraphCanvas, NODE_TYPE_STYLES } from "../components/GraphCanvas.js";
import { NodeConfigPanel } from "../components/NodeConfigPanel.js";
import VarsEditor from "../components/VarsEditor.js";

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
  const [tab, setTab] = useState<"visual" | "json">("visual");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [varsOpen, setVarsOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"" | "saved" | "error">("");

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

  // Meta for config panel dropdowns
  const [agents, setAgents] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);

  // ── Load graph ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isNew) return;
    (async () => {
      setLoading(true);
      try {
        const g = await window.solixApi?.graphLoad(id!);
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
        const ags = await window.solixApi?.listAgents() ?? [];
        // listAgents historically returned string[]; some callers may return
        // { name } records — normalize to string names for dropdowns.
        const names = (ags as any[]).map((a) => (typeof a === "string" ? a : (a?.name ?? String(a))));
        setAgents(names);
      } catch { /* best effort */ }
      // Providers: prefer the runtime-registered providers (same pattern as ProviderConfig)
      try {
        const ps = await window.solixApi?.listProviders() ?? [];
        setProviders(ps.map((p: any) => p.id));
      } catch {
        // fallback to a small known list if provider enumeration fails
        setProviders(["anthropic", "openai", "openrouter"]);
      }
      // subscribe to provider changes (e.g. user added providers at runtime)
      try {
        window.solixApi?.onProvidersChanged?.(() => {
          window.solixApi?.listProviders().then((ps: any) => setProviders(ps.map((p: any) => p.id))).catch(console.error);
        });
      } catch {}
      // Tools: populate available tools (detailed info) for tool node dropdowns
      try {
        const ts = await window.solixApi?.listTools() ?? [];
        setTools(ts as ToolInfo[]);
      } catch {
        setTools([]);
      }
      try {
        window.solixApi?.onToolsChanged?.(() => {
          window.solixApi?.listTools().then((ts: any) => setTools(ts as ToolInfo[])).catch(console.error);
        });
      } catch {}
    })();
  }, []);

  // ── Register IPC listeners for run events ──────────────────────────────────
  useEffect(() => {
    window.solixApi?.onGraphNodeStart?.((data: any) => {
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
    window.solixApi?.onGraphNodeComplete?.((data: any) => {
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
    window.solixApi?.onGraphRunComplete?.((data: any) => {
      if (data.runId !== runIdRef.current) return;
      setRunning(false);
      if (data.result) setRunResult(data.result);
      if (data.error) setRunError(data.error);
    });
  }, []); // register once on mount

  // ── Restore any active runs for this graph when graph is available ─────
  useEffect(() => {
    if (isNew || !graph?.id) return;
    (async () => {
      try {
        const runs = await window.solixApi?.graphRuns() ?? [];
        const myRuns = (runs as any[]).filter(r => r.graphId === graph.id);
        if (!myRuns || myRuns.length === 0) return;
        const latest = myRuns.reduce((a, b) => ((a.startedAt ?? 0) > (b.startedAt ?? 0) ? a : b));
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
  }, [graph?.id, isNew]);

  // ── Graph mutations ─────────────────────────────────────────────────────────
  // Normalize tool names to installed canonical names (e.g. solix/gmail)
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

    // trailing segment match (e.g., saved "gmail" matches "solix/gmail")
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

  const addNode = useCallback((type: GraphNodeInfo["type"]) => {
    const id = nextId(type);
    const count = graph.nodes.filter(n => n.type === type).length;
    const defaults: Partial<GraphNodeInfo> = type === "llm"
      ? { promptTemplate: "{{input.query}}", temperature: 0.7 }
      : type === "agent"
      ? { promptTemplate: "{{input.task}}", maxSteps: 20 }
      : type === "condition"
      ? { branches: [{ label: "Branch 1", condition: { ref: "input.value", operator: "exists" }, target: "" }] }
      : type === "operation"
      ? { operationAction: { op: "inc", varName: "page", amount: 1 } }
      : {};

    const name = `${NODE_TYPE_STYLES[type]?.label ?? type} ${count + 1}`;
    // Place near center of viewport, staggered
    const x = 220 + (graph.nodes.length % 3) * 240;
    const y = 120 + Math.floor(graph.nodes.length / 3) * 150;

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
      await window.solixApi?.graphSave(toSave);
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

    setRunNodeStates({});
    setRunLog([]);
    setRunStartedAt(Date.now());
    setRunResult(null);
    setRunError(null);
    setRunning(true);

    try {
      // Normalize tool names, save first so runner can load by ID
      const toSave = normalizeGraphToolNames(graph);
      await window.solixApi?.graphSave(toSave);
      setGraph(toSave);
      setJsonText(JSON.stringify(toSave, null, 2));
      const res = await window.solixApi?.graphRun(toSave.id, { input }) as { runId: string };
      setRunId(res.runId);
      runIdRef.current = res.runId;
    } catch (e) {
      setRunning(false);
      setRunError((e as Error).message);
    }
  };

  const handleCancelRun = async () => {
    if (runId) await window.solixApi?.graphRunCancel(runId);
    setRunning(false);
  };

  // ── Validate ───────────────────────────────────────────────────────────────

  const [validating, setValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const handleValidate = async () => {
    setValidating(true);
    setValidationErrors(null);
    try {
      const result = await window.solixApi?.graphValidate(graph);
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
          style={{ ...inputStyle, width: 80 }}
          type="number"
          min={1}
          value={graph.maxIterations ?? ""}
          onChange={e => updateGraph({ maxIterations: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="Max iter"
          title="Maximum loop iterations (default 100)"
        />
        <button onClick={() => setVarsOpen(true)} title="Edit graph variables"
          style={{ marginLeft: 8, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: "transparent", color: C.text, cursor: "pointer" }}>
          Vars
        </button>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, background: C.mantle, borderRadius: 6, padding: 2 }}>
          {(["visual", "json"] as const).map(t => (
            <button key={t} onClick={() => t === "json" ? onSwitchToJson() : setTab("visual")}
              style={{
                padding: "4px 12px", border: "none", borderRadius: 5, cursor: "pointer",
                background: tab === t ? C.surface0 : "transparent",
                color: tab === t ? C.text : C.subtext0,
                fontSize: "0.8rem", fontWeight: tab === t ? 600 : 400,
              }}>
              {t === "visual" ? "🗺 Visual" : "{ } JSON"}
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
        <button onClick={() => navigate(runId ? `/graph-run/${encodeURIComponent(runId)}` : "/graph-runs")}
          style={{ ...actionBtn(C), background: "transparent", border: `1px solid ${C.surface2}`, color: C.text }}>
          Runs
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ ...actionBtn(C), background: C.mauve, color: "#1e1e2e" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <VarsEditor open={varsOpen} vars={graph.initVars ?? {}} onChange={(v) => updateGraph({ initVars: v })} onClose={() => setVarsOpen(false)} />

        {saveStatus === "saved" && <span style={{ color: C.green, fontSize: "0.78rem" }}>✓ Saved</span>}
        {saveStatus === "error" && <span style={{ color: C.red, fontSize: "0.78rem" }}>✗ Error</span>}
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

        {/* Center: Canvas or JSON */}
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
          />
        ) : (
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
        )}

        {/* Right: Node Config Panel */}
        {tab === "visual" && selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            allNodes={graph.nodes}
            agents={agents}
            tools={tools}
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
      onClick={() => onAdd(type)}
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

function RunPanel({ C, running, runLog, runNodeStates, runStartedAt, runResult, runError, runInput, runInputError, onRunInputChange, onRun, onCancel, onClose }: {
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
}) {
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
        <div style={{ width: 230, borderRight: `1px solid ${C.surface1}`, padding: 10, display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 600, color: C.subtext0 }}>Input Variables (JSON)</div>
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
