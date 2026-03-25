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
  discordCommand?: string;
  discordCommandInput?: "none" | "text" | "json";
  channelName?: string;
  channelMode?: "trigger" | "bridge";
  createdAt: number;
  updatedAt: number;
  targetType?: string;
  targetId?: string;
  triggerInput?: Record<string, unknown>;
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
  { value: "cron", label: "Scheduled", description: "Run on a repeating schedule — repeat, daily, weekly, monthly, or a one-off date." },
  { value: "webhook", label: "Webhook", description: "Trigger via HTTP POST (Slack, email, Zapier, etc.)." },
  { value: "discord", label: "Discord", description: "Connect a Discord bot — trigger per message or enable a persistent chat bridge." },
  { value: "channel", label: "Channel", description: "Use a marketplace channel adapter (Slack, Facebook Messenger, WhatsApp, etc.)." },
  { value: "manual", label: "Manual", description: "Fire manually from the UI or CLI." },
];

/* ── Schedule builder types ───────────────────────────────────────── */

type ScheduleMode = "interval" | "daily" | "weekly" | "monthly" | "oneoff" | "custom";

/** Structured output from ScheduleBuilder, keyed by the engine trigger sub-type. */
export interface ScheduleBuilderOutput {
  /** Which engine type to create this trigger as. */
  subType: "cron" | "monthly" | "oneoff";
  /** Set when subType is "cron" — cron expression or interval shorthand. */
  schedule?: string;
  /** Set when subType is "oneoff" — Unix ms timestamp. */
  runAt?: number;
  /** Set when subType is "monthly". */
  monthlyType?: "day" | "ordinal";
  monthlyDay?: number;
  monthlyOrdinal?: string;
  monthlyWeekday?: number;
  monthlyHour?: number;
  monthlyMinute?: number;
}

function initScheduleOutput(
  editTrigger?: {
    type: string; schedule?: string; runAt?: number;
    monthlyType?: "day" | "ordinal"; monthlyDay?: number; monthlyOrdinal?: string;
    monthlyWeekday?: number; monthlyHour?: number; monthlyMinute?: number;
  },
): ScheduleBuilderOutput {
  if (!editTrigger) return { subType: "cron", schedule: "5m" };
  if (editTrigger.type === "oneoff") return { subType: "oneoff", runAt: editTrigger.runAt };
  if (editTrigger.type === "monthly") return {
    subType: "monthly",
    monthlyType: editTrigger.monthlyType ?? "day",
    monthlyDay: editTrigger.monthlyDay ?? 1,
    monthlyOrdinal: editTrigger.monthlyOrdinal ?? "first",
    monthlyWeekday: editTrigger.monthlyWeekday ?? 1,
    monthlyHour: editTrigger.monthlyHour ?? 9,
    monthlyMinute: editTrigger.monthlyMinute ?? 0,
  };
  return { subType: "cron", schedule: editTrigger.schedule ?? "5m" };
}

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

type CronScheduleMode = "interval" | "daily" | "weekly" | "custom";

