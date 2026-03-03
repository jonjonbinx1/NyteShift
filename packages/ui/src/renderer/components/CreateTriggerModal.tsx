import React, { useState, useEffect, useMemo } from "react";
import type { TriggerType } from "../global.js";
import { useTheme } from "../theme/ThemeContext.js";

interface TriggerDefinitionInfo {
  id: string;
  name: string;
  type: TriggerType;
  agentName: string;
  enabled: boolean;
  schedule?: string;
  webhookPath?: string;
  webhookSecret?: string;
  taskTemplate: string;
  provider?: string;
  model?: string;
  maxSteps?: number;
  discordBotToken?: string;
  discordGuildId?: string;
  discordChannelIds?: string[];
  discordMentionOnly?: boolean;
  discordMode?: "trigger" | "bridge";
  createdAt: number;
  updatedAt: number;
}

interface Props {
  agents: string[];
  onClose: () => void;
  onCreated: () => void;
  /** Pre-select an agent when opened from an agent detail page. */
  defaultAgent?: string;
  /** When provided, the modal switches to edit mode for this trigger. */
  editTrigger?: TriggerDefinitionInfo;
}

const TRIGGER_TYPES: { value: TriggerType; label: string; description: string }[] = [
  { value: "cron", label: "Scheduled", description: "Run on a repeating time-based schedule." },
  { value: "webhook", label: "Webhook", description: "Trigger via HTTP POST (Slack, email, Zapier, etc.)." },
  { value: "discord", label: "Discord", description: "Connect a Discord bot — trigger per message or enable a persistent chat bridge." },
  { value: "manual", label: "Manual", description: "Fire manually from the UI or CLI." },
];

/* ── Schedule builder types ───────────────────────────────────────── */

type ScheduleMode = "interval" | "daily" | "weekly" | "custom";

const INTERVAL_PRESETS = [
  { label: "Every 30 seconds", value: "30s" },
  { label: "Every 1 minute", value: "1m" },
  { label: "Every 5 minutes", value: "5m" },
  { label: "Every 15 minutes", value: "15m" },
  { label: "Every 30 minutes", value: "30m" },
  { label: "Every 1 hour", value: "1h" },
  { label: "Every 2 hours", value: "2h" },
  { label: "Every 6 hours", value: "6h" },
  { label: "Every 12 hours", value: "12h" },
  { label: "Every 24 hours", value: "1d" },
];

