import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext.js";
import type { GraphRunRecordInfo } from "../global.js";

type StatusFilter = "all" | "running" | "done" | "error";
type SourceFilter = "all" | "manual" | "trigger" | "trigger-node";

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  // Stable ref so IPC callbacks always use the latest graphId without
  // re-registering listeners on every render.
  const graphIdRef = useRef(graphId);
  graphIdRef.current = graphId;

  const refresh = async () => {
    setLoading(true);
    try {
      const res = graphIdRef.current
        ? await window.nyteShiftApi?.graphRunsForGraph(graphIdRef.current) ?? []
        : await window.nyteShiftApi?.graphRuns() ?? [];
      setRuns(res);
    } catch (err) {
      console.error("graphRuns refresh error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Ref so polling / IPC callbacks always call the latest refresh without
  // triggering effect re-registration.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Initial load and reload when graphId changes.
  useEffect(() => { void refresh(); }, [graphId]);

  // Register IPC-push listeners once on mount.  These fire immediately when
  // a run is registered or completes so the list stays current without
  // waiting for the next poll tick.
  useEffect(() => {
    const cleanupRegistered = window.nyteShiftApi?.onGraphRunRegistered(() => { void refreshRef.current(); });
    const cleanupComplete = window.nyteShiftApi?.onGraphRunComplete(() => { void refreshRef.current(); });
    return () => {
      cleanupRegistered?.();
      cleanupComplete?.();
    };
  }, []);

  // Auto-poll every 3 s while any run is still active so progress counters
  // (node events) stay up to date.  The interval is cleared as soon as there
  // are no more running runs.
  const hasRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => { void refreshRef.current(); }, 3000);
    return () => clearInterval(id);
  }, [hasRunning]);

  // ── Derived counts for tab badges ────────────────────────────────────────
  const countByStatus: Record<StatusFilter, number> = {
    all: runs.length,
    running: runs.filter((r) => r.status === "running").length,
    done: runs.filter((r) => r.status === "done").length,
    error: runs.filter((r) => r.status === "error").length,
  };

  // ── Filtered + sorted list ────────────────────────────────────────────────
  // Running runs are always sorted to the top so they are never buried.
  const visible = runs
    .filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      return b.startedAt - a.startedAt;
    });

  // ── Style helpers ─────────────────────────────────────────────────────────
  const SOURCE_COLORS: Record<string, string> = {
    manual: C.mauve,
    trigger: C.blue,
    "trigger-node": C.peach,
  };

  const tabBtn = (active: boolean, accentColor?: string) => ({
    padding: "5px 13px",
    borderRadius: 20,
    border: `1px solid ${active ? (accentColor ?? C.blue) : C.surface1}`,
    background: active ? `${accentColor ?? C.blue}20` : C.surface0,
    color: active ? (accentColor ?? C.blue) : C.subtext0,
    cursor: "pointer" as const,
    fontSize: "0.82rem",
    fontWeight: active ? 700 : 400,
    transition: "all 0.15s",
    display: "inline-flex" as const,
    alignItems: "center" as const,
    gap: 5,
  });

  const badge = (n: number, active: boolean, accentColor?: string) => ({
    background: active ? (accentColor ?? C.blue) : C.surface1,
    color: active ? C.base : C.subtext0,
    borderRadius: 10,
    padding: "1px 6px",
    fontSize: "0.7rem",
    fontWeight: 700 as const,
  });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
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
        <button onClick={() => void refresh()}
          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.surface0, cursor: "pointer" }}>
          {loading ? "Refreshing…" : "↺ Refresh"}
        </button>
      </div>

      {/* ── Status tabs ── */}
      <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {(["all", "running", "done", "error"] as StatusFilter[]).map((s) => {
          const accent = s === "running" ? C.yellow : s === "done" ? C.green : s === "error" ? C.red : undefined;
          return (
            <button key={s} onClick={() => setStatusFilter(s)} style={tabBtn(statusFilter === s, accent)}>
              {s === "all" ? "All" : s === "running" ? "Running" : s === "done" ? "Completed" : "Error"}
              <span style={badge(countByStatus[s], statusFilter === s, accent)}>
                {countByStatus[s]}
              </span>
              {s === "running" && countByStatus.running > 0 && (
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: C.yellow, display: "inline-block",
                  animation: "nsRunPulse 1.4s ease-in-out infinite",
                }} />
              )}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        {/* ── Source filter ── */}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ color: C.overlay0, fontSize: "0.76rem", marginRight: 2 }}>Source:</span>
          {(["all", "manual", "trigger", "trigger-node"] as SourceFilter[]).map((s) => (
            <button key={s} onClick={() => setSourceFilter(s)} style={{
              padding: "4px 9px",
              borderRadius: 12,
              border: `1px solid ${sourceFilter === s ? (SOURCE_COLORS[s] ?? C.blue) : C.surface1}`,
              background: sourceFilter === s ? `${SOURCE_COLORS[s] ?? C.blue}20` : C.surface0,
              color: sourceFilter === s ? (SOURCE_COLORS[s] ?? C.blue) : C.subtext0,
              cursor: "pointer",
              fontSize: "0.74rem",
            }}>
              {s === "all" ? "All" : s === "manual" ? "Manual" : s === "trigger" ? "Trigger" : "Trigger Node"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Auto-refresh notice ── */}
      {hasRunning && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          color: C.yellow, fontSize: "0.76rem", marginBottom: 10,
        }}>
          <span style={{
            display: "inline-block", width: 7, height: 7, borderRadius: "50%",
            background: C.yellow, animation: "nsRunPulse 1.4s ease-in-out infinite",
          }} />
          {countByStatus.running} run{countByStatus.running !== 1 ? "s" : ""} in progress — refreshing automatically
        </div>
      )}

      {/* ── Run list ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.length === 0 && !loading && (
          <div style={{ color: C.overlay0, padding: "40px 0", textAlign: "center" }}>
            {runs.length === 0
              ? "No tracked runs yet."
              : "No runs match the current filters."}
          </div>
        )}

        {visible.map((r) => {
          const isRunning = r.status === "running";
          const statusColor = isRunning ? C.yellow : r.status === "done" ? C.green : C.red;
          const statusIcon = isRunning ? "⏳" : r.status === "done" ? "✓" : "✗";
          const srcColor = SOURCE_COLORS[r.source] ?? C.overlay0;

          return (
            <div key={r.runId} style={{
              padding: "12px 14px",
              borderRadius: 8,
              border: `1px solid ${isRunning ? `${C.yellow}50` : C.surface1}`,
              background: isRunning ? `${C.yellow}07` : C.surface0,
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}>
              {/* Status icon */}
              <div style={{ color: statusColor, fontWeight: 700, width: 20, textAlign: "center", fontSize: "1rem", flexShrink: 0 }}>
                {statusIcon}
              </div>

              {/* Body */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 3, display: "flex", alignItems: "center", gap: 8 }}>
                  {r.graphName || r.graphId}
                  {isRunning && (
                    <span style={{
                      fontSize: "0.68rem", padding: "1px 7px", borderRadius: 10,
                      background: `${C.yellow}25`, color: C.yellow,
                      border: `1px solid ${C.yellow}50`, fontWeight: 600,
                      animation: "nsRunPulse 1.4s ease-in-out infinite",
                    }}>
                      LIVE
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: "0.72rem", fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                    background: `${srcColor}20`, color: srcColor, border: `1px solid ${srcColor}40`,
                  }}>
                    {r.source === "manual" ? "Manual" : r.source === "trigger-node" ? "Trigger Node" : "Trigger"}
                  </span>
                  {r.source !== "manual" && (
                    <span style={{ color: C.subtext0, fontSize: "0.77rem" }}>{sourceLabel(r)}</span>
                  )}
                  <span style={{ color: C.overlay0, fontSize: "0.74rem" }}>
                    {relTime(r.startedAt)} · {r.nodeProgress.length} event{r.nodeProgress.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {r.error && (
                  <div style={{ color: C.red, fontSize: "0.77rem", marginTop: 4 }}>{r.error}</div>
                )}
              </div>

              {/* Actions */}
              <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                <div style={{ color: statusColor, fontSize: "0.77rem", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                  {isRunning && (
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: C.yellow, display: "inline-block",
                      animation: "nsRunPulse 1.4s ease-in-out infinite",
                    }} />
                  )}
                  {isRunning ? "Running…" : r.status === "done" ? "Done" : "Error"}
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  {!graphId && (
                    <button onClick={() => navigate(`/graphs/${r.graphId}`)}
                      style={{ padding: "4px 9px", borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.mantle, color: C.subtext0, cursor: "pointer", fontSize: "0.74rem" }}>
                      Graph
                    </button>
                  )}
                  <button onClick={() => navigate(`/graph-run/${encodeURIComponent(r.runId)}`)}
                    style={{
                      padding: "4px 12px", borderRadius: 6, fontSize: "0.77rem", cursor: "pointer",
                      border: `1px solid ${isRunning ? C.yellow : C.surface1}`,
                      background: isRunning ? `${C.yellow}15` : C.mantle,
                      color: isRunning ? C.yellow : C.text,
                      fontWeight: isRunning ? 700 : 400,
                    }}>
                    {isRunning ? "Watch →" : "View"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes nsRunPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