function buildCronFromUI(mode: CronScheduleMode, interval: string, hour: number, minute: number, selectedDays: number[]): string {
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

/** Describe a monthly trigger's pattern in human-readable form. */
export function describeMonthlySchedule(
  monthlyType: "day" | "ordinal" | undefined,
  monthlyDay: number | undefined,
  monthlyOrdinal: string | undefined,
  monthlyWeekday: number | undefined,
  monthlyHour: number | undefined,
  monthlyMinute: number | undefined,
): string {
  const h = monthlyHour ?? 9;
  const m = monthlyMinute ?? 0;
  const timeStr = h === 0 ? `12:${String(m).padStart(2, "0")} AM`
    : h < 12 ? `${h}:${String(m).padStart(2, "0")} AM`
    : h === 12 ? `12:${String(m).padStart(2, "0")} PM`
    : `${h - 12}:${String(m).padStart(2, "0")} PM`;

  if (monthlyType === "day") {
    const d = monthlyDay ?? 1;
    const suffix = d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th";
    return `Monthly on the ${d}${suffix} at ${timeStr}`;
  }
  if (monthlyType === "ordinal") {
    const ord = monthlyOrdinal ?? "first";
    const ordLabel = ord.charAt(0).toUpperCase() + ord.slice(1);
    const wdLabels: Record<number, string> = {
      0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
      4: "Thursday", 5: "Friday", 6: "Saturday",
      [-1]: "Day", [-2]: "Weekday", [-3]: "Weekend day",
    };
    const wdLabel = wdLabels[monthlyWeekday ?? 1] ?? "Monday";
    return `Monthly on the ${ordLabel} ${wdLabel} at ${timeStr}`;
  }
  return "";
}

/** Single source of truth for displaying any trigger's schedule in the UI. */
export function describeTriggerSchedule(trigger: {
  type: string;
  schedule?: string;
  runAt?: number;
  monthlyType?: "day" | "ordinal";
  monthlyDay?: number;
  monthlyOrdinal?: string;
  monthlyWeekday?: number;
  monthlyHour?: number;
  monthlyMinute?: number;
}): string {
  if (trigger.type === "oneoff") {
    if (!trigger.runAt) return "";
    return `Once at ${new Date(trigger.runAt).toLocaleString()}`;
  }
  if (trigger.type === "monthly") {
    return describeMonthlySchedule(
      trigger.monthlyType as "day" | "ordinal" | undefined,
      trigger.monthlyDay,
      trigger.monthlyOrdinal,
      trigger.monthlyWeekday,
      trigger.monthlyHour,
      trigger.monthlyMinute,
    );
  }
  return describeSchedule(trigger.schedule);
}

/* ── Monthly builder sub-component ───────────────────────────────── */

const ORDINALS = [
  { label: "First",  value: "first" },
  { label: "Second", value: "second" },
  { label: "Third",  value: "third" },
  { label: "Fourth", value: "fourth" },
  { label: "Last",   value: "last" },
];

const WEEKDAY_OPTIONS = [
  { label: "Day",         value: -1 },
  { label: "Weekday",     value: -2 },
  { label: "Weekend day", value: -3 },
  { label: "Monday",      value: 1 },
  { label: "Tuesday",     value: 2 },
  { label: "Wednesday",   value: 3 },
  { label: "Thursday",    value: 4 },
  { label: "Friday",      value: 5 },
  { label: "Saturday",    value: 6 },
  { label: "Sunday",      value: 0 },
];

interface MonthlyBuilderProps {
  monthlyType: "day" | "ordinal";
  monthlyDay: number;
  monthlyOrdinal: string;
  monthlyWeekday: number;
  monthlyHour: number;
  monthlyMinute: number;
  onChange: (updates: Partial<{ monthlyType: "day" | "ordinal"; monthlyDay: number; monthlyOrdinal: string; monthlyWeekday: number; monthlyHour: number; monthlyMinute: number }>) => void;
}

function MonthlyBuilder({ monthlyType, monthlyDay, monthlyOrdinal, monthlyWeekday, monthlyHour, monthlyMinute, onChange }: MonthlyBuilderProps): React.JSX.Element {
  const { palette: P } = useTheme();
  const c = { surface: P.mantle, border: P.surface1, accent: P.mauve, muted: P.overlay0, text: P.text, subtext: P.subtext0 };
  const inputStyle: React.CSSProperties = { boxSizing: "border-box" as const, padding: "9px 12px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: "0.88rem", outline: "none" };
  const selStyle: React.CSSProperties = { ...inputStyle, appearance: "auto" as any };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {([{ key: "day" as const, label: "On day" }, { key: "ordinal" as const, label: "On the" }]).map((m) => (
          <button key={m.key} type="button" onClick={() => onChange({ monthlyType: m.key })} style={{
            padding: "6px 14px", borderRadius: 8,
            border: `1.5px solid ${monthlyType === m.key ? c.accent : c.border}`,
            background: monthlyType === m.key ? "rgba(203,166,247,0.10)" : "transparent",
            color: monthlyType === m.key ? c.accent : c.subtext,
            cursor: "pointer", fontSize: "0.8rem", fontWeight: monthlyType === m.key ? 600 : 400,
          }}>{m.label}</button>
        ))}
      </div>
      {monthlyType === "day" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <span style={{ color: c.subtext, fontSize: "0.85rem" }}>Day</span>
          <input type="number" min={1} max={31} value={monthlyDay}
            onChange={(e) => onChange({ monthlyDay: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
            style={{ ...inputStyle, width: 80 }}
          />
          <span style={{ color: c.subtext, fontSize: "0.85rem" }}>of each month</span>
        </div>
      )}
      {monthlyType === "ordinal" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <select value={monthlyOrdinal} onChange={(e) => onChange({ monthlyOrdinal: e.target.value })} style={{ ...selStyle, width: 120 }}>
            {ORDINALS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={monthlyWeekday} onChange={(e) => onChange({ monthlyWeekday: parseInt(e.target.value, 10) })} style={{ ...selStyle, width: 150 }}>
            {WEEKDAY_OPTIONS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ color: c.subtext, fontSize: "0.85rem" }}>at</span>
        <select value={monthlyHour} onChange={(e) => onChange({ monthlyHour: Number(e.target.value) })} style={{ ...selStyle, width: 130 }}>
          {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
        </select>
        <select value={monthlyMinute} onChange={(e) => onChange({ monthlyMinute: Number(e.target.value) })} style={{ ...selStyle, width: 80 }}>
          {MINUTES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ── Schedule builder component ───────────────────────────────────── */

function ScheduleBuilder({ value, onChange }: { value: ScheduleBuilderOutput; onChange: (v: ScheduleBuilderOutput) => void }): React.JSX.Element {
  const { palette: P } = useTheme();
  const c = { surface: P.mantle, border: P.surface1, accent: P.mauve, muted: P.overlay0, text: P.text, subtext: P.subtext0 };
  const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: "0.88rem", marginBottom: 14, outline: "none" };
  const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "auto" as any };
  const [mode, setMode] = useState<ScheduleMode>("interval");
  const [interval, setIntervalVal] = useState("5m");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [customCron, setCustomCron] = useState("");
  const toLocalISO = (ts?: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [runAtLocal, setRunAtLocal] = useState("");
  const [mType,    setMType]    = useState<"day" | "ordinal">("day");
  const [mDay,     setMDay]     = useState(1);
  const [mOrdinal, setMOrdinal] = useState("first");
  const [mWeekday, setMWeekday] = useState(1);
  const [mHour,    setMHour]    = useState(9);
  const [mMinute,  setMMinute]  = useState(0);

  // Parse incoming value to set initial mode (mount only).
  useEffect(() => {
    const v = value;
    if (v.subType === "oneoff") {
      setMode("oneoff"); if (v.runAt) setRunAtLocal(toLocalISO(v.runAt)); return;
    }
    if (v.subType === "monthly") {
      setMode("monthly");
      if (v.monthlyType)    setMType(v.monthlyType);
      if (v.monthlyDay)     setMDay(v.monthlyDay);
      if (v.monthlyOrdinal) setMOrdinal(v.monthlyOrdinal);
      if (v.monthlyWeekday !== undefined) setMWeekday(v.monthlyWeekday);
      if (v.monthlyHour    !== undefined) setMHour(v.monthlyHour);
      if (v.monthlyMinute  !== undefined) setMMinute(v.monthlyMinute);
      return;
    }
    const s = v.schedule ?? "";
    const im = s.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i);
    if (im) { setMode("interval"); setIntervalVal(s); return; }
    const parts = s.trim().split(/\s+/);
    if (parts.length === 5) {
      const [mn, hr, , , dow] = parts;
      const h = parseInt(hr, 10); const m = parseInt(mn, 10);
      if (!isNaN(h) && !isNaN(m)) {
        setHour(h); setMinute(m);
        if (dow === "*") { setMode("daily"); } else { setMode("weekly"); setSelectedDays(dow.split(",").map(Number).filter((n) => !isNaN(n))); }
        return;
      }
    }
    setMode("custom"); setCustomCron(s);
  }, []); // mount only

  // Sync outbound value whenever builder state changes.
  useEffect(() => {
    if (mode === "oneoff") {
      onChange({ subType: "oneoff", runAt: runAtLocal ? new Date(runAtLocal).getTime() : undefined });
    } else if (mode === "monthly") {
      onChange({ subType: "monthly", monthlyType: mType, monthlyDay: mDay, monthlyOrdinal: mOrdinal, monthlyWeekday: mWeekday, monthlyHour: mHour, monthlyMinute: mMinute });
    } else {
      const schedule = buildCronFromUI(mode as CronScheduleMode, interval, hour, minute, selectedDays);
      onChange({ subType: "cron", schedule });
    }
  }, [mode, interval, hour, minute, selectedDays, customCron, runAtLocal, mType, mDay, mOrdinal, mWeekday, mHour, mMinute]);

  const preview = useMemo(() => {
    if (mode === "oneoff") return runAtLocal ? `Once at ${new Date(runAtLocal).toLocaleString()}` : "";
    if (mode === "monthly") return describeMonthlySchedule(mType, mDay, mOrdinal, mWeekday, mHour, mMinute);
    const s = buildCronFromUI(mode as CronScheduleMode, interval, hour, minute, selectedDays);
    return describeSchedule(s);
  }, [mode, interval, hour, minute, selectedDays, customCron, runAtLocal, mType, mDay, mOrdinal, mWeekday, mHour, mMinute]);

  const toggleDay = (day: number) =>
    setSelectedDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort());

  const tabBtn = (key: ScheduleMode, label: string) => (
    <button key={key} type="button" onClick={() => setMode(key)} style={{
      padding: "6px 12px", borderRadius: 8,
      border: `1.5px solid ${mode === key ? c.accent : c.border}`,
      background: mode === key ? "rgba(203,166,247,0.10)" : "transparent",
      color: mode === key ? c.accent : c.subtext,
      cursor: "pointer", fontSize: "0.78rem", fontWeight: mode === key ? 600 : 400,
    }}>{label}</button>
  );

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 5, marginBottom: 12, flexWrap: "wrap" }}>
        {tabBtn("interval", "Repeat")}
        {tabBtn("daily",    "Daily")}
        {tabBtn("weekly",   "Weekly")}
        {tabBtn("monthly",  "Monthly")}
        {tabBtn("oneoff",   "One-off")}
        {tabBtn("custom",   "Advanced")}
      </div>

      {mode === "interval" && (
        <select value={interval} onChange={(e) => setIntervalVal(e.target.value)} style={selectStyle}>
          {INTERVAL_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      )}
      {mode === "daily" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: c.subtext, fontSize: "0.85rem" }}>at</span>
          <select value={hour} onChange={(e) => setHour(Number(e.target.value))} style={{ ...selectStyle, width: 130, marginBottom: 0 }}>
            {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
          <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} style={{ ...selectStyle, width: 80, marginBottom: 0 }}>
            {MINUTES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      )}
      {mode === "weekly" && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {DAYS_OF_WEEK.map((d) => {
              const active = selectedDays.includes(d.value);
              return (
                <button key={d.value} type="button" onClick={() => toggleDay(d.value)} style={{
                  width: 44, height: 36, borderRadius: 8,
                  border: `1.5px solid ${active ? c.accent : c.border}`,
                  background: active ? "rgba(203,166,247,0.15)" : "transparent",
                  color: active ? c.accent : c.muted,
                  cursor: "pointer", fontSize: "0.78rem", fontWeight: active ? 700 : 400,
                }}>{d.label}</button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ color: c.subtext, fontSize: "0.85rem" }}>at</span>
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))} style={{ ...selectStyle, width: 130, marginBottom: 0 }}>
              {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
            <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} style={{ ...selectStyle, width: 80, marginBottom: 0 }}>
              {MINUTES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </>
      )}
      {mode === "monthly" && (
        <MonthlyBuilder
          monthlyType={mType} monthlyDay={mDay} monthlyOrdinal={mOrdinal}
          monthlyWeekday={mWeekday} monthlyHour={mHour} monthlyMinute={mMinute}
          onChange={(u) => {
            if (u.monthlyType    !== undefined) setMType(u.monthlyType);
            if (u.monthlyDay     !== undefined) setMDay(u.monthlyDay);
            if (u.monthlyOrdinal !== undefined) setMOrdinal(u.monthlyOrdinal);
            if (u.monthlyWeekday !== undefined) setMWeekday(u.monthlyWeekday);
            if (u.monthlyHour    !== undefined) setMHour(u.monthlyHour);
            if (u.monthlyMinute  !== undefined) setMMinute(u.monthlyMinute);
          }}
        />
      )}
      {mode === "oneoff" && (
        <>
          <input type="datetime-local" value={runAtLocal} onChange={(e) => setRunAtLocal(e.target.value)} style={inputStyle} />
          <p style={{ color: c.muted, fontSize: "0.72rem", margin: "-8px 0 0" }}>
            Fires once at this exact time and disables itself automatically.
          </p>
        </>
      )}
      {mode === "custom" && (
        <>
          <input value={customCron} onChange={(e) => setCustomCron(e.target.value)} placeholder="e.g. 0 9 * * 1-5  or  5m, 1h" style={inputStyle} />
          <p style={{ color: c.muted, fontSize: "0.72rem", margin: "-8px 0 0" }}>5-field cron expression or interval shorthand.</p>
        </>
      )}
      {preview && (
        <div style={{ marginTop: 10, padding: "6px 12px", borderRadius: 8, background: "rgba(203,166,247,0.06)", border: `1px solid ${c.border}`, fontSize: "0.8rem", color: c.subtext }}>
          📅 {preview}
        </div>
      )}
    </div>
  );
}