const DAYS_OF_WEEK = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  label: i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`,
  value: i,
}));

const MINUTES = [
  { label: ":00", value: 0 },
  { label: ":15", value: 15 },
  { label: ":30", value: 30 },
  { label: ":45", value: 45 },
];

/* ── Helpers ──────────────────────────────────────────────────────── */

function buildCronFromUI(mode: ScheduleMode, interval: string, hour: number, minute: number, selectedDays: number[]): string {
  switch (mode) {
    case "interval":
      return interval;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly": {
      const days = selectedDays.length > 0 ? selectedDays.join(",") : "*";
      return `${minute} ${hour} * * ${days}`;
    }
    case "custom":
      return ""; // user provides raw value
  }
}

/**
 * Convert a raw schedule string (cron or interval shorthand) into a
 * human-readable description shown in the UI.
 */
export function describeSchedule(schedule: string | undefined): string {
  if (!schedule) return "";

  // Interval shorthand
  const intervalMatch = schedule.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i);
  if (intervalMatch) {
    const n = parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2].toLowerCase();
    const unitMap: Record<string, string> = {
      s: "second", sec: "second", m: "minute", min: "minute",
      h: "hour", hr: "hour", hour: "hour", d: "day", day: "day",
    };
    const u = unitMap[unit] ?? unit;
    return `Every ${n} ${u}${n !== 1 ? "s" : ""}`;
  }

  // Cron expression
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;

  const [min, hr, , , dow] = parts;
  const minute = parseInt(min, 10);
  const hour = parseInt(hr, 10);

  if (isNaN(minute) || isNaN(hour)) return schedule;

  const timeStr = hour === 0 ? `12:${min.padStart(2, "0")} AM`
    : hour < 12 ? `${hour}:${min.padStart(2, "0")} AM`
    : hour === 12 ? `12:${min.padStart(2, "0")} PM`
    : `${hour - 12}:${min.padStart(2, "0")} PM`;

  if (dow === "*") return `Daily at ${timeStr}`;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayList = dow.split(",").map((d) => dayNames[parseInt(d, 10)] ?? d).join(", ");
  return `${dayList} at ${timeStr}`;
}

/* ── Schedule builder component ───────────────────────────────────── */

function ScheduleBuilder({ value, onChange }: { value: string; onChange: (s: string) => void }): React.JSX.Element {
  const { palette: P } = useTheme();
  const c = { bg: P.base, surface: P.mantle, card: P.surface0, border: P.surface1, borderHover: P.mauve, accent: P.mauve, muted: P.overlay0, text: P.text, subtext: P.subtext0, red: P.red, green: P.green, yellow: P.yellow, overlay: "rgba(0,0,0,0.55)" };
  const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: "0.88rem", marginBottom: 14, outline: "none" };
  const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "auto" as any };
  const [mode, setMode] = useState<ScheduleMode>("interval");
  const [interval, setIntervalVal] = useState("5m");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon–Fri
  const [customCron, setCustomCron] = useState("");

  // Sync outbound value whenever builder state changes.
  useEffect(() => {
    if (mode === "custom") {
      onChange(customCron);
    } else {
      onChange(buildCronFromUI(mode, interval, hour, minute, selectedDays));
    }
  }, [mode, interval, hour, minute, selectedDays, customCron]);

  // Parse incoming value to set initial mode (only on mount).
  useEffect(() => {
    if (!value) return;
    const im = value.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i);
    if (im) { setMode("interval"); setIntervalVal(value); return; }
    const parts = value.trim().split(/\s+/);
    if (parts.length === 5) {
      const [mn, hr, , , dow] = parts;
      const h = parseInt(hr, 10);
      const m = parseInt(mn, 10);
      if (!isNaN(h) && !isNaN(m)) {
        setHour(h);
        setMinute(m);
        if (dow === "*") { setMode("daily"); }
        else {
          setMode("weekly");
          setSelectedDays(dow.split(",").map(Number).filter((n) => !isNaN(n)));
        }
        return;
      }
    }
    setMode("custom");
    setCustomCron(value);
  }, []); // mount only

  const preview = useMemo(() => describeSchedule(
    mode === "custom" ? customCron : buildCronFromUI(mode, interval, hour, minute, selectedDays)
  ), [mode, interval, hour, minute, selectedDays, customCron]);

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {([
          { key: "interval" as const, label: "Repeat" },
          { key: "daily" as const, label: "Daily" },
          { key: "weekly" as const, label: "Weekly" },
          { key: "custom" as const, label: "Advanced" },
        ]).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: `1.5px solid ${mode === m.key ? c.accent : c.border}`,
              background: mode === m.key ? "rgba(203,166,247,0.10)" : "transparent",
              color: mode === m.key ? c.accent : c.subtext,
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: mode === m.key ? 600 : 400,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Interval mode */}
      {mode === "interval" && (
        <select
          value={interval}
          onChange={(e) => setIntervalVal(e.target.value)}
          style={selectStyle}
        >
          {INTERVAL_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      )}

      {/* Daily mode */}
      {mode === "daily" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: c.subtext, fontSize: "0.85rem" }}>at</span>
          <select value={hour} onChange={(e) => setHour(Number(e.target.value))} style={{ ...selectStyle, width: 130, marginBottom: 0 }}>
            {HOURS.map((h) => (
              <option key={h.value} value={h.value}>{h.label}</option>
            ))}
          </select>
          <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} style={{ ...selectStyle, width: 80, marginBottom: 0 }}>
            {MINUTES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Weekly mode */}
      {mode === "weekly" && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {DAYS_OF_WEEK.map((d) => {
              const active = selectedDays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  style={{
                    width: 44,
                    height: 36,
                    borderRadius: 8,
                    border: `1.5px solid ${active ? c.accent : c.border}`,
                    background: active ? "rgba(203,166,247,0.15)" : "transparent",
                    color: active ? c.accent : c.muted,
                    cursor: "pointer",
                    fontSize: "0.78rem",
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ color: c.subtext, fontSize: "0.85rem" }}>at</span>
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))} style={{ ...selectStyle, width: 130, marginBottom: 0 }}>
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
            <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} style={{ ...selectStyle, width: 80, marginBottom: 0 }}>
              {MINUTES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Custom / advanced mode */}
      {mode === "custom" && (
        <>
          <input
            value={customCron}
            onChange={(e) => setCustomCron(e.target.value)}
            placeholder="e.g. 0 9 * * 1-5  or  5m, 1h"
            style={inputStyle}
          />
          <p style={{ color: c.muted, fontSize: "0.72rem", margin: "-8px 0 0" }}>
            5-field cron expression or interval shorthand (e.g. 5m, 1h, 30s).
          </p>
        </>
      )}

      {/* Preview */}
      {preview && (
        <div style={{
          marginTop: 10,
          padding: "6px 12px",
          borderRadius: 8,
          background: "rgba(203,166,247,0.06)",
          border: `1px solid ${c.border}`,
          fontSize: "0.8rem",
          color: c.subtext,
        }}>
          📅 {preview}
        </div>
      )}
    </div>
  );
}

/* ── Main modal ───────────────────────────────────────────────────── */

export function CreateTriggerModal({ agents, onClose, onCreated, defaultAgent, editTrigger }: Props): React.JSX.Element {
  const { palette: P } = useTheme();
  const c = { bg: P.base, surface: P.mantle, card: P.surface0, border: P.surface1, borderHover: P.mauve, accent: P.mauve, muted: P.overlay0, text: P.text, subtext: P.subtext0, red: P.red, green: P.green, yellow: P.yellow, overlay: "rgba(0,0,0,0.55)" };
  const labelStyle: React.CSSProperties = { display: "block", color: c.subtext, fontSize: "0.82rem", marginBottom: 5, fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: "0.88rem", marginBottom: 14, outline: "none" };
  const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "auto" as any };
  const cancelBtnStyle: React.CSSProperties = { padding: "8px 18px", borderRadius: 8, border: `1px solid ${c.border}`, background: "transparent", color: c.subtext, cursor: "pointer", fontSize: "0.88rem" };
  const saveBtnStyle: React.CSSProperties = { padding: "8px 22px", borderRadius: 8, border: "none", background: c.accent, color: c.bg, fontWeight: 700, cursor: "pointer", fontSize: "0.88rem" };
  const isEdit = !!editTrigger;
  const [name, setName] = useState(editTrigger?.name ?? "");
  const [agentName, setAgentName] = useState(editTrigger?.agentName ?? defaultAgent ?? agents[0] ?? "");
  const [type, setType] = useState<TriggerType>(editTrigger?.type ?? "cron");
  const [taskTemplate, setTaskTemplate] = useState(editTrigger?.taskTemplate ?? "");
  const [schedule, setSchedule] = useState(editTrigger?.schedule ?? "5m");
  const [webhookPath, setWebhookPath] = useState(editTrigger?.webhookPath ?? "");
  const [webhookSecret, setWebhookSecret] = useState(editTrigger?.webhookSecret ?? "");
  const [maxSteps, setMaxSteps] = useState(String(editTrigger?.maxSteps ?? 10));
  const [enabled, setEnabled] = useState(editTrigger?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Discord state
  const [discordBotToken, setDiscordBotToken] = useState(editTrigger?.discordBotToken ?? "");
  const [discordGuildId, setDiscordGuildId] = useState(editTrigger?.discordGuildId ?? "");
  const [discordChannelIds, setDiscordChannelIds] = useState(editTrigger?.discordChannelIds?.join(", ") ?? "");
  const [discordMentionOnly, setDiscordMentionOnly] = useState(editTrigger?.discordMentionOnly ?? false);
  const [discordMode, setDiscordMode] = useState<"trigger" | "bridge">(editTrigger?.discordMode ?? "trigger");
  const [showBotToken, setShowBotToken] = useState(false);

  // Auto-generate webhook path from name (only for new triggers).
  useEffect(() => {
    if (!isEdit && type === "webhook" && name) {
      setWebhookPath(`/hooks/${name.toLowerCase().replace(/\s+/g, "-")}`);
    }
  }, [type, name, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    if (!agentName) { setError("Select an agent"); return; }
    if (!taskTemplate.trim()) { setError("Task template is required"); return; }
    if (type === "cron" && !schedule.trim()) { setError("A schedule is required for scheduled triggers"); return; }
    if (type === "webhook" && !webhookPath.trim()) { setError("Webhook path is required"); return; }
    if (type === "discord" && !discordBotToken.trim()) { setError("A Discord bot token is required"); return; }

    setSaving(true);
    setError("");

    try {
      if (isEdit) {
        await window.solixApi!.triggersUpdate(editTrigger!.id, {
          name: name.trim(),
          agentName,
          type,
          enabled,
          taskTemplate: taskTemplate.trim(),
          schedule: type === "cron" ? schedule.trim() : undefined,
          webhookPath: type === "webhook" ? webhookPath.trim() : undefined,
          webhookSecret: type === "webhook" && webhookSecret.trim() ? webhookSecret.trim() : undefined,
          maxSteps: parseInt(maxSteps, 10) || 10,
          ...(type === "discord" ? {
            discordBotToken: discordBotToken.trim(),
            discordGuildId: discordGuildId.trim() || undefined,
            discordChannelIds: discordChannelIds.trim() ? discordChannelIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            discordMentionOnly,
            discordMode,
          } : {}),
        });
      } else {
        await window.solixApi!.triggersCreate({
          name: name.trim(),
          agentName,
          type,
          enabled,
          taskTemplate: taskTemplate.trim(),
          schedule: type === "cron" ? schedule.trim() : undefined,
          webhookPath: type === "webhook" ? webhookPath.trim() : undefined,
          webhookSecret: type === "webhook" && webhookSecret.trim() ? webhookSecret.trim() : undefined,
          maxSteps: parseInt(maxSteps, 10) || 10,
          ...(type === "discord" ? {
            discordBotToken: discordBotToken.trim(),
            discordGuildId: discordGuildId.trim() || undefined,
            discordChannelIds: discordChannelIds.trim() ? discordChannelIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            discordMentionOnly,
            discordMode,
          } : {}),
        });
      }
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: c.overlay, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: c.card, borderRadius: 16, border: `1px solid ${c.border}`, padding: 28, width: 540, maxHeight: "85vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 18px", color: c.text, fontSize: "1.3rem" }}>{isEdit ? "Edit Trigger" : "Create Trigger"}</h2>

        <form onSubmit={handleSubmit}>
          {/* Name */}
          <label style={labelStyle}>Trigger Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. daily-digest" style={inputStyle} autoFocus />

          {/* Agent */}
          <label style={labelStyle}>Agent</label>
          <select value={agentName} onChange={(e) => setAgentName(e.target.value)} style={inputStyle}>
            {agents.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          {/* Type */}
          <label style={labelStyle}>Trigger Type</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {TRIGGER_TYPES.map((tt) => (
              <button
                key={tt.value}
                type="button"
                onClick={() => setType(tt.value)}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  borderRadius: 10,
                  border: `1.5px solid ${type === tt.value ? c.accent : c.border}`,
                  background: type === tt.value ? "rgba(203,166,247,0.12)" : c.surface,
                  color: type === tt.value ? c.accent : c.subtext,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: type === tt.value ? 600 : 400,
                  textAlign: "center",
                }}
              >
                {tt.label}
              </button>
            ))}
          </div>
          <p style={{ color: c.muted, fontSize: "0.78rem", margin: "0 0 14px" }}>
            {TRIGGER_TYPES.find((t) => t.value === type)?.description}
          </p>

          {/* Schedule builder (for "cron" / Scheduled type) */}
          {type === "cron" && (
            <>
              <label style={labelStyle}>Schedule</label>
              <ScheduleBuilder value={schedule} onChange={setSchedule} />
            </>
          )}

          {/* Webhook-specific */}
          {type === "webhook" && (
            <>
              <label style={labelStyle}>Webhook Path</label>
              <input value={webhookPath} onChange={(e) => setWebhookPath(e.target.value)} placeholder="/hooks/my-agent" style={inputStyle} />
              <label style={labelStyle}>Webhook Secret <span style={{ color: c.muted, fontWeight: 400 }}>(optional)</span></label>
              <input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="HMAC-SHA256 secret" style={inputStyle} type="password" />
            </>
          )}

          {/* Discord-specific */}
          {type === "discord" && (
            <>
              {/* Mode selector */}
              <label style={labelStyle}>Discord Mode</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {([
                  { key: "trigger" as const, label: "Trigger", desc: "Each message spawns an independent agent run (no memory)." },
                  { key: "bridge" as const, label: "Chat Bridge", desc: "Persistent conversation — the agent remembers the full chat." },
                ] as const).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setDiscordMode(m.key)}
                    style={{
                      flex: 1,
                      padding: "10px 10px",
                      borderRadius: 10,
                      border: `1.5px solid ${discordMode === m.key ? c.accent : c.border}`,
                      background: discordMode === m.key ? "rgba(203,166,247,0.12)" : c.surface,
                      color: discordMode === m.key ? c.accent : c.subtext,
                      cursor: "pointer",
                      fontSize: "0.83rem",
                      fontWeight: discordMode === m.key ? 600 : 400,
                      textAlign: "center",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p style={{ color: c.muted, fontSize: "0.78rem", margin: "-6px 0 14px" }}>
                {discordMode === "trigger"
                  ? "Each matching Discord message spawns an independent agent run using the task template."
                  : "The Discord channel acts as a live chat proxy with full conversation history."}
              </p>

              {/* Bot Token */}
              <label style={labelStyle}>Bot Token</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                <input
                  value={discordBotToken}
                  onChange={(e) => setDiscordBotToken(e.target.value)}
                  placeholder="Paste your Discord bot token"
                  type={showBotToken ? "text" : "password"}
                  style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                />
                <button
                  type="button"
                  onClick={() => setShowBotToken(!showBotToken)}
                  style={{ ...cancelBtnStyle, padding: "6px 12px", fontSize: "0.78rem", whiteSpace: "nowrap" }}
                >
                  {showBotToken ? "Hide" : "Show"}
                </button>
              </div>
              <p style={{ color: c.muted, fontSize: "0.72rem", margin: "-8px 0 14px" }}>
                Create a bot at{" "}
                <span style={{ color: c.accent, cursor: "pointer" }} onClick={() => (window as any).open?.("https://discord.com/developers/applications")}>
                  discord.com/developers
                </span>
                . Enable Message Content Intent under Privileged Gateway Intents.
              </p>

              {/* Guild ID */}
              <label style={labelStyle}>Guild (Server) ID <span style={{ color: c.muted, fontWeight: 400 }}>(optional)</span></label>
              <input
                value={discordGuildId}
                onChange={(e) => setDiscordGuildId(e.target.value)}
                placeholder="e.g. 1234567890"
                style={inputStyle}
              />

              {/* Channel IDs */}
              <label style={labelStyle}>Channel IDs <span style={{ color: c.muted, fontWeight: 400 }}>(optional, comma-separated)</span></label>
              <input
                value={discordChannelIds}
                onChange={(e) => setDiscordChannelIds(e.target.value)}
                placeholder="e.g. 111222333, 444555666 — blank = all visible channels"
                style={inputStyle}
              />

              {/* Mention-only toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <input
                  type="checkbox"
                  checked={discordMentionOnly}
                  onChange={(e) => setDiscordMentionOnly(e.target.checked)}
                  id="discord-mention-only"
                />
                <label htmlFor="discord-mention-only" style={{ color: c.subtext, fontSize: "0.85rem" }}>
                  Only respond when @mentioned
                </label>
              </div>
            </>
          )}

          {/* Task Template */}
          <label style={labelStyle}>Task Template</label>
          <textarea
            value={taskTemplate}
            onChange={(e) => setTaskTemplate(e.target.value)}
            placeholder={"A new message was received: {{payload.content}}\n\nRespond helpfully and concisely."}
            rows={4}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: "0.83rem" }}
          />
          <p style={{ color: c.muted, fontSize: "0.75rem", margin: "-8px 0 14px" }}>
            {"Supports {{payload}}, {{payload.field}}, {{type}}, {{timestamp}} interpolation."}
          </p>

          {/* Max Steps */}
          <label style={labelStyle}>Max Steps</label>
          <input value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} type="number" min={1} max={50} style={{ ...inputStyle, width: 100 }} />

          {/* Enabled */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} id="trigger-enabled" />
            <label htmlFor="trigger-enabled" style={{ color: c.subtext, fontSize: "0.88rem" }}>Enable trigger on creation</label>
          </div>

          {/* Error */}
          {error && (
            <div style={{ color: c.red, fontSize: "0.85rem", marginBottom: 12, padding: "8px 12px", background: "rgba(243,139,168,0.1)", borderRadius: 8 }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={saving} style={saveBtnStyle}>
              {saving ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save Changes" : "Create Trigger")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
