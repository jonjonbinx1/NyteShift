import React, { useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme/ThemeContext.js";
import type { GraphInputInfo } from "../global.js";

type EntryRow = {
  key: string;
  label: string;
  type: string;
  defaultRaw: string;
  description: string;
  required: boolean;
};

const EMPTY_ROW: EntryRow = { key: "", label: "", type: "string", defaultRaw: "", description: "", required: false };

export default function InputVariablesEditor({
  open,
  inputs,
  onChange,
  onClose,
}: {
  open: boolean;
  inputs: GraphInputInfo[];
  onChange: (v: GraphInputInfo[]) => void;
  onClose: () => void;
}) {
  const { palette: C } = useTheme();
  const [entries, setEntries] = useState<EntryRow[]>([EMPTY_ROW]);

  // Reset entries whenever the modal opens or the inputs prop changes.
  // This must stay BEFORE any early return to avoid hooks-order violation.
  useEffect(() => {
    if (!open) return;
    const e = (inputs ?? []).map(i => ({
      key: i.key ?? "",
      label: i.label ?? "",
      type: i.type ?? "string",
      defaultRaw: (() => {
        try { return i.default === undefined ? "" : JSON.stringify(i.default); } catch { return String(i.default); }
      })(),
      description: i.description ?? "",
      required: !!i.required,
    }));
    setEntries(e.length ? e : [{ ...EMPTY_ROW }]);
  }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Compute duplicate-key validation — must also be before any early return.
  const keyCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entries) {
      const k = (e.key ?? "").trim();
      if (!k) continue;
      map[k] = (map[k] || 0) + 1;
    }
    return map;
  }, [entries]);

  const entryErrors: (string | undefined)[] = entries.map(e => {
    const k = (e.key ?? "").trim();
    if (!k) return "Key required";
    if ((keyCounts[k] || 0) > 1) return "Duplicate key";
    return undefined;
  });

  const hasErrors = entryErrors.some(Boolean);

  // Early return must come AFTER all hooks.
  if (!open) return null;

  function setEntry(i: number, patch: Partial<EntryRow>) {
    setEntries(es => es.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function addRow() {
    setEntries(es => [...es, { ...EMPTY_ROW }]);
  }

  function removeRow(i: number) {
    setEntries(es => {
      const next = es.filter((_, idx) => idx !== i);
      return next.length ? next : [{ ...EMPTY_ROW }];
    });
  }

  function save() {
    const out: GraphInputInfo[] = [];
    for (const { key, label, type, defaultRaw, description, required } of entries) {
      const trimmedKey = (key ?? "").trim();
      if (!trimmedKey) continue;
      let parsed: unknown = undefined;
      if (defaultRaw !== "") {
        try { parsed = JSON.parse(defaultRaw); } catch { parsed = defaultRaw; }
      }
      out.push({ key: trimmedKey, label: label || undefined, type: type as GraphInputInfo["type"], default: parsed, description: description || undefined, required: !!required });
    }
    onChange(out);
    onClose();
  }

  // Shared style helpers — matched to the rest of the UI (NodeConfigPanel conventions).
  const fieldStyle: React.CSSProperties = {
    width: "100%", padding: "6px 8px", borderRadius: 6,
    border: `1px solid ${C.surface2}`, background: C.mantle,
    color: C.text, fontSize: "0.8rem", outline: "none", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.7rem", fontWeight: 600, color: C.subtext0,
    marginBottom: 4, display: "block", textTransform: "uppercase", letterSpacing: "0.04em",
  };
  const cardStyle: React.CSSProperties = {
    border: `1px solid ${C.surface1}`, borderRadius: 8, padding: "12px 14px",
    background: C.surface0, display: "flex", flexDirection: "column", gap: 10,
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 700, maxHeight: "82vh", display: "flex", flexDirection: "column", background: C.base, borderRadius: 10, boxShadow: "0 12px 40px rgba(0,0,0,0.5)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.surface1}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: C.text }}>Graph Inputs</div>
            <div style={{ fontSize: "0.72rem", color: C.subtext0, marginTop: 2 }}>Define variables that callers can pass when running this graph.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: "transparent", color: C.subtext0, cursor: "pointer", fontSize: "0.8rem" }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={hasErrors}
              title={hasErrors ? "Fix errors before saving" : undefined}
              style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: hasErrors ? C.surface2 : C.mauve, color: hasErrors ? C.overlay0 : C.base, cursor: hasErrors ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "0.8rem" }}
            >
              Save
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.length === 0 && (
            <div style={{ color: C.subtext0, fontSize: "0.8rem", textAlign: "center", padding: "24px 0" }}>
              No inputs defined. Click <strong>+ Add Input</strong> below to start.
            </div>
          )}

          {entries.map((r, i) => (
            <div key={i} style={cardStyle}>
              {/* Row 1: Key · Type · Required · Remove */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 130px auto auto", gap: 10, alignItems: "end" }}>
                <div>
                  <label style={labelStyle}>Key *</label>
                  <input
                    placeholder="my_variable"
                    value={r.key}
                    onChange={e => setEntry(i, { key: e.target.value })}
                    style={{ ...fieldStyle, borderColor: entryErrors[i] ? "#f38ba8" : C.surface2 }}
                  />
                  {entryErrors[i] && (
                    <div style={{ color: "#f38ba8", fontSize: "0.72rem", marginTop: 4 }}>{entryErrors[i]}</div>
                  )}
                </div>

                <div>
                  <label style={labelStyle}>Type</label>
                  <select
                    value={r.type}
                    onChange={e => setEntry(i, { type: e.target.value })}
                    style={fieldStyle as React.CSSProperties}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="json">json</option>
                  </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingBottom: 2 }}>
                  <span style={{ ...labelStyle, marginBottom: 0 }}>Req</span>
                  <input
                    type="checkbox"
                    checked={r.required}
                    onChange={e => setEntry(i, { required: e.target.checked })}
                    style={{ width: 15, height: 15, cursor: "pointer" }}
                  />
                </div>

                <button
                  onClick={() => removeRow(i)}
                  title="Remove this input"
                  style={{ border: `1px solid ${C.surface2}`, background: "transparent", color: C.overlay0, cursor: "pointer", borderRadius: 6, padding: "4px 8px", fontSize: "0.75rem", alignSelf: "end", marginBottom: 1 }}
                >
                  ✕
                </button>
              </div>

              {/* Row 2: Label · Default */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelStyle}>Label</label>
                  <input
                    placeholder="Human-readable label"
                    value={r.label}
                    onChange={e => setEntry(i, { label: e.target.value })}
                    style={fieldStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Default</label>
                  <input
                    placeholder={r.type === "boolean" ? "true or false" : r.type === "number" ? "0" : r.type === "json" ? '{"key": "value"}' : '"example"'}
                    value={r.defaultRaw}
                    onChange={e => setEntry(i, { defaultRaw: e.target.value })}
                    style={fieldStyle}
                  />
                </div>
              </div>

              {/* Row 3: Description */}
              <div>
                <label style={labelStyle}>Description</label>
                <input
                  placeholder="Brief description of what this input does"
                  value={r.description}
                  onChange={e => setEntry(i, { description: e.target.value })}
                  style={fieldStyle}
                />
              </div>
            </div>
          ))}

          <button
            onClick={addRow}
            style={{ alignSelf: "flex-start", padding: "6px 12px", borderRadius: 6, border: `1px dashed ${C.surface2}`, background: "transparent", color: C.green, cursor: "pointer", fontSize: "0.8rem" }}
          >
            + Add Input
          </button>
        </div>
      </div>
    </div>
  );
}