/* ── Reusable searchable list ─────────────────────────────────────── */

interface SearchableListProps {
  /** Either plain strings or { value, label } objects. */
  items: string[] | Array<{ value: string; label: string }>;
  selectedValue: string;
  onSelect(value: string): void;
  placeholder: string;
  emptyLabel?: string;
  maxHeight?: number;
  c: Record<string, string>;
  inputStyle: React.CSSProperties;
}

function SearchableList({ items, selectedValue, onSelect, placeholder, emptyLabel = "No results", maxHeight = 200, c, inputStyle }: SearchableListProps): React.JSX.Element {
  const [search, setSearch] = useState("");
  const normalized = useMemo(() =>
    (typeof items[0] === "string" || items.length === 0)
      ? (items as string[]).map((s) => ({ value: s, label: s }))
      : items as Array<{ value: string; label: string }>,
    [items],
  );
  const filtered = useMemo(() =>
    normalized.filter((it) => it.label.toLowerCase().includes(search.toLowerCase())),
    [normalized, search],
  );
  return (
    <div style={{ marginBottom: 14 }}>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
      <div style={{ border: `1px solid ${c.border}`, borderRadius: 8, background: c.surface, maxHeight, overflowY: "auto", marginTop: -6 }}>
        {filtered.map((it) => (
          <div
            key={it.value}
            onClick={() => { onSelect(it.value); setSearch(""); }}
            style={{
              padding: "7px 12px",
              cursor: "pointer",
              background: it.value === selectedValue ? "rgba(203,166,247,0.10)" : "transparent",
              color: it.value === selectedValue ? c.accent : c.text,
              fontWeight: it.value === selectedValue ? 600 : 400,
              fontSize: "0.86rem",
            }}
          >
            {it.label}
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: "10px 12px", color: c.muted, fontSize: "0.83rem" }}>{emptyLabel}</div>
        )}
      </div>
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
  const [targetType, setTargetType] = useState<string>(editTrigger?.targetType ?? "agent");
  const [graphs, setGraphs] = useState<Array<{ id: string; name?: string }>>([]);
  const [selectedGraphId, setSelectedGraphId] = useState<string | undefined>(editTrigger?.targetId);
  const [selectedGraph, setSelectedGraph] = useState<any | null>(null);
  const [triggerInput, setTriggerInput] = useState<any>(editTrigger?.triggerInput ?? {});
  // Map monthly/oneoff to "cron" in the type picker so they show as "Scheduled".
  const [type, setType] = useState<TriggerType>(
    editTrigger ? (["monthly", "oneoff"].includes(editTrigger.type) ? "cron" : editTrigger.type as TriggerType) : "cron"
  );
  const [taskTemplate, setTaskTemplate] = useState(editTrigger?.taskTemplate ?? "");
  // Unified schedule state fed into / out of ScheduleBuilder.
  const [scheduleOutput, setScheduleOutput] = useState<ScheduleBuilderOutput>(initScheduleOutput(editTrigger));
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
  const [discordCommand, setDiscordCommand] = useState(editTrigger?.discordCommand ?? "");
  const [discordCommandInput, setDiscordCommandInput] = useState<"none" | "text" | "json">(editTrigger?.discordCommandInput ?? "text");
  const [discordSilentStart, setDiscordSilentStart] = useState<boolean>((editTrigger as any)?.discordSilentStart ?? false);
  const [showBotToken, setShowBotToken] = useState(false);

  // Channel adapter state
  const [channelName, setChannelName] = useState(editTrigger?.channelName ?? "");
  const [channelMode, setChannelMode] = useState<"trigger" | "bridge">(editTrigger?.channelMode ?? "trigger");
  const [installedChannels, setInstalledChannels] = useState<Array<{ name: string; contributor: string; description: string }>>([]);

  // Fetch installed channels when type is "channel"
  useEffect(() => {
    if (type === "channel") {
      (window as any).nyteshift?.listChannels?.().then((chs: any[]) => {
        setInstalledChannels(chs ?? []);
      }).catch(() => setInstalledChannels([]));
    }
  }, [type]);

  const [rawInputJson, setRawInputJson] = useState<string>(() => {
    if (editTrigger?.triggerInput && Object.keys(editTrigger.triggerInput).length > 0) {
      try { return JSON.stringify(editTrigger.triggerInput, null, 2); } catch { return "{}"; }
    }
    return "{}";
  });
  const [showRawJson, setShowRawJson] = useState(false);

  // Auto-generate webhook path from name (only for new triggers).
  useEffect(() => {
    if (!isEdit && type === "webhook" && name) {
      setWebhookPath(`/hooks/${name.toLowerCase().replace(/\s+/g, "-")}`);
    }
  }, [type, name, isEdit]);

  // Fetch available graphs for graph-target triggers.
  useEffect(() => {
    window.nyteShiftApi?.graphList?.().then((gs: any[]) => {
      const mapped = (gs || []).map((g) => ({ id: g.id, name: g.name }));
      setGraphs(mapped);
      if (!selectedGraphId && mapped.length > 0) setSelectedGraphId(mapped[0].id);
    }).catch(() => {});
  }, []);

  // Load selected graph definition so we can show its declared inputs
  useEffect(() => {
    let mounted = true;
    if (!selectedGraphId) { setSelectedGraph(null); return; }
    (async () => {
      try {
        const g = await window.nyteShiftApi?.graphLoad?.(selectedGraphId as string);
        if (!mounted) return;
        setSelectedGraph(g ?? null);
      } catch {
        if (mounted) setSelectedGraph(null);
      }
    })();
    return () => { mounted = false; };
  }, [selectedGraphId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    if (targetType === "agent" && !agentName) { setError("Select an agent"); return; }
    if (targetType === "agent" && !taskTemplate.trim()) { setError("Task template is required for agent targets"); return; }
    if (type === "webhook" && !webhookPath.trim()) { setError("Webhook path is required"); return; }
    if (type === "discord" && targetType === "agent" && !discordBotToken.trim() && !discordCommand.trim()) {
      setError("A Discord bot token or a slash-command name is required"); return;
    }
    if (type === "discord" && targetType === "graph" && !discordCommand.trim()) {
      setError("A slash-command name is required for graph triggers via Discord"); return;
    }
    if (type === "discord" && discordCommand.trim()) {
      const reserved = ["help", "newchat", "cancel"];
      const cmd = discordCommand.trim().toLowerCase().replace(/^\/+/, "");
      if (reserved.includes(cmd)) { setError(`"/${cmd}" is a reserved command and cannot be used`); return; }
      if (!/^[a-z0-9_-]+$/.test(cmd)) { setError("Command name must use lowercase letters, numbers, _ or - only"); return; }
    }
    if (type === "cron") {
      if (scheduleOutput.subType === "cron" && !scheduleOutput.schedule?.trim()) {
        setError("A schedule is required"); return;
      }
      if (scheduleOutput.subType === "oneoff") {
        if (!scheduleOutput.runAt) { setError("Please choose a date and time"); return; }
        if (scheduleOutput.runAt < Date.now()) { setError("One-off trigger date must be in the future"); return; }
      }
    }
    if (targetType === "graph" && !selectedGraphId) { setError("Select a graph to trigger"); return; }

    // Determine the actual engine type to submit.
    const actualType: TriggerType = type === "cron" ? scheduleOutput.subType : type;

    setSaving(true);
    setError("");

    const scheduledFields = type === "cron" ? {
      schedule: scheduleOutput.subType === "cron" ? scheduleOutput.schedule : undefined,
      runAt:    scheduleOutput.subType === "oneoff" ? scheduleOutput.runAt : undefined,
      monthlyType:    scheduleOutput.subType === "monthly" ? scheduleOutput.monthlyType    : undefined,
      monthlyDay:     scheduleOutput.subType === "monthly" ? scheduleOutput.monthlyDay     : undefined,
      monthlyOrdinal: scheduleOutput.subType === "monthly" ? scheduleOutput.monthlyOrdinal as "first" | "second" | "third" | "fourth" | "last" | undefined : undefined,
      monthlyWeekday: scheduleOutput.subType === "monthly" ? scheduleOutput.monthlyWeekday : undefined,
      monthlyHour:    scheduleOutput.subType === "monthly" ? scheduleOutput.monthlyHour    : undefined,
      monthlyMinute:  scheduleOutput.subType === "monthly" ? scheduleOutput.monthlyMinute  : undefined,
    } : {};

    try {
      if (isEdit) {
        await window.nyteShiftApi!.triggersUpdate(editTrigger!.id, {
          name: name.trim(), agentName: targetType === "agent" ? agentName : (agentName || agents[0] || "default"), type: actualType, enabled,
          taskTemplate: targetType === "agent" ? taskTemplate.trim() : "",
          ...scheduledFields,
          targetType,
          targetId: targetType === "graph" ? selectedGraphId : undefined,
          triggerInput: targetType === "graph" ? triggerInput : undefined,
          webhookPath: type === "webhook" ? webhookPath.trim() : undefined,
          webhookSecret: type === "webhook" && webhookSecret.trim() ? webhookSecret.trim() : undefined,
          ...(targetType === "agent" ? { maxSteps: parseInt(maxSteps, 10) || 10 } : {}),
          ...(type === "discord" ? {
            ...(targetType === "agent" ? {
              discordBotToken: discordBotToken.trim() || undefined,
              discordGuildId: discordGuildId.trim() || undefined,
              discordChannelIds: discordChannelIds.trim() ? discordChannelIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
              discordMentionOnly, discordMode,
            } : {}),
            discordCommand: discordCommand.trim().replace(/^\/+/, "") || undefined,
            discordCommandInput: discordCommand.trim() ? discordCommandInput : undefined,
            discordSilentStart: discordSilentStart,
            ...(targetType === "graph" ? {
              discordGuildId: discordGuildId.trim() || undefined,
              discordChannelIds: discordChannelIds.trim() ? discordChannelIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            } : {}),
          } : {}),
          ...(type === "channel" ? {
            channelName: channelName.trim() || undefined,
            channelMode,
          } : {}),
        });
      } else {
        await window.nyteShiftApi!.triggersCreate({
          name: name.trim(), agentName: targetType === "agent" ? agentName : (agentName || agents[0] || "default"), type: actualType, enabled,
          taskTemplate: targetType === "agent" ? taskTemplate.trim() : "",
          ...scheduledFields,
          targetType,
          targetId: targetType === "graph" ? selectedGraphId : undefined,
          triggerInput: targetType === "graph" ? triggerInput : undefined,
          webhookPath: type === "webhook" ? webhookPath.trim() : undefined,
          webhookSecret: type === "webhook" && webhookSecret.trim() ? webhookSecret.trim() : undefined,
          ...(targetType === "agent" ? { maxSteps: parseInt(maxSteps, 10) || 10 } : {}),
          ...(type === "discord" ? {
            ...(targetType === "agent" ? {
              discordBotToken: discordBotToken.trim() || undefined,
              discordGuildId: discordGuildId.trim() || undefined,
              discordChannelIds: discordChannelIds.trim() ? discordChannelIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
              discordMentionOnly, discordMode,
            } : {}),
            discordCommand: discordCommand.trim().replace(/^\/+/, "") || undefined,
            discordCommandInput: discordCommand.trim() ? discordCommandInput : undefined,
            discordSilentStart: discordSilentStart,
            ...(targetType === "graph" ? {
              discordGuildId: discordGuildId.trim() || undefined,
              discordChannelIds: discordChannelIds.trim() ? discordChannelIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            } : {}),
          } : {}),
          ...(type === "channel" ? {
            channelName: channelName.trim() || undefined,
            channelMode,
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
        style={{ background: c.card, borderRadius: 16, border: `1px solid ${c.border}`, padding: 28, width: 600, maxHeight: "85vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 18px", color: c.text, fontSize: "1.3rem" }}>{isEdit ? "Edit Trigger" : "Create Trigger"}</h2>

        <form onSubmit={handleSubmit}>
          {/* Name */}
          <label style={labelStyle}>Trigger Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. daily-digest" style={inputStyle} autoFocus />

          {/* Target selector: agent vs graph — shown first to conditionally reveal the right fields */}
          <label style={labelStyle}>Target</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => setTargetType("agent")}
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1.5px solid ${targetType === "agent" ? c.accent : c.border}`,
                background: targetType === "agent" ? "rgba(203,166,247,0.12)" : c.surface,
                color: targetType === "agent" ? c.accent : c.subtext,
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: targetType === "agent" ? 600 : 400,
              }}
            >
              Agent
            </button>
            <button
              type="button"
              onClick={() => setTargetType("graph")}
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1.5px solid ${targetType === "graph" ? c.accent : c.border}`,
                background: targetType === "graph" ? "rgba(203,166,247,0.12)" : c.surface,
                color: targetType === "graph" ? c.accent : c.subtext,
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: targetType === "graph" ? 600 : 400,
              }}
            >
              Graph
            </button>
          </div>

          {/* Agent (searchable) — only for agent targets */}
          {targetType === "agent" && (
            <>
              <label style={labelStyle}>Agent</label>
              <SearchableList
                items={agents}
                selectedValue={agentName}
                onSelect={(a) => { setAgentName(a); }}
                placeholder={agentName ? `Selected: ${agentName} — type to search` : "Search agents..."}
                emptyLabel="No agents found"
                maxHeight={160}
                c={c}
                inputStyle={inputStyle}
              />
            </>
          )}

          {targetType === "graph" && (
            <>
              <label style={labelStyle}>Graph</label>
              <SearchableList
                items={graphs.map((g) => ({ value: g.id, label: g.name ?? g.id }))}
                selectedValue={selectedGraphId ?? ""}
                onSelect={(id) => setSelectedGraphId(id)}
                placeholder={selectedGraph ? `Selected: ${selectedGraph.name ?? selectedGraphId} — type to search` : "Search graphs..."}
                emptyLabel="No graphs found"
                maxHeight={200}
                c={c}
                inputStyle={inputStyle}
              />
              {/* Graph input configuration — only once a graph is selected */}
              {selectedGraphId && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label style={labelStyle}>
                      Graph Input
                      {selectedGraph?.inputs?.length > 0 && (
                        <span style={{ color: c.muted, fontWeight: 400 }}>
                          {" "}({selectedGraph.inputs.length} field{selectedGraph.inputs.length !== 1 ? "s" : ""})
                        </span>
                      )}
                    </label>
                    {selectedGraph?.inputs?.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!showRawJson) {
                            try {
                              setRawInputJson(Object.keys(triggerInput ?? {}).length ? JSON.stringify(triggerInput, null, 2) : "{}");
                            } catch { /* keep existing */ }
                          }
                          setShowRawJson(!showRawJson);
                        }}
                        style={{ ...cancelBtnStyle, padding: "3px 10px", fontSize: "0.72rem" }}
                      >
                        {showRawJson ? "Use form" : "Edit as JSON"}
                      </button>
                    )}
                  </div>

                  {/* For Discord with a slash command: input source selector */}
                  {type === "discord" && discordCommand.trim() && (
                    <>
                      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                        {(["none", "text", "json"] as const).map((mode) => {
                          const labels: Record<string, string> = { none: "Static", text: "\u21a9 Text args", json: "{ } JSON args" };
                          const hints: Record<string, string> = {
                            none: "Fixed values stored on the trigger",
                            text: "Text after the command becomes input.text",
                            json: "JSON after the command replaces the entire input",
                          };
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setDiscordCommandInput(mode)}
                              title={hints[mode]}
                              style={{
                                flex: 1,
                                padding: "7px 6px",
                                borderRadius: 8,
                                border: `1.5px solid ${discordCommandInput === mode ? c.accent : c.border}`,
                                background: discordCommandInput === mode ? "rgba(203,166,247,0.12)" : c.surface,
                                color: discordCommandInput === mode ? c.accent : c.subtext,
                                cursor: "pointer",
                                fontSize: "0.78rem",
                                fontWeight: discordCommandInput === mode ? 600 : 400,
                                textAlign: "center",
                              }}
                            >
                              {labels[mode]}
                            </button>
                          );
                        })}
                      </div>
                      {discordCommandInput === "text" && (
                        <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(203,166,247,0.05)", border: `1px solid ${c.border}`, marginBottom: 10, fontSize: "0.79rem", color: c.subtext }}>
                          Text after{" "}
                          <code>/{discordCommand} your message</code>{" "}
                          is passed as <code>input.text</code> to the graph.
                          {selectedGraph?.inputs?.some((i: any) => i.key === "text") &&
                            ` The graph declares a "text" input — it will receive the message directly.`}
                        </div>
                      )}
                      {discordCommandInput === "json" && (
                        <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(203,166,247,0.05)", border: `1px solid ${c.border}`, marginBottom: 10, fontSize: "0.79rem", color: c.subtext }}>
                          JSON after{" "}
                          <code>/{discordCommand} {'{"key":"val"}'}</code>{" "}
                          is parsed and passed as the full graph input. Invalid JSON sends an empty object.
                        </div>
                      )}
                    </>
                  )}

                  {/* Silent-start toggle: show for Discord triggers (slash-command or otherwise) */}
                  {type === "discord" && (
                    <label style={{
                      display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                      padding: "9px 12px", borderRadius: 8, marginTop: 4,
                      background: discordSilentStart ? "rgba(203,166,247,0.06)" : c.surface,
                      border: `1px solid ${discordSilentStart ? "rgba(203,166,247,0.3)" : c.border}`,
                    }}>
                      <input
                        type="checkbox"
                        checked={discordSilentStart}
                        onChange={(e) => setDiscordSilentStart(e.target.checked)}
                        style={{ accentColor: c.accent, width: 14, height: 14, flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: discordSilentStart ? c.accent : c.text }}>
                          Silent start
                        </div>
                        <div style={{ fontSize: "0.74rem", color: c.subtext, marginTop: 2, lineHeight: 1.4 }}>
                          Skip the "🚀 Command started" acknowledgement message. Useful when the graph sends its own reply.
                        </div>
                      </div>
                    </label>
                  )}

                  {/* Static input fields — shown for "Static" mode (or non-Discord / no command) */}
                  {(discordCommandInput === "none" || !discordCommand.trim() || type !== "discord") && (
                    showRawJson || !selectedGraph?.inputs?.length ? (
                      <div>
                        <textarea
                          placeholder={'{\n  "key": "value"\n}'}
                          style={{ ...inputStyle, minHeight: 110, fontFamily: "monospace", fontSize: "0.8rem", resize: "vertical" }}
                          value={rawInputJson}
                          onChange={(e) => {
                            setRawInputJson(e.target.value);
                            try { setTriggerInput(JSON.parse(e.target.value)); } catch { /* keep last valid */ }
                          }}
                        />
                        {!selectedGraph?.inputs?.length && (
                          <p style={{ color: c.muted, fontSize: "0.72rem", margin: "-8px 0 6px" }}>
                            {selectedGraph
                              ? "This graph has no declared inputs. Enter a JSON object to pass as input, or leave empty."
                              : "Loading graph…"}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {selectedGraph.inputs.map((inp: any) => (
                          <div key={inp.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <label style={{ fontSize: "0.82rem", color: c.subtext, fontWeight: 600 }}>
                              {inp.label ?? inp.key}{inp.required ? " *" : ""}
                              {inp.description && (
                                <span style={{ fontWeight: 400, color: c.muted, fontSize: "0.78rem" }}> — {inp.description}</span>
                              )}
                            </label>
                            {inp.type === "boolean" ? (
                              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={!!(triggerInput ?? {})[inp.key]}
                                  onChange={(e) => setTriggerInput({ ...(triggerInput ?? {}), [inp.key]: e.target.checked })}
                                />
                                <span style={{ color: c.muted, fontSize: "0.8rem" }}>{inp.description ?? inp.key}</span>
                              </label>
                            ) : inp.type === "number" ? (
                              <input
                                type="number"
                                style={inputStyle}
                                value={(triggerInput ?? {})[inp.key] ?? ""}
                                onChange={(e) =>
                                  setTriggerInput({ ...(triggerInput ?? {}), [inp.key]: e.target.value === "" ? undefined : Number(e.target.value) })
                                }
                              />
                            ) : inp.type === "json" ? (
                              <textarea
                                style={{ ...inputStyle, minHeight: 70, fontFamily: "monospace", fontSize: "0.79rem" }}
                                value={
                                  typeof (triggerInput ?? {})[inp.key] === "string"
                                    ? ((triggerInput ?? {})[inp.key] as string)
                                    : JSON.stringify((triggerInput ?? {})[inp.key] ?? "", null, 2)
                                }
                                onChange={(e) => {
                                  try {
                                    setTriggerInput({ ...(triggerInput ?? {}), [inp.key]: JSON.parse(e.target.value) });
                                  } catch {
                                    setTriggerInput({ ...(triggerInput ?? {}), [inp.key]: e.target.value });
                                  }
                                }}
                              />
                            ) : (
                              <input
                                style={inputStyle}
                                value={(triggerInput ?? {})[inp.key] ?? ""}
                                onChange={(e) => setTriggerInput({ ...(triggerInput ?? {}), [inp.key]: e.target.value })}
                              />
                            )}
                          </div>
                        ))}
                        <p style={{ color: c.muted, fontSize: "0.72rem", margin: "0" }}>
                          Stored as static input — passed to the graph every time it fires.
                        </p>
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          )}

          {/* Type */}
          <label style={labelStyle}>Trigger Type</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {TRIGGER_TYPES.map((tt) => (
              <button
                key={tt.value}
                type="button"
                onClick={() => setType(tt.value)}
                style={{
                  flex: "1 1 calc(33% - 8px)",
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

          {/* Schedule builder — handles Repeat/Daily/Weekly/Monthly/One-off/Advanced tabs */}
          {type === "cron" && (
            <>
              <label style={labelStyle}>Schedule</label>
              <ScheduleBuilder value={scheduleOutput} onChange={setScheduleOutput} />
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
              {/* Agent-only Discord fields: mode, bot token, guild, channel, mention-only */}
              {targetType === "agent" && (
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
                  <label style={labelStyle}>Bot Token <span style={{ color: c.muted, fontWeight: 400 }}>(optional if using slash command)</span></label>
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

              {/* Graph-target Discord: explain how it works */}
              {targetType === "graph" && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(203,166,247,0.06)", border: `1px solid ${c.border}`, marginBottom: 14, fontSize: "0.8rem", color: c.subtext }}>
                  Graph triggers use the <strong>Global Discord Bridge</strong> — define a slash command below and users type <code>/command</code> to run the graph.
                </div>
              )}

              {/* Shared scope: Guild + Channel restriction */}
              <label style={labelStyle}>Server ID <span style={{ color: c.muted, fontWeight: 400 }}>(optional — restrict to a specific server)</span></label>
              <input
                value={discordGuildId}
                onChange={(e) => setDiscordGuildId(e.target.value)}
                placeholder="e.g. 1234567890 — blank allows any server"
                style={inputStyle}
              />

              <label style={labelStyle}>Channel Restrictions <span style={{ color: c.muted, fontWeight: 400 }}>(optional, comma-separated)</span></label>
              <input
                value={discordChannelIds}
                onChange={(e) => setDiscordChannelIds(e.target.value)}
                placeholder="IDs or names: 111222333, general, #announcements — blank = all channels"
                style={inputStyle}
              />

              {/* Slash command — shown for both targets */}
              <label style={labelStyle}>
                Discord Slash Command{" "}
                <span style={{ color: c.muted, fontWeight: 400, fontSize: "0.8rem" }}>
                  {targetType === "graph" ? "(required for graph triggers)" : "(optional — uses Global Bridge)"}
                </span>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ color: c.muted, fontSize: "0.95rem", userSelect: "none" }}>/</span>
                <input
                  value={discordCommand}
                  onChange={(e) => setDiscordCommand(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="e.g. sortmail or run-report"
                  style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                />
              </div>
              <p style={{ color: c.muted, fontSize: "0.72rem", margin: "2px 0 12px" }}>
                Users type <code>/command</code> in Discord to fire this trigger.
                Reserved: <code>help</code>, <code>newchat</code>, <code>cancel</code>.
              </p>

              {discordCommand.trim() && (
                <>
                  <label style={labelStyle}>Command Input Mapping</label>
                  <select
                    value={discordCommandInput}
                    onChange={(e) => setDiscordCommandInput(e.target.value as "none" | "text" | "json")}
                    style={inputStyle}
                  >
                    <option value="text">Pass args as input.text (default)</option>
                    <option value="json">Parse args as JSON → input</option>
                    <option value="none">Ignore args — use static trigger input</option>
                  </select>
                </>
              )}
            </>
          )}

          {/* Channel adapter fields */}
          {type === "channel" && (
            <>
              <label style={labelStyle}>Channel Adapter</label>
              {installedChannels.length > 0 ? (
                <select
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select a channel…</option>
                  {installedChannels.map((ch) => (
                    <option key={`${ch.contributor}/${ch.name}`} value={`${ch.contributor}/${ch.name}`}>
                      {ch.contributor}/{ch.name} — {ch.description}
                    </option>
                  ))}
                </select>
              ) : (
                <p style={{ color: c.muted, fontSize: "0.82rem", margin: "0 0 12px" }}>
                  No channel adapters installed. Install one from the Marketplace under the <strong>channels</strong> category.
                </p>
              )}

              <label style={labelStyle}>Mode</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {([
                  { key: "trigger" as const, label: "Trigger", desc: "Each message spawns an independent agent run." },
                  { key: "bridge" as const, label: "Chat Bridge", desc: "Persistent conversation with full chat history." },
                ] as const).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setChannelMode(m.key)}
                    style={{
                      flex: 1,
                      padding: "10px 10px",
                      borderRadius: 10,
                      border: `1.5px solid ${channelMode === m.key ? c.accent : c.border}`,
                      background: channelMode === m.key ? "rgba(203,166,247,0.12)" : c.surface,
                      color: channelMode === m.key ? c.accent : c.subtext,
                      cursor: "pointer",
                      fontSize: "0.83rem",
                      fontWeight: channelMode === m.key ? 600 : 400,
                      textAlign: "center",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p style={{ color: c.muted, fontSize: "0.78rem", margin: "-6px 0 14px" }}>
                Configure secrets (API keys, tokens) for this channel via Marketplace → Channel Adapter → Settings.
              </p>
            </>
          )}

          {/* Task Template — agent only */}
          {targetType === "agent" && (
            <>
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
            </>
          )}

          {/* Max Steps — agent only */}
          {targetType === "agent" && (
            <>
              <label style={labelStyle}>Max Steps</label>
              <input value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} type="number" min={1} max={50} style={{ ...inputStyle, width: 100 }} />
            </>
          )}

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
