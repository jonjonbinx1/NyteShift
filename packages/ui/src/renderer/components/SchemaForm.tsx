import React from "react";
import { useTheme } from "../theme/ThemeContext.js";
import type { ThemePalette } from "../theme/themes.js";

export function SchemaForm({ schema, value, onChange, vars }: { schema: any; value?: any; onChange(v: any): void; vars?: Record<string, unknown> }) {
  const { palette: C } = useTheme();

  const containerStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
  const labelStyle: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 700, color: C.subtext0 };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text };
  const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 80, fontFamily: "monospace", resize: "vertical" };

  const root = (value && typeof value === "object") ? value : {};

  const setProp = (key: string, v: any) => {
    const next = { ...(root || {}) };
    if (v === undefined || v === null) delete next[key];
    else next[key] = v;
    onChange(next);
  };

  const varOptions = Object.keys(vars ?? {});

  const renderField = (key: string, propSchema: any) => {
    const cur = root?.[key];
    const required = Array.isArray(schema?.required) && schema.required.includes(key);

    const varRefMatch = (typeof cur === "string") ? cur.match(/^\s*\{\{\s*vars\.([^}\s]+)\s*\}\}\s*$/) : null;
    const isVarRef = Boolean(varRefMatch);

    const description = propSchema?.description;

    if (propSchema?.enum) {
      return (
        <div key={key} style={containerStyle}>
          <label style={labelStyle}>{key}{required ? " *" : ""}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select style={inputStyle} value={isVarRef ? "" : (cur ?? "")} onChange={e => setProp(key, e.target.value)}>
              <option value="">(none)</option>
              {propSchema.enum.map((opt: any) => <option key={String(opt)} value={opt}>{String(opt)}</option>)}
            </select>
            <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
              <option value="">Use var…</option>
              {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          {description && <div style={{ fontSize: "0.7rem", color: C.overlay0 }}>{description}</div>}
        </div>
      );
    }

    switch (propSchema?.type) {
      case "string":
        if (propSchema?.format === "textarea") {
          return (
            <div key={key} style={containerStyle}>
              <label style={labelStyle}>{key}{required ? " *" : ""}</label>
              <textarea style={textareaStyle} value={cur ?? (propSchema?.default ?? "")} onChange={e => setProp(key, e.target.value)} />
              {description && <div style={{ fontSize: "0.7rem", color: C.overlay0 }}>{description}</div>}
            </div>
          );
        }
        return (
          <div key={key} style={containerStyle}>
            <label style={labelStyle}>{key}{required ? " *" : ""}</label>
            {isVarRef ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ padding: "6px 10px", borderRadius: 6, background: C.surface1 }}>{varRefMatch?.[1]}</div>
                <button onClick={() => setProp(key, undefined)} style={{ padding: "6px 8px", borderRadius: 6 }}>Clear</button>
                <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
                  <option value="">Change var…</option>
                  {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input style={inputStyle} value={cur ?? (propSchema?.default ?? "")} onChange={e => setProp(key, e.target.value)} />
                <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
                  <option value="">Use var…</option>
                  {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            )}
            {description && <div style={{ fontSize: "0.7rem", color: C.overlay0 }}>{description}</div>}
          </div>
        );

      case "number":
      case "integer":
        return (
          <div key={key} style={containerStyle}>
            <label style={labelStyle}>{key}{required ? " *" : ""}</label>
            {isVarRef ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ padding: "6px 10px", borderRadius: 6, background: C.surface1 }}>{varRefMatch?.[1]}</div>
                <button onClick={() => setProp(key, undefined)} style={{ padding: "6px 8px", borderRadius: 6 }}>Clear</button>
                <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
                  <option value="">Change var…</option>
                  {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input style={inputStyle} type="number" value={cur ?? (propSchema?.default ?? "")} onChange={e => setProp(key, e.target.value === "" ? undefined : (propSchema?.type === "integer" ? parseInt(e.target.value, 10) : parseFloat(e.target.value)))} />
                <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
                  <option value="">Use var…</option>
                  {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            )}
            {description && <div style={{ fontSize: "0.7rem", color: C.overlay0 }}>{description}</div>}
          </div>
        );

      case "boolean":
        return (
          <div key={key} style={containerStyle}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {!isVarRef && <input type="checkbox" checked={Boolean(cur ?? propSchema?.default ?? false)} onChange={e => setProp(key, e.target.checked)} style={{ accentColor: C.mauve }} />}
              <span style={labelStyle}>{key}{required ? " *" : ""}</span>
            </label>
            {isVarRef ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <div style={{ padding: "6px 10px", borderRadius: 6, background: C.surface1 }}>{varRefMatch?.[1]}</div>
                <button onClick={() => setProp(key, undefined)} style={{ padding: "6px 8px", borderRadius: 6 }}>Clear</button>
                <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
                  <option value="">Change var…</option>
                  {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
                  <option value="">Use var…</option>
                  {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            )}
            {description && <div style={{ fontSize: "0.7rem", color: C.overlay0 }}>{description}</div>}
          </div>
        );

      case "array": {
        const items = propSchema?.items ?? {};
        if (items.type === "string" || items.type === "number") {
          const arr: any[] = Array.isArray(cur) ? cur : (propSchema?.default ?? []);
          return (
            <div key={key} style={containerStyle}>
              <label style={labelStyle}>{key}{required ? " *" : ""}</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {arr.map((it, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8 }}>
                    <input style={inputStyle} value={String(it)} onChange={e => { const next = [...arr]; next[idx] = items.type === "number" ? parseFloat(e.target.value) : e.target.value; setProp(key, next); }} />
                    <button onClick={() => { const next = [...arr]; next.splice(idx, 1); setProp(key, next); }} style={{ cursor: "pointer" }}>✕</button>
                  </div>
                ))}
                <button onClick={() => { const next = [...arr, items.type === "number" ? 0 : ""]; setProp(key, next); }} style={{ cursor: "pointer" }}>+ Add</button>
                <div style={{ marginTop: 6 }}>
                  <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
                    <option value="">Use var for entire array…</option>
                    {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              {description && <div style={{ fontSize: "0.7rem", color: C.overlay0 }}>{description}</div>}
            </div>
          );
        }
        // Fallback: show JSON editor for complex arrays
        return (
          <div key={key} style={containerStyle}>
            <label style={labelStyle}>{key}{required ? " *" : ""}</label>
            <textarea style={textareaStyle} value={JSON.stringify(cur ?? propSchema?.default ?? [], null, 2)} onChange={e => { try { setProp(key, JSON.parse(e.target.value)); } catch { /* ignore */ } }} />
            {description && <div style={{ fontSize: "0.7rem", color: C.overlay0 }}>{description}</div>}
          </div>
        );
      }

      case "object":
        return (
          <div key={key} style={containerStyle}>
            <label style={labelStyle}>{key}{required ? " *" : ""}</label>
            <div style={{ paddingLeft: 8, borderLeft: `2px solid ${C.surface1}`, marginTop: 6 }}>
              <SchemaForm schema={propSchema} value={cur ?? {}} onChange={(v) => setProp(key, v)} vars={vars} />
            </div>
            <div style={{ marginTop: 6 }}>
              <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
                <option value="">Use var for entire object…</option>
                {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            {description && <div style={{ fontSize: "0.7rem", color: C.overlay0 }}>{description}</div>}
          </div>
        );

      default:
        return (
          <div key={key} style={containerStyle}>
            <label style={labelStyle}>{key}{required ? " *" : ""}</label>
            <textarea style={textareaStyle} value={JSON.stringify(cur ?? propSchema?.default ?? null, null, 2)} onChange={e => { try { setProp(key, JSON.parse(e.target.value)); } catch { /* ignore */ } }} />
            <div style={{ marginTop: 6 }}>
              <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => { if (e.target.value) setProp(key, `{{vars.${e.target.value}}}`); e.target.value = ""; }}>
                <option value="">Use var…</option>
                {varOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            {description && <div style={{ fontSize: "0.7rem", color: C.overlay0 }}>{description}</div>}
          </div>
        );
    }
  };

  if (!schema || schema.type !== "object" || !schema.properties) {
    // simple fallback: raw JSON editor
    return (
      <div>
        <textarea style={textareaStyle} value={JSON.stringify(value ?? {}, null, 2)} onChange={e => { try { onChange(JSON.parse(e.target.value)); } catch { /* ignore */ } }} />
      </div>
    );
  }

  return (
    <div>
      {Object.entries(schema.properties).map(([k, s]) => renderField(k, s))}
    </div>
  );
}

export default SchemaForm;
