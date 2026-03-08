import React, { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext.js";
import type { ThemePalette } from "../theme/themes.js";

export default function VarsEditor({
  open,
  vars,
  onChange,
  onClose,
}: {
  open: boolean;
  vars: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const { palette: C } = useTheme();
  const [entries, setEntries] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    const e: Array<{ key: string; value: string }> = Object.entries(vars ?? {}).map(([k, v]) => {
      try {
        return { key: k, value: JSON.stringify(v) };
      } catch {
        return { key: k, value: String(v) };
      }
    });
    setEntries(e.length ? e : [{ key: "", value: "" }]);
  }, [open, vars]);

  if (!open) return null;

  function setEntry(i: number, patch: Partial<{ key: string; value: string }>) {
    setEntries(es => es.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setEntries(es => [...es, { key: "", value: "" }]);
  }

  function removeRow(i: number) {
    setEntries(es => es.filter((_, idx) => idx !== i));
  }

  function save() {
    const out: Record<string, unknown> = {};
    for (const { key, value } of entries) {
      if (!key) continue;
      let parsed: unknown = value;
      if (value === "") parsed = undefined;
      else {
        try { parsed = JSON.parse(value); } catch { parsed = value; }
      }
      out[key] = parsed;
    }
    onChange(out);
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000066", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 760, maxHeight: "80vh", overflow: "auto", background: C.surface0, borderRadius: 8, padding: 16, boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: "1rem", fontWeight: 600 }}>Graph Variables</div>
          <div>
            <button onClick={onClose} style={{ marginRight: 8, border: "none", background: "transparent", cursor: "pointer", color: C.subtext0 }}>Cancel</button>
            <button onClick={save} style={{ background: C.mauve, color: "#1e1e2e", border: "none", padding: "6px 10px", borderRadius: 6 }}>Save</button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {entries.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input placeholder="variable name" value={r.key} onChange={e => setEntry(i, { key: e.target.value })} style={{ flex: 0.3, padding: "6px 8px" }} />
              <input placeholder='value (JSON or plain text) e.g. 1 or "str" or true' value={r.value} onChange={e => setEntry(i, { value: e.target.value })} style={{ flex: 1, padding: "6px 8px" }} />
              <button onClick={() => removeRow(i)} style={{ border: "none", background: "transparent", color: C.surface2, cursor: "pointer" }}>✕</button>
            </div>
          ))}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addRow} style={{ border: "none", background: "transparent", color: C.green, cursor: "pointer" }}>+ Add variable</button>
          </div>
        </div>
      </div>
    </div>
  );
}
