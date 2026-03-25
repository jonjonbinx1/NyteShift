import React, { useEffect, useState, useCallback } from "react";
import type { TriggerDefinitionInfo, TriggerRunInfo, TriggerType } from "../global.js";
import { CreateTriggerModal, describeTriggerSchedule } from "../components/CreateTriggerModal.js";
import { useTheme } from "../theme/ThemeContext.js";

/* ── Helpers ──────────────────────────────────────────────────────── */

function typeIcon(type: TriggerType): string {
  switch (type) {
    case "cron": return "📅";
    case "webhook": return "🔗";
    case "discord": return "💬";
    case "channel": return "📨";
    case "manual": return "▶";
    case "oneoff": return "⏱";
    case "monthly": return "🗓";
    default: return "❓";
  }
}

function typeLabel(type: TriggerType): string {
  switch (type) {
    case "cron": return "Scheduled";
    case "webhook": return "Webhook";
    case "discord": return "Discord";
    case "channel": return "Channel";
    case "manual": return "Manual";
    case "oneoff": return "One-off";
    case "monthly": return "Monthly";
    default: return type;
  }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function statusBadge(status: "running" | "completed" | "failed", c: Record<string, string>): React.JSX.Element {
  const colors = { running: c.yellow, completed: c.green, failed: c.red };
  const labels = { running: "Running", completed: "Completed", failed: "Failed" };
  return (
    <span style={{
      display: "inline-block",
      fontSize: "0.72rem",
      fontWeight: 600,
      padding: "2px 8px",
      borderRadius: 6,
      background: `${colors[status]}20`,
      color: colors[status],
    }}>
      {labels[status]}
    </span>
  );
}

/* ── Component ────────────────────────────────────────────────────── */

export function TriggersView(): React.JSX.Element {
  const { palette: P } = useTheme();
  const c = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, muted: P.overlay0, text: P.text, subtext: P.subtext0, dim: P.surface2, red: P.red, green: P.green, yellow: P.yellow, teal: P.teal };
  const [triggers, setTriggers] = useState<TriggerDefinitionInfo[]>([]);
  const [runs, setRuns] = useState<TriggerRunInfo[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [graphs, setGraphs] = useState<Array<{ id: string; name: string }>>([]);
  const [engineRunning, setEngineRunning] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editTrigger, setEditTrigger] = useState<TriggerDefinitionInfo | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerDefinitionInfo | null>(null);
  const [firing, setFiring] = useState<string | null>(null);
  const [tab, setTab] = useState<"triggers" | "runs">("triggers");

  const load = useCallback(async () => {
    if (!window.nyteShiftApi) return;
    const [allTriggers, allAgents, status, allRuns, allGraphs] = await Promise.all([
      window.nyteShiftApi.triggersListAll(),
      window.nyteShiftApi.listAgents(),
      window.nyteShiftApi.triggersEngineStatus(),
      window.nyteShiftApi.triggersRuns(),
      (window.nyteShiftApi.graphList?.() ?? Promise.resolve([])).catch(() => []),
    ]);
    setTriggers(allTriggers);
    setAgents(allAgents);
    setEngineRunning(status.running);
    setRuns(allRuns);
    setGraphs((allGraphs as any[]).map((g) => ({ id: g.id, name: g.name ?? g.id })));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live updates from the engine.
  useEffect(() => {
    if (!window.nyteShiftApi) return;
    window.nyteShiftApi.onTriggerRunUpdate(() => {
      // Refresh runs on any update.
      window.nyteShiftApi!.triggersRuns().then(setRuns).catch(console.error);
    });
  }, []);

  const handleToggleEngine = async () => {
    if (!window.nyteShiftApi) return;
    if (engineRunning) {
      await window.nyteShiftApi.triggersEngineStop();
    } else {
      await window.nyteShiftApi.triggersEngineStart();
    }
    const status = await window.nyteShiftApi.triggersEngineStatus();
    setEngineRunning(status.running);
  };

  const handleToggleTrigger = async (trigger: TriggerDefinitionInfo) => {
    if (!window.nyteShiftApi) return;
    await window.nyteShiftApi.triggersUpdate(trigger.id, { enabled: !trigger.enabled });
    await load();
  };

  const handleDelete = async (triggerId: string) => {
    if (!confirm("Delete this trigger?")) return;
    if (!window.nyteShiftApi) return;
    await window.nyteShiftApi.triggersDelete(triggerId);
    setSelectedTrigger(null);
    await load();
  };

  const handleFire = async (triggerId: string) => {
    if (!window.nyteShiftApi) return;
    setFiring(triggerId);
    try {
      await window.nyteShiftApi.triggersFire(triggerId);
      await load();
    } catch (err) {
      console.error("Fire trigger error:", err);
    } finally {
      setFiring(null);
    }
  };

  const filtered = triggers.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q)
      || t.agentName.toLowerCase().includes(q)
      || t.type.toLowerCase().includes(q);
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", color: c.text }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h1 style={{ margin: 0, flex: 1, fontSize: "1.6rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Triggers</h1>
        <button
          onClick={handleToggleEngine}
          style={{
            padding: "7px 16px",
            borderRadius: 8,
            border: `1px solid ${engineRunning ? c.green : c.border}`,
            background: engineRunning ? `${c.green}18` : "transparent",
            color: engineRunning ? c.green : c.subtext,
            cursor: "pointer",
            fontSize: "0.82rem",
            fontWeight: 600,
          }}
        >
          {engineRunning ? "● Engine Running" : "○ Engine Stopped"}
        </button>
        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            padding: "8px 18px",
            borderRadius: 8,
            border: "none",
            background: c.accent,
            color: c.bg,
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "0.88rem",
          }}
        >
          + New Trigger
        </button>
      </div>

      <p style={{ margin: "0 0 16px", color: c.subtext, fontSize: "0.85rem" }}>
        {triggers.length} trigger{triggers.length !== 1 ? "s" : ""} configured
        {" · "}
        {triggers.filter((t) => t.enabled).length} enabled
      </p>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${c.border}` }}>
        {(["triggers", "runs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 20px",
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${tab === t ? c.accent : "transparent"}`,
              color: tab === t ? c.accent : c.subtext,
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
              fontSize: "0.9rem",
              textTransform: "capitalize",
            }}
          >
            {t === "triggers" ? "Triggers" : `Runs (${runs.length})`}
          </button>
        ))}
      </div>

      {/* ── Triggers Tab ── */}
      {tab === "triggers" && (
        <>
          {/* Search */}
          <div style={{ position: "relative", maxWidth: 480, marginBottom: 16 }}>
            <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: c.muted, pointerEvents: "none", fontSize: "0.88rem" }}>🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search triggers…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "9px 14px 9px 36px",
                borderRadius: 10,
                border: `1px solid ${c.border}`,
                background: c.surface,
                color: c.text,
                fontSize: "0.88rem",
                outline: "none",
              }}
            />
          </div>

          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "4rem 1rem", color: c.muted, background: c.surface, borderRadius: 14, border: `1px solid ${c.border}` }}>
              <p style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: 6 }}>
                {triggers.length === 0 ? "No triggers configured" : "No triggers match your search"}
              </p>
              {triggers.length === 0 && (
                <p style={{ fontSize: "0.88rem" }}>
                  Click <strong style={{ color: c.accent }}>+ New Trigger</strong> to create a scheduled, webhook, or manual trigger.
                </p>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 16 }}>
              {/* Trigger list */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                {filtered.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTrigger(t)}
                    style={{
                      background: selectedTrigger?.id === t.id ? c.cardHover : c.card,
                      borderRadius: 12,
                      border: `1px solid ${selectedTrigger?.id === t.id ? c.borderHover : c.border}`,
                      padding: "14px 18px",
                      cursor: "pointer",
                      transition: "background .12s, border-color .15s",
                    }}
                    onMouseEnter={(e) => { if (selectedTrigger?.id !== t.id) e.currentTarget.style.background = c.cardHover; }}
                    onMouseLeave={(e) => { if (selectedTrigger?.id !== t.id) e.currentTarget.style.background = c.card; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: "1.1rem" }}>{typeIcon(t.type)}</span>
                      <span style={{ fontWeight: 600, fontSize: "0.95rem", color: c.text, flex: 1 }}>{t.name}</span>
                      <span style={{
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: t.enabled ? `${c.green}20` : `${c.muted}20`,
                        color: t.enabled ? c.green : c.muted,
                      }}>
                        {t.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "0.8rem", color: c.subtext }}>
                      <span>{typeLabel(t.type)}</span>
                      <span style={{ color: c.dim }}>→</span>
                      <span style={{ color: c.accent }}>
                        {t.targetType === "graph"
                          ? (graphs.find((g) => g.id === t.targetId)?.name ?? `graph:${(t.targetId ?? "?").slice(0, 8)}`)
                          : t.agentName}
                      </span>
                      {describeTriggerSchedule(t) && (
                        <span style={{ color: c.muted }}>({describeTriggerSchedule(t)})</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Detail panel */}
              {selectedTrigger && (
                <div style={{
                  width: 360,
                  background: c.surface,
                  borderRadius: 14,
                  border: `1px solid ${c.border}`,
                  padding: 20,
                  flexShrink: 0,
                }}>
                  <h3 style={{ margin: "0 0 12px", color: c.text, fontSize: "1.1rem" }}>
                    {typeIcon(selectedTrigger.type)} {selectedTrigger.name}
                  </h3>

                  <DetailRow label="Type" value={typeLabel(selectedTrigger.type)} />
                  <DetailRow label="Status" value={selectedTrigger.enabled ? "Enabled" : "Disabled"} />

                  {/* Target — agent or graph */}
                  {selectedTrigger.targetType !== "graph" ? (
                    <DetailRow label="Agent" value={selectedTrigger.agentName} accent />
                  ) : (
                    <DetailRow label="Graph" value={graphs.find((g) => g.id === selectedTrigger.targetId)?.name ?? selectedTrigger.targetId ?? "—"} accent />
                  )}

                  {describeTriggerSchedule(selectedTrigger) && (
                    <DetailRow label="Schedule" value={describeTriggerSchedule(selectedTrigger)} />
                  )}
                  {selectedTrigger.webhookPath && <DetailRow label="Webhook" value={selectedTrigger.webhookPath} />}

                  {/* Discord rows — conditionally shown */}
                  {selectedTrigger.type === "discord" && (
                    <>
                      {/* Mode only makes sense for agent (bridge vs trigger) */}
                      {selectedTrigger.targetType !== "graph" && (
                        <DetailRow label="Discord Mode" value={selectedTrigger.discordMode === "bridge" ? "Chat Bridge" : "Trigger"} />
                      )}
                      {selectedTrigger.discordGuildId && <DetailRow label="Server ID" value={selectedTrigger.discordGuildId} />}
                      {selectedTrigger.discordChannelIds?.length ? (
                        <DetailRow label="Channels" value={selectedTrigger.discordChannelIds.join(", ")} />
                      ) : null}
                      {/* Mention only applies to agent triggers, not graph slash commands */}
                      {selectedTrigger.targetType !== "graph" && (
                        <DetailRow label="Mention Only" value={selectedTrigger.discordMentionOnly ? "Yes" : "No"} />
                      )}
                      {selectedTrigger.discordCommand && (
                        <DetailRow label="Slash Command" value={`/${selectedTrigger.discordCommand}`} />
                      )}
                      {selectedTrigger.discordCommand && selectedTrigger.discordCommandInput && selectedTrigger.discordCommandInput !== "none" && (
                        <DetailRow
                          label="Input Mode"
                          value={selectedTrigger.discordCommandInput === "text" ? "Text args → input.text" : "JSON args → input"}
                        />
                      )}
                    </>
                  )}

                  {/* Channel adapter rows — conditionally shown */}
                  {selectedTrigger.type === "channel" && (
                    <>
                      {selectedTrigger.channelName && <DetailRow label="Channel Adapter" value={selectedTrigger.channelName} accent />}
                      <DetailRow label="Mode" value={selectedTrigger.channelMode === "bridge" ? "Chat Bridge" : "Trigger"} />
                    </>
                  )}

                  {/* Max Steps only for agent triggers */}
                  {selectedTrigger.targetType !== "graph" && (
                    <DetailRow label="Max Steps" value={String(selectedTrigger.maxSteps ?? 10)} />
                  )}

                  <DetailRow label="Created" value={new Date(selectedTrigger.createdAt).toLocaleString()} />

                  {/* Task Template — agent triggers only, and only when non-empty */}
                  {selectedTrigger.targetType !== "graph" && !!selectedTrigger.taskTemplate && (
                    <div style={{ margin: "14px 0 8px" }}>
                      <span style={{ fontSize: "0.78rem", color: c.muted, fontWeight: 500 }}>Task Template</span>
                      <pre style={{
                        background: c.card,
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontSize: "0.78rem",
                        color: c.subtext,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        margin: "4px 0 0",
                        maxHeight: 120,
                        overflow: "auto",
                      }}>{selectedTrigger.taskTemplate}</pre>
                    </div>
                  )}

                  {/* Static input summary — graph triggers only */}
                  {selectedTrigger.targetType === "graph" && selectedTrigger.triggerInput && Object.keys(selectedTrigger.triggerInput).length > 0 && (
                    <div style={{ margin: "14px 0 8px" }}>
                      <span style={{ fontSize: "0.78rem", color: c.muted, fontWeight: 500 }}>Static Input</span>
                      <pre style={{
                        background: c.card,
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontSize: "0.78rem",
                        color: c.subtext,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        margin: "4px 0 0",
                        maxHeight: 120,
                        overflow: "auto",
                      }}>{JSON.stringify(selectedTrigger.triggerInput, null, 2)}</pre>
                    </div>
                  )}

                  <div style={{ margin: "10px 0 4px", fontSize: "0.72rem", color: c.dim, fontFamily: "monospace" }}>
                    ID: {selectedTrigger.id}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    <button
                      onClick={() => setEditTrigger(selectedTrigger)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: `1px solid ${c.accent}40`,
                        background: "transparent",
                        color: c.accent,
                        cursor: "pointer",
                        fontSize: "0.82rem",
                        fontWeight: 600,
                      }}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleFire(selectedTrigger.id)}
                      disabled={firing === selectedTrigger.id}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: "none",
                        background: c.teal,
                        color: c.bg,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: "0.82rem",
                        opacity: firing === selectedTrigger.id ? 0.6 : 1,
                      }}
                    >
                      {firing === selectedTrigger.id ? "Running…" : "▶ Run Now"}
                    </button>
                    <button
                      onClick={() => handleToggleTrigger(selectedTrigger)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: `1px solid ${c.border}`,
                        background: "transparent",
                        color: c.subtext,
                        cursor: "pointer",
                        fontSize: "0.82rem",
                      }}
                    >
                      {selectedTrigger.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => handleDelete(selectedTrigger.id)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: `1px solid ${c.red}40`,
                        background: "transparent",
                        color: c.red,
                        cursor: "pointer",
                        fontSize: "0.82rem",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Runs Tab ── */}
      {tab === "runs" && (
        <div>
          {runs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "4rem 1rem", color: c.muted, background: c.surface, borderRadius: 14, border: `1px solid ${c.border}` }}>
              <p style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: 6 }}>No trigger runs recorded</p>
              <p style={{ fontSize: "0.88rem" }}>
                Runs appear here when triggers fire. Start the engine and fire a trigger to see results.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {runs.map((r) => (
                <div
                  key={r.id}
                  style={{
                    background: c.card,
                    borderRadius: 12,
                    border: `1px solid ${c.border}`,
                    padding: "12px 18px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: "0.9rem", color: c.text }}>{r.triggerName}</span>
                    {statusBadge(r.status, c)}
                    <span style={{ fontSize: "0.78rem", color: c.muted, marginLeft: "auto" }}>
                      {relativeTime(r.startedAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: c.subtext, display: "flex", gap: 12, alignItems: "center" }}>
                    <span>→ {r.agentName}</span>
                    <span style={{ color: c.dim }}>({r.event.type})</span>
                    {r.completedAt && (
                      <span style={{ color: c.muted }}>{r.completedAt - r.startedAt}ms</span>
                    )}
                  </div>
                  {r.result && (
                    <pre style={{
                      background: c.surface,
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: "0.76rem",
                      color: c.subtext,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      margin: "8px 0 0",
                      maxHeight: 80,
                      overflow: "auto",
                    }}>{r.result.finalOutput.slice(0, 300)}{r.result.finalOutput.length > 300 ? "…" : ""}</pre>
                  )}
                  {r.error && (
                    <div style={{
                      background: `${c.red}10`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: "0.78rem",
                      color: c.red,
                      margin: "8px 0 0",
                    }}>{r.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit modal */}
      {(showCreateModal || editTrigger) && (
        <CreateTriggerModal
          agents={agents}
          onClose={() => { setShowCreateModal(false); setEditTrigger(null); }}
          onCreated={() => { load(); setSelectedTrigger(null); }}
          editTrigger={editTrigger ?? undefined}
        />
      )}
    </div>
  );
}

/* ── Detail row helper ────────────────────────────────────────────── */

function DetailRow({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.JSX.Element {
  const { palette: P } = useTheme();
  const c = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, muted: P.overlay0, text: P.text, subtext: P.subtext0, dim: P.surface2, red: P.red, green: P.green, yellow: P.yellow, teal: P.teal };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: "0.82rem" }}>
      <span style={{ color: c.muted }}>{label}</span>
      <span style={{ color: accent ? c.accent : c.subtext, fontWeight: accent ? 600 : 400 }}>{value}</span>
    </div>
  );
}
