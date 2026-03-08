import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext.js";

export function GraphRunsView(): React.JSX.Element {
  const { palette: C } = useTheme();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await window.solixApi?.graphRuns() ?? [];
      setRuns(res);
    } catch (err) {
      console.error("graphRuns refresh error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <div>
      <h1>Runs</h1>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button onClick={refresh} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.surface0, cursor: "pointer" }}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        <span style={{ color: C.overlay0 }}>{runs.length} run{runs.length !== 1 ? "s" : ""}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {runs.length === 0 && <div style={{ color: C.overlay0 }}>No active or tracked runs.</div>}
        {runs.map((r: any) => (
          <div key={r.runId} style={{ padding: 10, borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.mantle, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{r.graphId ?? "(graph)"}</div>
              <div style={{ color: C.overlay0, fontSize: "0.85rem" }}>{r.runId}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: r.status === "running" ? C.yellow : r.status === "done" ? C.green : C.red, fontWeight: 700 }}>{r.status}</div>
              <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => navigate(`/graph-run/${encodeURIComponent(r.runId)}`)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.surface1}`, background: C.surface0, cursor: "pointer" }}>View</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
