import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext.js";
import type { GraphRunRecordInfo } from "../global.js";

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function sourceLabel(r: GraphRunRecordInfo): string {
  if (r.source === "trigger") return `${r.triggerName ?? r.triggerId ?? "trigger"} (${r.triggerType ?? "?"})`;
  if (r.source === "trigger-node") return "Trigger Node";
  return "Manual";
}

export function GraphRunsView(): React.JSX.Element {
  const { palette: C } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const graphId = searchParams.get("graphId") ?? undefined;

  const [runs, setRuns] = useState<GraphRunRecordInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = graphId
        ? await window.nyteShiftApi?.graphRunsForGraph(graphId) ?? []
        : await window.nyteShiftApi?.graphRuns() ?? [];
      setRuns(res);
    } catch (err) {
      console.error("graphRuns refresh error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [graphId]);

  const SOURCE_COLORS: Record<string, string> = {
    manual: C.mauve,
    trigger: C.blue,
    "trigger-node": C.peach,
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700 }}>
            {graphId ? "Graph Runs" : "All Graph Runs"}
          </h1>
          {graphId && (
            <div style={{ color: C.subtext0, fontSize: "0.82rem", marginTop: 3 }}>
              Filtered to graph: <code style={{ color: C.mauve }}>{graphId}</code>
            </div>
          )}
        </div>
        {graphId && (
          <button onClick={() => navigate(`/graphs/${graphId}`)}
            style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.surface0, cursor: "pointer", fontSize: "0.82rem" }}>
            ← Open Graph
          </button>
        )}
        <button onClick={refresh}
          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.surface0, cursor: "pointer" }}>
          {loading ? "Refreshing…" : "↺ Refresh"}
        </button>
        <span style={{ color: C.overlay0, fontSize: "0.82rem" }}>{runs.length} run{runs.length !== 1 ? "s" : ""}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {runs.length === 0 && !loading && (
          <div style={{ color: C.overlay0, padding: "40px 0", textAlign: "center" }}>
            No tracked runs yet.
          </div>
        )}
        {runs.map((r) => {
          const statusColor = r.status === "done" ? C.green : r.status === "error" ? C.red : C.yellow;
          const statusIcon = r.status === "done" ? "✓" : r.status === "error" ? "✗" : "⏳";
          const srcColor = SOURCE_COLORS[r.source] ?? C.overlay0;
          return (
            <div key={r.runId} style={{
              padding: "12px 14px", borderRadius: 8,
              border: `1px solid ${C.surface1}`, background: C.surface0,
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{ color: statusColor, fontWeight: 700, width: 18, textAlign: "center" }}>{statusIcon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 3 }}>
                  {r.graphName || r.graphId}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: "0.72rem", fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                    background: `${srcColor}22`, color: srcColor, border: `1px solid ${srcColor}44`,
                  }}>
                    {r.source === "manual" ? "Manual" : r.source === "trigger-node" ? "Trigger Node" : "Trigger"}
                  </span>
                  {r.source !== "manual" && (
                    <span style={{ color: C.subtext0, fontSize: "0.78rem" }}>{sourceLabel(r)}</span>
                  )}
                  <span style={{ color: C.overlay0, fontSize: "0.75rem" }}>
                    {relTime(r.startedAt)} · {r.nodeProgress.length} event{r.nodeProgress.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {r.error && (
                  <div style={{ color: C.red, fontSize: "0.78rem", marginTop: 4 }}>{r.error}</div>
                )}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <div style={{ color: statusColor, fontSize: "0.78rem", fontWeight: 600 }}>
                  {r.status === "running" ? "Running…" : r.status === "done" ? "Done" : "Error"}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {!graphId && (
                    <button onClick={() => navigate(`/graphs/${r.graphId}`)}
                      style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.mantle, color: C.subtext0, cursor: "pointer", fontSize: "0.75rem" }}>
                      Graph
                    </button>
                  )}
                  <button onClick={() => navigate(`/graph-run/${encodeURIComponent(r.runId)}`)}
                    style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.mantle, color: C.text, cursor: "pointer", fontSize: "0.78rem" }}>
                    View
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

