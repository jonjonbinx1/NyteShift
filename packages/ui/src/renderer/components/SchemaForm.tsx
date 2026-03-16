import React from "react";
import { useTheme } from "../theme/ThemeContext.js";
import type { GraphNodeInfo } from "../global.js";

export function SchemaForm({ schema, value, onChange, vars, nodes }: { schema: any; value?: any; onChange(v: any): void; vars?: Record<string, unknown>; nodes?: GraphNodeInfo[] }) {
  const { palette: C } = useTheme();

  const containerStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
  const labelStyle: React.CSSProperties = { fontSize: "0.85rem", fontWeight: 600, color: C.subtext0 };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text };
  const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 80, fontFamily: "monospace", resize: "vertical" };
  const btnStyle: React.CSSProperties = { padding: "6px 8px", borderRadius: 6 };

  const root = (value && typeof value === "object") ? value : {};

  const setProp = (key: string, v: any) => {
    const next = { ...(root || {}) };
    if (v === undefined || v === null) delete next[key];
    else next[key] = v;
    onChange(next);
  };

  const varOptions = Object.keys(vars ?? {});
  const isTemplateString = (v: any) => (typeof v === 'string') && v.trim().startsWith('{{') && v.trim().endsWith('}}');
  const nodeOutputOptions = (nodes ?? []).filter((n: GraphNodeInfo) => n.type !== 'input').map((n: GraphNodeInfo) => ({ k: n.outputKey ?? n.id, label: n.name ?? n.id }));
  const tplFromRefValue = (v: string) => v.startsWith('vars:') ? `{{vars.${v.slice(5)}}}` : v.startsWith('node:') ? `{{${v.slice(5)}.output}}` : `{{${v}}}`;
  const RefSelect = ({ onPick, label = 'Use ref\u2026' }: { onPick: (tpl: string) => void; label?: string }) => (
    <select style={btnStyle as any} onChange={e => { const v = e.target.value; if (v) { onPick(tplFromRefValue(v)); } (e.target as HTMLSelectElement).value = ''; }}>
      <option value=''>{label}</option>
      {varOptions.length > 0 && <optgroup label="Vars">{varOptions.map(v => <option key={`vars:${v}`} value={`vars:${v}`}>{`vars.${v}`}</option>)}</optgroup>}
      {nodeOutputOptions.length > 0 && <optgroup label="Node outputs">{nodeOutputOptions.map(o => <option key={`node:${o.k}`} value={`node:${o.k}`}>{o.label}</option>)}</optgroup>}
    </select>
  );

  function ArrayEditor({ value: arrVal, itemsSchema, onChange: onArrChange }: { value: any; itemsSchema: any; onChange(v: any): void }) {
    const arr = Array.isArray(arrVal) ? arrVal : (itemsSchema?.default ?? []);
    const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
    const [editingAll, setEditingAll] = React.useState(false);
    const [rawAll, setRawAll] = React.useState<string>(() => JSON.stringify(arr, null, 2));
    const [editingRaw, setEditingRaw] = React.useState<string>('');

    React.useEffect(() => { setRawAll(JSON.stringify(arr, null, 2)); setEditingIndex(null); setEditingRaw(''); }, [arrVal]);

    const startEditItem = (i: number) => {
      try { setEditingRaw(JSON.stringify(arr[i], null, 2)); } catch { setEditingRaw(String(arr[i] ?? '')); }
      setEditingIndex(i);
    };

    const saveItem = (i: number) => {
      const t = editingRaw ?? '';
      try { const p = JSON.parse(t); const next = [...arr]; next[i] = p; onArrChange(next); } catch { const next = [...arr]; next[i] = t; onArrChange(next); }
      setEditingIndex(null); setEditingRaw('');
    };

    const saveAll = () => { try { const p = JSON.parse(rawAll); if (Array.isArray(p)) { onArrChange(p); setEditingAll(false); } } catch { } };

    const defaultForType = () => {
      const t = itemsSchema?.type;
      if (t === 'number' || t === 'integer') return 0;
      if (t === 'boolean') return false;
      if (t === 'object') return {};
      if (t === 'array') return [];
      if (t === 'string') return '';
      return itemsSchema?.default ?? null;
    };

    const addItem = () => onArrChange([...(arr ?? []), defaultForType()]);
    const removeItem = (i:number) => { const next = [...arr]; next.splice(i,1); onArrChange(next); };

    if (editingAll) return (
      <div>
        <textarea style={textareaStyle} value={rawAll} onChange={e => setRawAll(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={saveAll} style={btnStyle}>Save</button>
          <button onClick={() => { setEditingAll(false); setRawAll(JSON.stringify(arr, null, 2)); }} style={btnStyle}>Cancel</button>
        </div>
      </div>
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(arr as any[]).map((it: any, idx: number) => (
          <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {editingIndex === idx ? (
              <div style={{ flex: 1 }}>
                <textarea style={textareaStyle} value={editingRaw} onChange={e => setEditingRaw(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button onClick={() => saveItem(idx)} style={btnStyle}>Save</button>
                  <button onClick={() => { setEditingIndex(null); setEditingRaw(''); }} style={btnStyle}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {itemsSchema?.type === 'object' || itemsSchema?.type === 'array' ? (
                  <input style={inputStyle} value={JSON.stringify(it)} onChange={e => {
                    try { const p = JSON.parse(e.target.value); const n = [...arr]; n[idx] = p; onArrChange(n); } catch { const n = [...arr]; n[idx] = e.target.value; onArrChange(n); }
                  }} />
                ) : itemsSchema?.type === 'number' || itemsSchema?.type === 'integer' ? (
                  <input style={inputStyle} type='number' value={it ?? ''} onChange={e => { const n = [...arr]; n[idx] = e.target.value === '' ? undefined : (itemsSchema?.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value)); onArrChange(n); }} />
                ) : itemsSchema?.type === 'boolean' ? (
                  <>
                    <input type='checkbox' checked={Boolean(it)} onChange={e => { const n = [...arr]; n[idx] = e.target.checked; onArrChange(n); }} />
                    <div style={{ width: 8 }} />
                  </>
                ) : (
                  <input style={inputStyle} value={String(it)} onChange={e => { const n = [...arr]; n[idx] = e.target.value; onArrChange(n); }} />
                )}
                <button onClick={() => startEditItem(idx)} style={btnStyle}>JSON</button>
                <button onClick={() => removeItem(idx)} style={{ ...btnStyle, color: C.red }}>✕</button>
              </>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={addItem} style={btnStyle}>+ Add</button>
          <button onClick={() => { setEditingAll(true); setRawAll(JSON.stringify(arr, null, 2)); }} style={btnStyle}>Edit as JSON</button>
        </div>
      </div>
    );
  }

  const renderField = (key: string, propSchema: any) => {
    const cur = root?.[key];
    const required = Array.isArray(schema?.required) && schema.required.includes(key);
    const isVarRef = (typeof cur === 'string') && /^\s*\{\{\s*vars\.[^\}\s]+\s*\}\}\s*$/.test(cur);
    const isTpl = isTemplateString(cur);
    const desc = propSchema?.description;

    if (propSchema?.enum) {
      return (
        <div key={key} style={containerStyle}>
          <label style={labelStyle}>{key}{required ? ' *' : ''}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select style={inputStyle} value={isVarRef ? '' : (cur ?? '')} onChange={e => setProp(key, e.target.value)}>
              <option value=''> (none) </option>
              {propSchema.enum.map((o:any) => <option key={String(o)} value={o}>{String(o)}</option>)}
            </select>
            <RefSelect onPick={tpl => setProp(key, tpl)} />
          </div>
          {desc && <div style={{ fontSize: '0.75rem', color: C.overlay0 }}>{desc}</div>}
        </div>
      );
    }

    switch (propSchema?.type) {
      case 'string':
        return (
          <div key={key} style={containerStyle}>
            <label style={labelStyle}>{key}{required ? ' *' : ''}</label>
            {isTpl ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={inputStyle} value={cur ?? ''} onChange={e => setProp(key, e.target.value)} />
                <RefSelect onPick={tpl => setProp(key, tpl)} />
                <button onClick={() => setProp(key, propSchema?.default ?? '')} style={btnStyle} title="Clear template">✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={inputStyle} value={cur ?? (propSchema?.default ?? '')} onChange={e => setProp(key, e.target.value)} />
                <RefSelect onPick={tpl => setProp(key, tpl)} />
              </div>
            )}
            {desc && <div style={{ fontSize: '0.75rem', color: C.overlay0 }}>{desc}</div>}
          </div>
        );

      case 'number':
      case 'integer':
        return (
          <div key={key} style={containerStyle}>
            <label style={labelStyle}>{key}{required ? ' *' : ''}</label>
            {isTpl ? (
              <input style={inputStyle} value={cur ?? ''} onChange={e => setProp(key, e.target.value)} />
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={inputStyle} type='number' value={cur ?? (propSchema?.default ?? '')} onChange={e => setProp(key, e.target.value === '' ? undefined : (propSchema?.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value)))} />
                <button onClick={() => setProp(key, '{{}}')} style={btnStyle}>Use template</button>
              </div>
            )}
            {desc && <div style={{ fontSize: '0.75rem', color: C.overlay0 }}>{desc}</div>}
          </div>
        );

      case 'boolean':
        return (
          <div key={key} style={containerStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!isTpl && <input type='checkbox' checked={Boolean(cur ?? propSchema?.default ?? false)} onChange={e => setProp(key, e.target.checked)} />}
              <span style={labelStyle}>{key}{required ? ' *' : ''}</span>
            </label>
            {isTpl && <input style={inputStyle} value={cur ?? ''} onChange={e => setProp(key, e.target.value)} />}
            <div style={{ marginTop: 6 }}>
              <button onClick={() => setProp(key, '{{}}')} style={btnStyle}>Use template</button>
            </div>
            {desc && <div style={{ fontSize: '0.75rem', color: C.overlay0 }}>{desc}</div>}
          </div>
        );

      case 'array':
        return (
          <div key={key} style={containerStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <label style={labelStyle}>{key}{required ? ' *' : ''}</label>
              {isTpl ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <RefSelect onPick={tpl => setProp(key, tpl)} label="Change ref\u2026" />
                  <button onClick={() => setProp(key, propSchema?.default ?? [])} style={btnStyle} title="Clear ref, edit items">Clear ref</button>
                </div>
              ) : (
                <RefSelect onPick={tpl => setProp(key, tpl)} label="Bind ref\u2026" />
              )}
            </div>
            {isTpl ? (
              <div>
                <input style={inputStyle} value={cur ?? ''} onChange={e => setProp(key, e.target.value)} />
                <div style={{ fontSize: '0.72rem', color: C.overlay0, marginTop: 4 }}>
                  Bound to a node ref — the runtime resolves this to the actual array at run time.
                </div>
              </div>
            ) : (
              <ArrayEditor value={cur ?? propSchema?.default ?? []} itemsSchema={propSchema?.items ?? {}} onChange={(v:any) => setProp(key, v)} />
            )}
            {desc && <div style={{ fontSize: '0.75rem', color: C.overlay0 }}>{desc}</div>}
          </div>
        );

      case 'object':
        return (
          <div key={key} style={containerStyle}>
            <label style={labelStyle}>{key}{required ? ' *' : ''}</label>
            {isTpl ? (
              <input style={inputStyle} value={cur ?? ''} onChange={e => setProp(key, e.target.value)} />
            ) : (
              <div style={{ paddingLeft: 8, borderLeft: `2px solid ${C.surface1}`, marginTop: 6 }}>
                <SchemaForm schema={propSchema} value={cur ?? {}} onChange={(v) => setProp(key, v)} vars={vars} nodes={nodes} />
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <button onClick={() => setProp(key, '{{}}')} style={btnStyle}>Use template</button>
            </div>
            {desc && <div style={{ fontSize: '0.75rem', color: C.overlay0 }}>{desc}</div>}
          </div>
        );

      default:
        return (
          <div key={key} style={containerStyle}>
            <label style={labelStyle}>{key}{required ? ' *' : ''}</label>
            <textarea style={textareaStyle} value={JSON.stringify(cur ?? propSchema?.default ?? null, null, 2)} onChange={e => { try { setProp(key, JSON.parse(e.target.value)); } catch { } }} />
            <div style={{ marginTop: 6 }}>
              <button onClick={() => setProp(key, '{{}}')} style={btnStyle}>Use template</button>
            </div>
          </div>
        );
    }
  };

  if (!schema || schema.type !== 'object' || !schema.properties) {
    return (
      <div>
        <textarea style={textareaStyle} value={JSON.stringify(value ?? {}, null, 2)} onChange={e => { try { onChange(JSON.parse(e.target.value)); } catch { } }} />
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
