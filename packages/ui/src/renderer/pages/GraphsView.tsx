import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext.js";
import type { GraphDefinitionInfo } from "../global.js";

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function nodeCountLabel(g: GraphDefinitionInfo): string {
  const types = g.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(types).map(([t, c]) => `${c} ${t}`);
  return parts.join(", ") || "empty";
}

const TYPE_ICONS: Record<string, string> = {
  input: "▶", output: "⏹", llm: "🧠", agent: "🤖", tool: "🔧", condition: "⋔",
};

export function GraphsView(): React.JSX.Element {
  const { palette: C } = useTheme();
  const navigate = useNavigate();
  const [graphs, setGraphs] = useState<GraphDefinitionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.solixApi?.graphList() ?? [];
      setGraphs(list.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (g: GraphDefinitionInfo, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (!confirm(`Delete graph "${g.name}"? This cannot be undone.`)) return;
    setDeleting(g.id);
    try {
      await window.solixApi?.graphDelete(g.id);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  const card = { bg: C.surface0, border: C.surface1 };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>Agent Graphs</h1>
          <p style={{ margin: "4px 0 0", color: C.subtext0, fontSize: "0.85rem" }}>
            Build deterministic pipelines — chain agents, LLM calls, and tools in a visual DAG
          </p>
        </div>
        <button
          onClick={() => navigate("/graphs/new")}
          style={{
            padding: "9px 18px", background: C.mauve, color: "#1e1e2e",
            border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.875rem",
            flexShrink: 0,
          }}
        >
          + New Graph
        </button>
      </div>

      {loading && (
        <div style={{ color: C.subtext0, padding: "3rem 0", textAlign: "center", fontSize: "0.9rem" }}>
          Loading graphs…
        </div>
      )}

      {error && (
        <div style={{
          color: C.red, padding: "12px 16px", borderRadius: 8,
          background: `${C.red}15`, marginBottom: 16, fontSize: "0.875rem",
        }}>
          {error}
        </div>
      )}

      {!loading && !error && graphs.length === 0 && (
        <div style={{
          textAlign: "center", padding: "5rem 2rem",
          background: C.surface0, borderRadius: 14,
          border: `1px dashed ${C.surface2}`,
        }}>
          <div style={{ fontSize: "3rem", marginBottom: 14 }}>🔗</div>
          <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: 8 }}>No graphs yet</div>
          <p style={{ color: C.subtext0, fontSize: "0.875rem", margin: "0 auto 20px", maxWidth: 360 }}>
            Create a graph to chain agents, LLM calls, and tools together in a deterministic flow.
          </p>
          <button
            onClick={() => navigate("/graphs/new")}
            style={{
              padding: "10px 24px", background: C.mauve, color: "#1e1e2e",
              border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700,
            }}
          >
            Create your first graph
          </button>
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: 16,
      }}>
        {graphs.map((g) => (
          <div
            key={g.id}
            onClick={() => navigate(`/graphs/${g.id}`)}
            style={{
              background: card.bg, border: `1px solid ${card.border}`,
              borderRadius: 12, padding: "18px", cursor: "pointer",
              transition: "border-color 0.12s, box-shadow 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = C.mauve;
              e.currentTarget.style.boxShadow = `0 0 0 1px ${C.mauve}30`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = card.border;
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {/* Title row */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {g.name}
                </div>
                <div style={{ fontSize: "0.7rem", color: C.overlay0, marginTop: 2 }}>
                  v{g.version} · {relTime(g.updatedAt)}
                </div>
              </div>
              <span style={{
                fontSize: "0.7rem", padding: "2px 8px", borderRadius: 6,
                background: `${C.blue}22`, color: C.blue, fontWeight: 700,
                flexShrink: 0, marginLeft: 8,
              }}>
                {g.nodes.length} nodes
              </span>
            </div>

            {g.description && (
              <p style={{
                margin: "0 0 10px", color: C.subtext0, fontSize: "0.8rem",
                lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>
                {g.description}
              </p>
            )}

            {/* Node type breakdown */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
              {Object.entries(
                g.nodes.reduce<Record<string, number>>((a, n) => { a[n.type] = (a[n.type] ?? 0) + 1; return a; }, {})
              ).map(([type, count]) => (
                <span key={type} style={{
                  fontSize: "0.68rem", padding: "1px 7px", borderRadius: 4,
                  background: C.surface1, color: C.subtext0,
                }}>
                  {TYPE_ICONS[type] ?? "?"} {count} {type}
                </span>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/graphs/${g.id}`); }}
                style={{
                  flex: 1, padding: "7px 0", background: C.surface1, border: "none",
                  borderRadius: 6, color: C.text, cursor: "pointer",
                  fontSize: "0.8rem", fontWeight: 600,
                }}
              >
                Open Builder
              </button>
              <button
                onClick={(e) => handleDelete(g, e)}
                disabled={deleting === g.id}
                style={{
                  padding: "7px 12px", background: "transparent",
                  border: `1px solid ${C.surface2}`,
                  borderRadius: 6, color: deleting === g.id ? C.overlay0 : C.red,
                  cursor: deleting === g.id ? "default" : "pointer",
                  fontSize: "0.8rem",
                }}
              >
                {deleting === g.id ? "…" : "Delete"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
