import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext.js";
import type { NodeRunEvent, NodeRunState, GraphExecutionResultInfo, GraphNodeInfo, GraphEdgeInfo } from "../global.js";
import { GraphCanvas, NODE_TYPE_STYLES } from "../components/GraphCanvas.js";

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function GraphRunPage(): React.JSX.Element {
  const { runId } = useParams<{ runId: string }>();
  const { palette: C } = useTheme();
  const navigate = useNavigate();

  const [runLog, setRunLog] = useState<NodeRunEvent[]>([]);
  const [runNodeStates, setRunNodeStates] = useState<Record<string, NodeRunState>>({});
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<GraphExecutionResultInfo | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const runIdRef = useRef<string | null>(null);
  const [graphDef, setGraphDef] = useState<{ nodes: GraphNodeInfo[]; edges: GraphEdgeInfo[] } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [stopModalOpen, setStopModalOpen] = useState(false);

  useEffect(() => {
    if (!runId) return;
    runIdRef.current = runId;

    (async () => {
      try {
        const status = await window.nyteShiftApi?.graphRunStatus(runId);
        if (status) {
          setRunning(status.status === "running");
          if (status.result) setRunResult(status.result as GraphExecutionResultInfo);
          if (status.error) setRunError(status.error as string);
          if ((status as any).startedAt) setRunStartedAt((status as any).startedAt as number);
          // seed log from nodeProgress
          if (Array.isArray((status as any).nodeProgress)) {
            const seeded = (status as any).nodeProgress.map((n: any) => ({
              nodeId: n.nodeId,
              nodeName: n.nodeName,
              nodeType: (n as any).nodeType ?? "llm",
              startedAt: n.timestamp ?? Date.now(),
              endedAt: n.timestamp ?? undefined,
              elapsedMs: n.metadata?.elapsedMs ?? undefined,
              status: n.status,
              output: n.output,
              error: n.error,
            } as NodeRunEvent));
            setRunLog(seeded);

            // seed runNodeStates so canvas can render completed nodes immediately
            const seededStates: Record<string, NodeRunState> = {};
            (status as any).nodeProgress.forEach((n: any) => {
              seededStates[n.nodeId] = {
                status: n.status as NodeRunState["status"],
                startedAt: n.timestamp ?? Date.now(),
                elapsedMs: n.metadata?.elapsedMs,
                iteration: n.metadata?.iteration,
                output: n.output,
                error: n.error,
              } as NodeRunState;
            });
            setRunNodeStates(seededStates);
          }

          // load the graph definition for visualisation when available
          const graphId = (status as any).result?.graphId as string | undefined;
          if (graphId) {
            try {
              const g = await window.nyteShiftApi?.graphLoad(graphId);
              if (g) setGraphDef({ nodes: (g.nodes ?? []) as GraphNodeInfo[], edges: (g.edges ?? []) as GraphEdgeInfo[] });
            } catch (e) {
              console.error("graphLoad error:", e);
            }
          }
        }
      } catch (err) {
        console.error("graphRunStatus error:", err);
      }
    })();

    const cleanupNodeStart = window.nyteShiftApi?.onGraphNodeStart?.((data: any) => {
      if (data.runId !== runIdRef.current) return;
      const nodeId: string = data.nodeId;
      const nodeName: string = data.nodeName;
      const startedAt = Date.now();
      setRunNodeStates(prev => ({ ...prev, [nodeId]: { status: "running", startedAt } }));
      setRunLog(prev => [...prev, { nodeId, nodeName, nodeType: data.nodeType ?? "llm", startedAt, status: "running" } as NodeRunEvent]);
    });

    const cleanupNodeComplete = window.nyteShiftApi?.onGraphNodeComplete?.((data: any) => {
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

        // No running entry found (start event missed) — append a completed entry
        const startedAtApprox = (no.timestamp as number | undefined) ?? (now - (elapsedMs ?? 0));
        const nodeName = (no.nodeName as string | undefined) ?? nodeId;
        const newEntry: NodeRunEvent = {
          nodeId,
          nodeName,
          nodeType: (no as any).nodeType ?? "llm",
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
      cleanupNodeStart?.();
      cleanupNodeComplete?.();
      cleanupRunComplete?.();
    };
  }, [runId]);

  const handleAbort = async () => {
    if (!runId) return;
    setStopModalOpen(false);
    try { await window.nyteShiftApi?.graphRunCancel(runId); } catch (err) { console.error(err); }
    setRunning(false);
  };

  const handleStop = async () => {
    if (!runId) return;
    setStopModalOpen(false);
    try { await window.nyteShiftApi?.graphRunStop(runId); } catch (err) { console.error(err); }
    // run continues to natural completion — do not forcibly set running(false)
  };

  const elapsed = runStartedAt && running ? Date.now() - runStartedAt : runResult?.elapsedMs ?? 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderBottom: `1px solid ${C.surface1}`, background: C.surface0 }}>
        <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", cursor: "pointer", color: C.subtext0 }}>← Back</button>
        <div style={{ fontWeight: 700 }}>{runId}</div>
        <div style={{ flex: 1 }} />
        {running ? <button onClick={() => setStopModalOpen(true)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.red}`, background: `${C.red}22`, color: C.red }}>Stop</button>
          : <div style={{ color: runResult ? C.green : runError ? C.red : C.overlay0 }}>{runResult ? "Completed" : runError ? `Error: ${runError}` : "Idle"}</div>}
      </div>

      <div style={{ padding: 12, overflow: "hidden", flex: 1, display: "flex", gap: 12 }}>
        {/* Left: Canvas */}
        <div style={{ flex: 1, minWidth: 480, height: "100%", display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, minHeight: 320 }}>
            <GraphCanvas
              nodes={graphDef?.nodes ?? []}
              edges={graphDef?.edges ?? []}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={null}
              runProgress={runNodeStates}
              onNodeSelect={(id) => setSelectedNodeId(id)}
              onEdgeSelect={() => {}}
              onNodeMoved={() => {}}
              onAddEdge={() => {}}
              onSetBranchTarget={() => {}}
              onDeleteNode={() => {}}
              onDeleteEdge={() => {}}
              onClearBranchTarget={() => {}}
            />
          </div>
        </div>

        {/* Right: Timeline & Details */}
        <div style={{ width: 460, maxWidth: "46%", display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
          {selectedNodeId && (
            <div style={{ padding: 10, borderRadius: 8, border: `1px solid ${C.surface1}`, marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>{graphDef?.nodes?.find(n => n.id === selectedNodeId)?.name ?? selectedNodeId}</div>
              <div style={{ color: C.overlay0, fontSize: "0.85rem", marginTop: 6 }}>{runNodeStates[selectedNodeId]?.status ?? "idle"}</div>
            </div>
          )}

          {runLog.length === 0 && !runResult && !runError && (
            <div style={{ color: C.overlay0 }}>No events yet.</div>
          )}

          {runLog.map(ev => {
            const key = `${ev.nodeId}-${ev.startedAt}`;
            const nodeTypeCfg = NODE_TYPE_STYLES[ev.nodeType as keyof typeof NODE_TYPE_STYLES];
            const isActive = ev.status === "running";
            const statusColor = isActive ? C.yellow : ev.status === "success" ? C.green : ev.status === "error" ? C.red : C.overlay0;
            const statusIcon = isActive ? "⏳" : ev.status === "success" ? "✓" : ev.status === "error" ? "✗" : "—";
            const isSelected = selectedNodeId === ev.nodeId;
            return (
              <div key={key} style={{ padding: 8, borderRadius: 6, border: isSelected ? `1px solid ${C.mauve}33` : `1px solid ${C.surface1}`, marginBottom: 8, display: "flex", gap: 10, alignItems: "flex-start", background: isSelected ? `${C.mauve}08` : undefined }}>
                <div style={{ width: 18, textAlign: "center", color: statusColor }}>{statusIcon}</div>
                <div style={{ width: 22, height: 22, borderRadius: 4, background: nodeTypeCfg?.color ?? C.surface2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{nodeTypeCfg?.icon ?? "?"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: isActive ? 700 : 600 }}>{ev.nodeName}</div>
                  {ev.output !== undefined && <pre style={{ marginTop: 6, padding: 8, background: C.mantle, borderRadius: 6, fontSize: "0.85rem", overflow: "auto" }}>{typeof ev.output === "string" ? ev.output : JSON.stringify(ev.output, null, 2)}</pre>}
                  {ev.error && <div style={{ color: C.red, marginTop: 6 }}>{ev.error}</div>}
                </div>
                <div style={{ textAlign: "right", minWidth: 64 }}>{ev.elapsedMs !== undefined ? formatMs(ev.elapsedMs) : isActive ? "…" : ""}</div>
              </div>
            );
          })}

          {runResult && !runError && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 6, border: `1px solid ${C.green}44`, background: C.mantle }}>
              <div style={{ fontWeight: 700, color: C.green, marginBottom: 6 }}>Final Output</div>
              <pre style={{ margin: 0, overflow: "auto" }}>{typeof runResult.finalOutput === "string" ? runResult.finalOutput : JSON.stringify(runResult.finalOutput, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>

      {stopModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: C.base, border: `1px solid ${C.surface1}`, borderRadius: 10, padding: "24px 28px", minWidth: 320, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontWeight: 700, fontSize: "1rem" }}>Stop Run?</div>
            <div style={{ color: C.subtext0, fontSize: "0.85rem" }}>Choose how to stop the current run:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={handleAbort} style={{ padding: "10px 16px", borderRadius: 6, border: `1px solid ${C.red}`, background: `${C.red}22`, color: C.red, cursor: "pointer", textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>⚡ Abort</div>
                <div style={{ fontSize: "0.78rem", color: C.subtext0, marginTop: 2 }}>Kill immediately. Catch nodes will not run.</div>
              </button>
              <button onClick={handleStop} style={{ padding: "10px 16px", borderRadius: 6, border: `1px solid ${C.yellow}`, background: `${C.yellow}22`, color: C.yellow, cursor: "pointer", textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>⏹ Stop</div>
                <div style={{ fontSize: "0.78rem", color: C.subtext0, marginTop: 2 }}>Finish the current step, then stop. Catch nodes will run.</div>
              </button>
              <button onClick={() => setStopModalOpen(false)} style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: "none", color: C.subtext0, cursor: "pointer" }}>
                Keep Running
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
