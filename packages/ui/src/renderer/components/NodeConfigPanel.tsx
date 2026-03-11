import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext.js";
import type { ThemePalette } from "../theme/themes.js";
import type { GraphNodeInfo, GraphEdgeInfo, GraphDefinitionInfo, ModelInfo, ToolInfo, OperationActionInfo, CatchTrigger } from "../global.js";
import { SchemaForm } from "./SchemaForm.js";

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "exists", label: "exists" },
  { value: "not_exists", label: "does not exist" },
  { value: "matches", label: "matches regex" },
];

const NO_VALUE_OPS = ["exists", "not_exists"];

const ERROR_POLICY_TYPES = [
  { value: "halt", label: "Halt — stop the graph on error" },
  { value: "retry", label: "Retry — retry the node N times" },
  { value: "skip", label: "Skip — skip this node and continue" },
  { value: "fallback", label: "Fallback — use a fallback value" },
];

// Helper: extract pick and suffix from a template string like {{fetch.output.messages.0.uid}}
const extractTemplateParts = (val?: unknown) => {
  if (typeof val !== "string") return { pick: "", suffix: "" };
  const m = val.match(/^\s*\{\{\s*([^}\s]+)\s*\}\}\s*$/);
  if (!m) return { pick: "", suffix: "" };
  const inner = m[1];
  const mv = inner.match(/^vars\.([^.]+)(?:\.(.*))?$/);
  if (mv) return { pick: `vars:${mv[1]}`, suffix: mv[2] ?? "" };
  const mn = inner.match(/^([^.]*)\.output(?:\.(.*))?$/);
  if (mn) return { pick: `node:${mn[1]}`, suffix: mn[2] ?? "" };
  return { pick: "", suffix: inner };
};

const dotToBracket = (s: string) => s.replace(/\.(\d+)(?=\.|$)/g, '[$1]');

interface Props {
  node: GraphNodeInfo;
  allNodes?: GraphNodeInfo[];
  agents: string[];
  tools: ToolInfo[];
  providers: string[];
  vars?: Record<string, unknown>;
  onChange(updated: GraphNodeInfo): void;
  onDelete?(): void;
  onDuplicate?(): void;
  onOpenVars?(): void;
}

export function NodeConfigPanel({ node, allNodes, agents, tools, providers, vars, onChange, onDelete, onDuplicate, onOpenVars }: Props): React.JSX.Element {
  const { palette: C } = useTheme();

  // Resizable panel state
  const MIN_WIDTH = 220;
  const MAX_WIDTH = 900;
  const [panelWidth, setPanelWidth] = useState<number>(290);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onMouseMove = useCallback((ev: MouseEvent) => {
    if (!dragRef.current) return;
    const dx = dragRef.current.startX - ev.clientX;
    const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(dragRef.current.startWidth + dx)));
    setPanelWidth(next);
  }, []);

  const onMouseUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onMouseMove]);

  const onMouseDownResizer = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [panelWidth, onMouseMove, onMouseUp]);

  const onTouchMove = useCallback((ev: TouchEvent) => {
    if (!dragRef.current) return;
    const t = ev.touches[0];
    const dx = dragRef.current.startX - t.clientX;
    const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(dragRef.current.startWidth + dx)));
    setPanelWidth(next);
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.removeEventListener("touchmove", onTouchMove as any);
    document.removeEventListener("touchend", onTouchEnd as any);
    document.body.style.userSelect = "";
  }, [onTouchMove]);

  const onTouchStartResizer = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    dragRef.current = { startX: t.clientX, startWidth: panelWidth };
    document.addEventListener("touchmove", onTouchMove as any, { passive: false } as any);
    document.addEventListener("touchend", onTouchEnd as any);
    document.body.style.userSelect = "none";
  }, [panelWidth, onTouchMove, onTouchEnd]);

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove as any);
      document.removeEventListener("touchend", onTouchEnd as any);
    };
  }, [onMouseMove, onMouseUp, onTouchMove, onTouchEnd]);

  const set = useCallback(<K extends keyof GraphNodeInfo>(key: K, value: GraphNodeInfo[K]) => {
    onChange({ ...node, [key]: value });
  }, [node, onChange]);

  const errorPolicy = node.errorPolicy;
  const setEP = (key: string, value: unknown) => {
    onChange({ ...node, errorPolicy: { ...(node.errorPolicy ?? {}), type: node.errorPolicy?.type ?? "halt", [key]: value } as GraphNodeInfo["errorPolicy"] });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "6px 8px", background: C.mantle,
    border: `1px solid ${C.surface2}`, borderRadius: 6,
    color: C.text, fontSize: "0.8rem", outline: "none", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = { fontSize: "0.7rem", fontWeight: 600, color: C.subtext0, marginBottom: 3, display: "block" };
  const sectionStyle: React.CSSProperties = { marginBottom: 14 };
  const textareaStyle: React.CSSProperties = { ...inputStyle, resize: "vertical", minHeight: 70, fontFamily: "monospace", fontSize: "0.75rem" };
  const selectStyle: React.CSSProperties = { ...inputStyle };

  const otherNodes = (allNodes ?? []).filter((n: GraphNodeInfo) => n.id !== node.id);
  
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Graph list for trigger target selection
  const [graphs, setGraphs] = useState<GraphDefinitionInfo[]>([]);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const g = await window.nyteShiftApi?.graphList() ?? [];
        if (!mounted) return;
        setGraphs(g as GraphDefinitionInfo[]);
      } catch (e) {
        // ignore
      }
    })();
    return () => { mounted = false; };
  }, []);
  const qualifiedNodeToolName = node.toolName ?? "";
  const selectedTool = tools.find(t => `${t.contributor}/${t.name}` === qualifiedNodeToolName || t.name === qualifiedNodeToolName);

  const refreshModels = useCallback(async (prov?: string) => {
    try {
      const pid = prov ?? node.provider ?? providers?.[0];
      if (!pid) { setModels([]); return; }
      const m = await window.nyteShiftApi?.listProviderModels(pid) ?? [];
      setModels(m);
      if ((!node.model || node.model === "") && m.length) {
        set("model", m[0].id);
      }
    } catch (e) {
      setModels([]);
    }
  }, [node.provider, providers, node.model, set]);

  useEffect(() => {
    // fetch models when provider changes or providers list updates
    refreshModels();
  }, [node.provider, providers, refreshModels]);

  // Tool input builder state
  const [toolInputMode, setToolInputMode] = useState<"fields" | "json">(() => (typeof node.toolInput === "string" ? "json" : "fields"));
  const [toolFields, setToolFields] = useState<Array<{ key: string; value: string; isTemplate?: boolean }>>(() => {
    try {
      const inp = node.toolInput ?? {};
      const obj = typeof inp === "string" ? JSON.parse(inp) : inp;
      if (obj && typeof obj === "object") return Object.entries(obj).map(([k, v]) => {
        const str = typeof v === "string" ? v : JSON.stringify(v);
        const parts = extractTemplateParts(str);
        return { key: k, value: str, isTemplate: !!parts.pick };
      });
    } catch {}
    return [];
  });
  const [rawToolJson, setRawToolJson] = useState<string>(() => typeof node.toolInput === "string" ? node.toolInput : JSON.stringify(node.toolInput ?? {}, null, 2));
  const rawJsonRef = useRef<HTMLTextAreaElement | null>(null);
  const isJsonFocused = useRef(false);
  const [varPickerIndex, setVarPickerIndex] = useState<number | null>(null);

  useEffect(() => {
    // sync when node.toolInput externally changes — skip while user is actively editing
    if (isJsonFocused.current) return;
    try {
      const inp = node.toolInput ?? {};
      if (typeof inp === "string") setRawToolJson(inp);
      else setRawToolJson(JSON.stringify(inp, null, 2));
      if (typeof inp === "object" && inp !== null) {
        setToolFields(Object.entries(inp).map(([k, v]) => {
          const str = typeof v === "string" ? v : JSON.stringify(v);
          const parts = extractTemplateParts(str);
          return { key: k, value: str, isTemplate: !!parts.pick };
        }));
      }
    } catch {}
  }, [node.toolInput]);

  const commitFields = (fields: Array<{ key: string; value: string; isTemplate?: boolean }>) => {
    const obj: Record<string, unknown> = {};
    for (const f of fields) {
      if (!f.key) continue;
      if (f.isTemplate) { obj[f.key] = f.value; continue; }
      try { obj[f.key] = JSON.parse(f.value); } catch { obj[f.key] = f.value; }
    }
    set("toolInput", obj as any);
    setRawToolJson(JSON.stringify(obj, null, 2));
  };

  const commitSchemaValue = (v: unknown) => {
    set("toolInput", v as any);
    try { setRawToolJson(JSON.stringify(v ?? {}, null, 2)); } catch { setRawToolJson(String(v)); }
  };

  const updateField = (i: number, patch: Partial<{ key: string; value: string; isTemplate?: boolean }>) => {
    const next = toolFields.map((f, idx) => idx === i ? { ...f, ...patch } : f);
    setToolFields(next);
    commitFields(next);
  };

  const addField = () => { const next = [...toolFields, { key: "", value: "", isTemplate: false }]; setToolFields(next); };
  const removeField = (i: number) => { const next = toolFields.filter((_, idx) => idx !== i); setToolFields(next); commitFields(next); };

  const importJsonToFields = () => {
    try {
      const parsed = JSON.parse(rawToolJson);
      if (parsed && typeof parsed === "object") {
        const next = Object.entries(parsed).map(([k, v]) => {
          const str = typeof v === "string" ? v : JSON.stringify(v);
          const parts = extractTemplateParts(str);
          return { key: k, value: str, isTemplate: !!parts.pick };
        });
        setToolFields(next);
        setToolInputMode("fields");
        commitFields(next);
      }
    } catch {}
  };

  const insertRefIntoRawJson = (refKey: string) => {
    if (!refKey) return;
    let tpl: string;
    if (refKey.startsWith("{{")) tpl = refKey;
    else if (refKey.startsWith("vars:")) tpl = `{{vars.${refKey.slice(5)}}}`;
    else if (refKey.startsWith("node:")) tpl = `{{${refKey.slice(5)}.output}}`;
    else tpl = `{{${refKey}}}`;
    if (rawJsonRef.current) {
      const el = rawJsonRef.current;
      const start = el.selectionStart ?? rawToolJson.length;
      const end = el.selectionEnd ?? start;
      const next = rawToolJson.slice(0, start) + tpl + rawToolJson.slice(end);
      setRawToolJson(next);
      // restore cursor — commit happens on blur
      setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = start + tpl.length; }, 0);
      return;
    }
    setRawToolJson(rawToolJson + tpl);
  };

  const onRawJsonChange = (s: string) => {
    // Only update local display state — commit to node on blur to avoid
    // the useEffect reformatting the textarea and jumping the cursor.
    setRawToolJson(s);
  };

  const tryParseRawJson = () => {
    try {
      const parsed = JSON.parse(rawToolJson);
      set("toolInput", parsed as any);
      setToolFields(Object.entries(parsed).map(([k, v]) => {
        const str = typeof v === "string" ? v : JSON.stringify(v);
        const parts = extractTemplateParts(str);
        return { key: k, value: str, isTemplate: !!parts.pick };
      }));
    } catch {}
  };

  return (
    <div style={{
      width: panelWidth, minWidth: 220, background: C.surface0, position: "relative",
      borderLeft: `1px solid ${C.surface1}`,
      display: "flex", flexDirection: "column",
      overflowY: "auto", flexShrink: 0,
    }}>
      {/* Resizer (drag this) */}
      <div
        onMouseDown={onMouseDownResizer}
        onTouchStart={onTouchStartResizer}
        role="separator"
        aria-orientation="vertical"
        style={{ position: "absolute", left: -8, top: 0, bottom: 0, width: 16, cursor: "col-resize", zIndex: 40 }}
      />
      {/* Header */}
      <div style={{
        padding: "12px 14px 10px",
        borderBottom: `1px solid ${C.surface1}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>Node Config</div>
          <div style={{ fontSize: "0.7rem", color: C.subtext0, marginTop: 2 }}>{node.type} · {node.id}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {onDuplicate && (
            <button onClick={onDuplicate} style={{ ...btnSm(C), color: C.blue }} title="Duplicate">⧉</button>
          )}
          {onDelete && node.type !== "input" && node.type !== "output" && (
            <button onClick={onDelete} style={{ ...btnSm(C), color: C.red }} title="Delete">✕</button>
          )}
        </div>
      </div>

      <div style={{ padding: "12px 14px", flex: 1 }}>
        {/* Common: Name */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Name</label>
          <input
            style={inputStyle}
            value={node.name}
            onChange={e => set("name", e.target.value)}
          />
        </div>

        {/* Common: Output Key */}
        {node.type !== "output" && (
          <div style={sectionStyle}>
            <label style={labelStyle}>Output Key</label>
            <input
              style={inputStyle}
              value={node.outputKey ?? ""}
              placeholder={`${node.id}.output`}
              onChange={e => set("outputKey", e.target.value || undefined)}
            />
            <div style={{ fontSize: "0.65rem", color: C.overlay0, marginTop: 3 }}>
              Reference as <code style={{ color: C.teal }}>{`{{${node.outputKey || node.id}.output}}`}</code>
            </div>
          </div>
        )}

        {/* ---- LLM fields ---- */}
        {node.type === "llm" && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Provider</label>
              <select style={selectStyle} value={node.provider ?? ""} onChange={e => set("provider", e.target.value || undefined)}>
                <option value="">Default</option>
                {providers.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Model</label>
              {models.length > 0 ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select style={selectStyle} value={node.model ?? ""} onChange={e => set("model", e.target.value || undefined)}>
                    <option value="">Default</option>
                    {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                  </select>
                  <button onClick={() => refreshModels(node.provider)} style={{ ...btnSm(C) }}>Refresh</button>
                </div>
              ) : (
                <div>
                  <input style={inputStyle} value={node.model ?? ""} placeholder="e.g. claude-3-5-sonnet-20241022" onChange={e => set("model", e.target.value || undefined)} />
                  <div style={{ fontSize: "0.68rem", color: C.overlay0, marginTop: 6 }}>No models discovered for this provider; you can enter a model id manually.</div>
                </div>
              )}
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Temperature <span style={{ color: C.overlay0 }}>{node.temperature ?? 0.7}</span></label>
              <input type="range" min={0} max={2} step={0.05}
                style={{ width: "100%", accentColor: C.mauve }}
                value={node.temperature ?? 0.7}
                onChange={e => set("temperature", parseFloat(e.target.value))}
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Max Tokens</label>
              <input style={inputStyle} type="number" min={1} max={32000}
                value={node.maxTokens ?? ""} placeholder="Unlimited"
                onChange={e => set("maxTokens", e.target.value ? parseInt(e.target.value) : undefined)}
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>System Prompt</label>
              <textarea style={textareaStyle} value={node.systemPrompt ?? ""} placeholder="You are…"
                onChange={e => set("systemPrompt", e.target.value || undefined)} />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Prompt Template</label>
              <textarea style={{ ...textareaStyle, minHeight: 90 }}
                value={node.promptTemplate ?? ""}
                placeholder={"{{input.query}}"}
                onChange={e => set("promptTemplate", e.target.value || undefined)}
              />
              <TemplateTip C={C} nodes={otherNodes} />
            </div>
          </>
        )}

        {/* ---- Agent fields ---- */}
        {node.type === "agent" && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Agent</label>
              <select style={selectStyle} value={node.agentName ?? ""} onChange={e => set("agentName", e.target.value || undefined)}>
                <option value="">— select agent —</option>
                {agents.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Max Steps</label>
              <input style={inputStyle} type="number" min={1} max={50}
                value={node.maxSteps ?? ""}
                placeholder="20"
                onChange={e => set("maxSteps", e.target.value ? parseInt(e.target.value) : undefined)}
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Prompt Template</label>
              <textarea style={{ ...textareaStyle, minHeight: 90 }}
                value={node.promptTemplate ?? ""} placeholder={"{{input.task}}"}
                onChange={e => set("promptTemplate", e.target.value || undefined)}
              />
              <TemplateTip C={C} nodes={otherNodes} />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Provider Override</label>
              <select style={selectStyle} value={node.provider ?? ""} onChange={e => set("provider", e.target.value || undefined)}>
                <option value="">Agent Default</option>
                {providers.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Model Override</label>
              {models.length > 0 ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select style={selectStyle} value={node.model ?? ""} onChange={e => set("model", e.target.value || undefined)}>
                    <option value="">Agent Default</option>
                    {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                  </select>
                  <button onClick={() => refreshModels(node.provider)} style={{ ...btnSm(C) }}>Refresh</button>
                </div>
              ) : (
                <input style={inputStyle} value={node.model ?? ""} placeholder="Agent Default"
                  onChange={e => set("model", e.target.value || undefined)}
                />
              )}
            </div>
          </>
        )}

        {/* ---- Tool fields ---- */}
        {node.type === "tool" && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Tool Name</label>
              {tools.length > 0
                ? (
                  <select style={selectStyle} value={node.toolName ?? ""} onChange={e => set("toolName", e.target.value || undefined)}>
                    <option value="">— select tool —</option>
                    {tools.map(t => {
                      const qualified = `${t.contributor}/${t.name}`;
                      return <option key={qualified} value={qualified}>{qualified}</option>;
                    })}
                  </select>
                )
                : <input style={inputStyle} value={node.toolName ?? ""} placeholder="toolset/toolName"
                  onChange={e => set("toolName", e.target.value || undefined)} />
              }
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Tool Input</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button
                  onClick={() => setToolInputMode("fields")}
                  style={{ ...btnSm(C), background: toolInputMode === "fields" ? C.surface1 : "transparent" }}
                >Fields</button>
                <button
                  onClick={() => setToolInputMode("json")}
                  style={{ ...btnSm(C), background: toolInputMode === "json" ? C.surface1 : "transparent" }}
                >JSON</button>
                <button onClick={() => importJsonToFields()} style={{ ...btnSm(C) }}>Import JSON</button>
              </div>

              {/* If the selected tool exposes a formal inputSchema, render a schema-driven form */}
              {selectedTool?.spec?.inputSchema ? (
                toolInputMode === "fields" ? (
                  <div>
                    <SchemaForm
                      schema={selectedTool.spec.inputSchema}
                      value={typeof node.toolInput === "string" ? (() => { try { return JSON.parse(node.toolInput as string); } catch { return {}; } })() : (node.toolInput ?? {})}
                      onChange={(v: unknown) => commitSchemaValue(v)}
                      vars={vars}
                      nodes={otherNodes}
                    />
                    <div style={{ marginTop: 8 }}>
                      <TemplateTip C={C} nodes={otherNodes} />
                    </div>
                  </div>
                ) : (
                  <div>
                    <textarea
                      ref={rawJsonRef}
                      style={{ ...textareaStyle, minHeight: 120, fontFamily: "monospace" }}
                      value={rawToolJson}
                      placeholder={'{\n  "query": "{{input.query}}"\n}'}
                      onChange={e => onRawJsonChange(e.target.value)}
                      onFocus={() => { isJsonFocused.current = true; }}
                      onBlur={() => { isJsonFocused.current = false; tryParseRawJson(); }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <button onClick={() => tryParseRawJson()} style={{ ...btnSm(C) }}>Parse</button>
                      <button onClick={() => { setRawToolJson(JSON.stringify(node.toolInput ?? {}, null, 2)); }} style={{ ...btnSm(C) }}>Reset</button>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <select style={{ ...btnSm(C) }} onChange={(e) => {
                          const sel = e.target as HTMLSelectElement;
                          const v = sel.value; if (!v) return;
                          const container = sel.parentElement as HTMLElement | null;
                          let suffixInput: HTMLInputElement | null = null;
                          if (container) {
                            const inputs = container.querySelectorAll('input');
                            if (inputs && inputs.length > 0) suffixInput = inputs[inputs.length - 1] as HTMLInputElement;
                          }
                          let suffix = suffixInput?.value?.trim() ?? '';
                          suffix = suffix.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
                          let tpl = '';
                          if (v.startsWith('vars:')) tpl = `{{vars.${v.slice(5)}${suffix ? '.' + suffix : ''}}}`;
                          else if (v.startsWith('node:')) tpl = `{{${v.slice(5)}.output${suffix ? '.' + suffix : ''}}}`;
                          else tpl = `{{${v}${suffix ? '.' + suffix : ''}}}`;
                          insertRefIntoRawJson(tpl);
                          sel.value = '';
                          if (suffixInput) suffixInput.value = '';
                        }}>
                          <option value="">Insert ref…</option>
                          {Object.keys(vars ?? {}).length > 0 && (
                            <optgroup label="Vars">
                              {Object.keys(vars ?? {}).map(k => <option key={`vars:${k}`} value={`vars:${k}`}>{k}</option>)}
                            </optgroup>
                          )}
                          {otherNodes.length > 0 && (
                            <optgroup label="Node outputs">
                              {otherNodes.map(n => <option key={`node:${n.outputKey ?? n.id}`} value={`node:${n.outputKey ?? n.id}`}>{n.name ?? n.id}</option>)}
                            </optgroup>
                          )}
                        </select>
                        <input placeholder="append .path or [0].key" style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text, width: 160 }} />
                      </div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <TemplateTip C={C} nodes={otherNodes} />
                    </div>
                  </div>
                )
              ) : (
                toolInputMode === "fields" ? (
                  <div>
                    {(toolFields.length === 0) && (
                      <div style={{ color: C.overlay0, fontSize: "0.82rem", marginBottom: 8 }}>No fields yet — add keys to build the JSON tool input.</div>
                    )}
                    {toolFields.map((f, i) => {
                      const parts = extractTemplateParts(f.value);
                      const initialSuffix = dotToBracket(parts.suffix ?? "");
                      return (
                        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                          <input
                            placeholder="key"
                            value={f.key}
                            onChange={e => updateField(i, { key: e.target.value })}
                            style={{ ...inputStyle, flex: 0.4 }}
                          />
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                            <input
                              placeholder={f.isTemplate ? "template {{...}}" : "value (string or JSON)"}
                              value={f.value}
                              onChange={e => updateField(i, { value: e.target.value })}
                              style={{ ...inputStyle, flex: 1 }}
                            />
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <button
                                onClick={() => updateField(i, { isTemplate: !f.isTemplate })}
                                title="Toggle template mode"
                                style={{ ...btnSm(C), background: f.isTemplate ? C.surface1 : "transparent", border: `1px solid ${f.isTemplate ? C.surface2 : "transparent"}`, padding: "6px 8px" }}
                              >
                                T
                              </button>
                              <select
                                style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }}
                                onChange={e => {
                                  const sel = e.target as HTMLSelectElement;
                                  const v = sel.value; if (!v) return;
                                  const container = sel.parentElement as HTMLElement | null;
                                  let suffixInput: HTMLInputElement | null = null;
                                  if (container) {
                                    const inputs = container.querySelectorAll('input');
                                    if (inputs && inputs.length > 0) suffixInput = inputs[inputs.length - 1] as HTMLInputElement;
                                  }
                                  let suffix = suffixInput?.value?.trim() ?? '';
                                  suffix = suffix.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
                                  if (v.startsWith("vars:")) updateField(i, { value: `{{vars.${v.slice(5)}${suffix ? '.' + suffix : ''}}}`, isTemplate: true });
                                  else if (v.startsWith("node:")) updateField(i, { value: `{{${v.slice(5)}.output${suffix ? '.' + suffix : ''}}}`, isTemplate: true });
                                  sel.selectedIndex = 0;
                                  if (suffixInput) suffixInput.value = '';
                                }}
                              >
                                <option value="">Use ref…</option>
                                {Object.keys(vars ?? {}).length > 0 && (
                                  <optgroup label="Vars">
                                    {Object.keys(vars ?? {}).map(k => <option key={`vars:${k}`} value={`vars:${k}`}>{k}</option>)}
                                  </optgroup>
                                )}
                                {otherNodes.length > 0 && (
                                  <optgroup label="Node outputs">
                                    {otherNodes.map(n => <option key={`node:${n.outputKey ?? n.id}`} value={`node:${n.outputKey ?? n.id}`}>{n.name ?? n.id}</option>)}
                                  </optgroup>
                                )}
                              </select>
                              <input defaultValue={initialSuffix} placeholder="append .path or [0].key" style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text, width: 120 }} onBlur={(e) => {
                                const raw = (e.target as HTMLInputElement).value || '';
                                const suffix = raw.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '').trim();
                                const parts = extractTemplateParts(f.value);
                                if (!parts.pick) return;
                                if (parts.pick.startsWith('vars:')) updateField(i, { value: `{{vars.${parts.pick.slice(5)}${suffix ? '.' + suffix : ''}}}`, isTemplate: true });
                                else if (parts.pick.startsWith('node:')) updateField(i, { value: `{{${parts.pick.slice(5)}.output${suffix ? '.' + suffix : ''}}}`, isTemplate: true });
                                else updateField(i, { value: `{{${parts.pick}${suffix ? '.' + suffix : ''}}}`, isTemplate: true });
                              }} />
                            </div>
                          </div>
                          <button onClick={() => removeField(i)} style={{ ...btnSm(C), color: C.red }}>✕</button>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={addField} style={{ padding: "6px 10px", borderRadius: 6, background: "transparent", border: `1px dashed ${C.surface2}` }}>+ Add Field</button>
                      <button onClick={() => { setToolFields([]); set("toolInput", {}); }} style={{ ...btnSm(C) }}>Clear</button>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <TemplateTip C={C} nodes={otherNodes} />
                    </div>
                  </div>
                ) : (
                  <div>
                    <textarea
                      ref={rawJsonRef}
                      style={{ ...textareaStyle, minHeight: 120, fontFamily: "monospace" }}
                      value={rawToolJson}
                      placeholder={'{\n  "query": "{{input.query}}"\n}'}
                      onChange={e => onRawJsonChange(e.target.value)}
                      onFocus={() => { isJsonFocused.current = true; }}
                      onBlur={() => { isJsonFocused.current = false; tryParseRawJson(); }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <button onClick={() => tryParseRawJson()} style={{ ...btnSm(C) }}>Parse</button>
                      <button onClick={() => { setRawToolJson(JSON.stringify(node.toolInput ?? {}, null, 2)); }} style={{ ...btnSm(C) }}>Reset</button>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <select style={{ ...btnSm(C) }} onChange={(e) => {
                          const sel = e.target as HTMLSelectElement;
                          const v = sel.value; if (!v) return;
                          const container = sel.parentElement as HTMLElement | null;
                          let suffixInput: HTMLInputElement | null = null;
                          if (container) {
                            const inputs = container.querySelectorAll('input');
                            if (inputs && inputs.length > 0) suffixInput = inputs[inputs.length - 1] as HTMLInputElement;
                          }
                          let suffix = suffixInput?.value?.trim() ?? '';
                          suffix = suffix.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
                          let tpl = '';
                          if (v.startsWith('vars:')) tpl = `{{vars.${v.slice(5)}${suffix ? '.' + suffix : ''}}}`;
                          else if (v.startsWith('node:')) tpl = `{{${v.slice(5)}.output${suffix ? '.' + suffix : ''}}}`;
                          else tpl = `{{${v}${suffix ? '.' + suffix : ''}}}`;
                          insertRefIntoRawJson(tpl);
                          sel.value = '';
                          if (suffixInput) suffixInput.value = '';
                        }}>
                          <option value="">Insert ref…</option>
                          {Object.keys(vars ?? {}).length > 0 && (
                            <optgroup label="Vars">
                              {Object.keys(vars ?? {}).map(k => <option key={`vars:${k}`} value={`vars:${k}`}>{k}</option>)}
                            </optgroup>
                          )}
                          {otherNodes.length > 0 && (
                            <optgroup label="Node outputs">
                              {otherNodes.map(n => <option key={`node:${n.outputKey ?? n.id}`} value={`node:${n.outputKey ?? n.id}`}>{n.name ?? n.id}</option>)}
                            </optgroup>
                          )}
                        </select>
                        <input placeholder="append .path or [0].key" style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text, width: 160 }} />
                      </div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <TemplateTip C={C} nodes={otherNodes} />
                    </div>
                  </div>
                )
              )}
            </div>
          </>
        )}

        {/* ---- Trigger fields ---- */}
        {node.type === "trigger" && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Target Type</label>
              <select style={selectStyle} value={node.targetType ?? "graph"} onChange={e => set("targetType", e.target.value as any)}>
                <option value="graph">Graph</option>
                <option value="agent">Agent</option>
              </select>
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>{(node.targetType === "agent") ? "Agent Target" : "Graph Target"}</label>
              {node.targetType === "agent" ? (
                <select style={selectStyle} value={node.targetId ?? ""} onChange={e => set("targetId", e.target.value || undefined)}>
                  <option value="">— select agent —</option>
                  {agents.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              ) : (
                <select style={selectStyle} value={node.targetId ?? ""} onChange={e => set("targetId", e.target.value || undefined)}>
                  <option value="">— select graph —</option>
                  {graphs.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
              <div style={{ fontSize: "0.68rem", color: C.overlay0, marginTop: 6 }}>You can also enter an id manually below.</div>
              <input style={{ ...inputStyle, marginTop: 6 }} value={node.targetId ?? ""} onChange={e => set("targetId", e.target.value || undefined)} />
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Await Result?</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={!!node.awaitResult} onChange={e => set("awaitResult", e.target.checked)} />
                <span style={{ color: C.overlay0, fontSize: "0.8rem" }}>When checked, wait synchronously for child run to finish (prefer async for cycles)</span>
              </div>
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Trigger Input (JSON)</label>
              <textarea style={{ ...textareaStyle, minHeight: 80 }} value={typeof node.triggerInput === "string" ? node.triggerInput : JSON.stringify(node.triggerInput ?? {}, null, 2)} onChange={e => {
                try { set("triggerInput", JSON.parse(e.target.value) as any); } catch { set("triggerInput", e.target.value as any); }
              }} />
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Timeout (ms)</label>
              <input style={inputStyle} type="number" min={0} value={node.timeoutMs ?? ""} placeholder="Optional" onChange={e => set("timeoutMs", e.target.value ? Number(e.target.value) : undefined)} />
            </div>
          </>
        )}

        {/* ---- Condition fields ---- */}
        {node.type === "condition" && (
          <ConditionEditor node={node} otherNodes={otherNodes} onChange={onChange} C={C} inputStyle={inputStyle} selectStyle={selectStyle} labelStyle={labelStyle} vars={vars} />
        )}

        {/* ---- Operation fields ---- */}
        {node.type === "operation" && (
          <div style={sectionStyle}>
            <label style={labelStyle}>Operation</label>
            <select style={selectStyle}
              value={node.operationAction?.op ?? "inc"}
              onChange={e => {
                const prev: OperationActionInfo = node.operationAction ?? { op: "inc", varName: "" };
                set("operationAction", { ...prev, op: e.target.value as OperationActionInfo["op"] });
              }}>
              <option value="inc">inc — increment a number</option>
              <option value="dec">dec — decrement a number</option>
              <option value="set">set — assign a value</option>
              <option value="copy">copy — copy from a node ref</option>
              <option value="toggle">toggle — flip a boolean</option>
              <option value="append">append — push to an array</option>
            </select>
            <label style={{ ...labelStyle, marginTop: 8 }}>Variable Name</label>
            <input style={inputStyle}
              value={node.operationAction?.varName ?? ""}
              placeholder="e.g. page"
              onChange={e => {
                const prev: OperationActionInfo = node.operationAction ?? { op: "inc", varName: "" };
                set("operationAction", { ...prev, varName: e.target.value });
              }} />
            <div style={{ fontSize: "0.65rem", color: C.overlay0, marginTop: 2 }}>
              Accessed as <code style={{ color: C.teal }}>{"{{vars.name}}"}</code> in templates and conditions.
            </div>
            {["inc", "dec"].includes(node.operationAction?.op ?? "inc") && (
              <>
                <label style={{ ...labelStyle, marginTop: 8 }}>Amount</label>
                <input style={inputStyle} type="number"
                  value={node.operationAction?.amount ?? 1}
                  onChange={e => {
                    const prev: OperationActionInfo = node.operationAction ?? { op: "inc", varName: "" };
                    set("operationAction", { ...prev, amount: Number(e.target.value) });
                  }} />
              </>
            )}
            {node.operationAction?.op === "set" && (
              <>
                <label style={{ ...labelStyle, marginTop: 8 }}>Value (JSON or string)</label>
                <input style={inputStyle}
                  value={node.operationAction?.value !== undefined ? String(node.operationAction.value) : ""}
                  placeholder='e.g. 1 or "hello" or true'
                  onChange={e => {
                    const prev: OperationActionInfo = node.operationAction ?? { op: "set", varName: "" };
                    let v: unknown = e.target.value;
                    try { v = JSON.parse(e.target.value); } catch {}
                    set("operationAction", { ...prev, value: v });
                  }} />
              </>
            )}
            {node.operationAction?.op === "copy" && (
              <>
                <label style={{ ...labelStyle, marginTop: 8 }}>Source Ref</label>
                <input style={inputStyle}
                  value={node.operationAction?.fromRef ?? ""}
                  placeholder="e.g. toolNode.output.nextPage"
                  onChange={e => {
                    const prev: OperationActionInfo = node.operationAction ?? { op: "copy", varName: "" };
                    set("operationAction", { ...prev, fromRef: e.target.value });
                  }} />
              </>
            )}
            {node.operationAction?.op === "append" && (
              <>
                <label style={{ ...labelStyle, marginTop: 8 }}>Value to Append (JSON)</label>
                <input style={inputStyle}
                  value={node.operationAction?.value !== undefined ? String(node.operationAction.value) : ""}
                  placeholder={'e.g. "item" or 42'}
                  onChange={e => {
                    const prev: OperationActionInfo = node.operationAction ?? { op: "append", varName: "" };
                    let v: unknown = e.target.value;
                    try { v = JSON.parse(e.target.value); } catch {}
                    set("operationAction", { ...prev, value: v });
                  }} />
              </>
            )}
            <div style={{ marginTop: 8 }}>
              <button onClick={() => onOpenVars?.()} style={{ ...btnSm(C), background: "transparent" }}>Edit Vars</button>
            </div>
          </div>
        )}

        {/* ---- Catch fields ---- */}
        {node.type === "catch" && (
          <div style={sectionStyle}>
            <label style={labelStyle}>Catch Triggers</label>
            <div style={{ fontSize: "0.7rem", color: C.overlay0, marginBottom: 8, lineHeight: 1.5 }}>
              <strong style={{ color: C.text }}>No input edge required.</strong>{" "}
              This node is triggered automatically by the runtime when a loop in this graph
              exits for a selected reason — you do not need to connect anything to it.
              Wire outgoing edges to cleanup, notification, or output nodes.
              Its output is <code style={{ color: C.teal }}>{"{ exitReason, vars }"}</code> — reference
              it as <code style={{ color: C.teal }}>{`{{${node.id}.output.exitReason}}`}</code> downstream.
            </div>
            {(["maxIterations", "error", "abort"] as CatchTrigger[]).map(trigger => {
              const checked = node.catchTriggers?.includes(trigger) ?? false;
              const labels: Record<CatchTrigger, string> = {
                maxIterations: "Max iterations — loop ran out of allowed iterations",
                error: "Error — a node inside the loop halted with an unhandled error",
                abort: "Abort — the run was cancelled",
              };
              return (
                <label key={trigger} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    style={{ marginTop: 3, cursor: "pointer" }}
                    onChange={e => {
                      const current = node.catchTriggers ?? [];
                      const next: CatchTrigger[] = e.target.checked
                        ? [...current, trigger]
                        : current.filter(t => t !== trigger);
                      set("catchTriggers", next);
                    }}
                  />
                  <span style={{ fontSize: "0.78rem", color: C.text, lineHeight: 1.4 }}>{labels[trigger]}</span>
                </label>
              );
            })}
            {!node.catchTriggers?.length && (
              <div style={{ fontSize: "0.7rem", color: C.red, marginTop: 4 }}>
                Select at least one trigger above.
              </div>
            )}
          </div>
        )}

        {/* ---- Input/Output fields ---- */}
        {node.type === "input" && (
          <div style={sectionStyle}>
            <div style={{ fontSize: "0.75rem", color: C.subtext0, lineHeight: 1.5 }}>
              This is the graph entry point. Provide input variables when running the graph.
              Reference them downstream as <code style={{ color: C.teal }}>{"{{input.yourKey}}"}</code>.
            </div>
          </div>
        )}
        {node.type === "output" && (
          <div style={sectionStyle}>
            <label style={labelStyle}>Result Template</label>
            <textarea style={textareaStyle}
              value={node.promptTemplate ?? ""}
              placeholder={"{{nodeId.output}}"}
              onChange={e => set("promptTemplate", e.target.value || undefined)}
            />
            <div style={{ fontSize: "0.65rem", color: C.overlay0, marginTop: 3 }}>
              Optional — if blank, the last node's output is collected automatically.
            </div>
          </div>
        )}

        {/* ---- Error Policy ---- */}
        {node.type !== "input" && node.type !== "output" && node.type !== "catch" && (
          <div style={{ borderTop: `1px solid ${C.surface1}`, paddingTop: 12, marginTop: 4 }}>
            <div style={{ ...labelStyle, marginBottom: 6, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Error Policy</div>
            <div style={sectionStyle}>
              <select style={selectStyle}
                value={errorPolicy?.type ?? "halt"}
                onChange={e => setEP("type", e.target.value)}
              >
                {ERROR_POLICY_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {(errorPolicy?.type === "retry") && (
              <>
                <div style={sectionStyle}>
                  <label style={labelStyle}>Max Retries</label>
                  <input style={inputStyle} type="number" min={1} max={10}
                    value={errorPolicy.maxRetries ?? 3}
                    onChange={e => setEP("maxRetries", parseInt(e.target.value))}
                  />
                </div>
                <div style={sectionStyle}>
                  <label style={labelStyle}>Retry Delay (ms)</label>
                  <input style={inputStyle} type="number" min={0} step={500}
                    value={errorPolicy.retryDelayMs ?? 1000}
                    onChange={e => setEP("retryDelayMs", parseInt(e.target.value))}
                  />
                </div>
              </>
            )}
            {(errorPolicy?.type === "fallback" || errorPolicy?.type === "skip") && (
              <div style={sectionStyle}>
                <label style={labelStyle}>Fallback Value</label>
                <input style={inputStyle} value={String(errorPolicy?.fallbackValue ?? "")}
                  placeholder="Optional static fallback"
                  onChange={e => setEP("fallbackValue", e.target.value || undefined)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Condition branch editor ----

function ConditionEditor({ node, otherNodes, onChange, C, inputStyle, selectStyle, labelStyle, vars }: {
  node: GraphNodeInfo;
  otherNodes: GraphNodeInfo[];
  onChange(n: GraphNodeInfo): void;
  C: ThemePalette;
  inputStyle: React.CSSProperties;
  selectStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  vars?: Record<string, unknown>;
}) {
  const branches = node.branches ?? [];
  const [open, setOpen] = useState<number | null>(0);

  const update = (i: number, patch: Partial<typeof branches[0]>) => {
    const next = branches.map((b, idx) => idx === i ? { ...b, ...patch } : b);
    onChange({ ...node, branches: next });
  };

  const updateCond = (i: number, condPatch: Record<string, unknown>) => {
    const cur = branches[i]?.condition ?? {};
    update(i, { condition: { ...cur, ...condPatch } as any });
  };

  const addBranch = () => {
    onChange({
      ...node,
      branches: [...branches, { label: `Branch ${branches.length + 1}`, condition: { ref: "", operator: "exists" }, target: "" }],
    });
    setOpen(branches.length);
  };

  const removeBranch = (i: number) => {
    const next = branches.filter((_, idx) => idx !== i);
    onChange({ ...node, branches: next });
    if (open === i) setOpen(null);
  };

  return (
    <div>
      {branches.map((b, i) => (
        <div key={i} style={{ marginBottom: 8, border: `1px solid ${C.surface1}`, borderRadius: 8, overflow: "hidden" }}>
          {/* branch header */}
          <div
            style={{
              display: "flex", alignItems: "center", padding: "6px 10px",
              background: C.surface1, cursor: "pointer", gap: 8,
            }}
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span style={{ flex: 1, fontSize: "0.75rem", fontWeight: 600 }}>{b.label || `Branch ${i + 1}`}</span>
            <button
              onClick={(e) => { e.stopPropagation(); removeBranch(i); }}
              style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: "0.8rem" }}
            >✕</button>
            <span style={{ color: C.overlay0, fontSize: "0.75rem" }}>{open === i ? "â–²" : "â–¼"}</span>
          </div>

          {open === i && (
            <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <label style={labelStyle}>Branch Label</label>
                <input style={inputStyle} value={b.label} onChange={e => update(i, { label: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Condition Ref</label>
                <input style={inputStyle} value={b.condition?.ref ?? ""} placeholder="e.g. prevNode.output.status"
                  onChange={e => updateCond(i, { ref: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Operator</label>
                <select style={selectStyle} value={b.condition?.operator ?? "exists"} onChange={e => updateCond(i, { operator: e.target.value })}>
                  {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {!NO_VALUE_OPS.includes(b.condition?.operator ?? "") && (
                <div>
                  <label style={labelStyle}>Comparison Value</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {/* Display current value as JSON when non-string, else raw string */}
                    <input
                      style={inputStyle}
                      value={(() => {
                        const v = b.condition?.value;
                        if (v === undefined || v === null) return "";
                        if (typeof v === "string") return v;
                        try { return JSON.stringify(v); } catch { return String(v); }
                      })()}
                      placeholder="Value to compare"
                      onChange={e => {
                        const raw = e.target.value;
                        const mode = (b.condition?.valueType as string) ?? "auto";
                        const parseByMode = (s: string, m: string): unknown => {
                          const t = String(s).trim();
                          if (t === "") return undefined;
                          // Preserve var templates verbatim
                          if (/^\s*\{\{[^}]+\}\}\s*$/.test(s)) return s;
                          try {
                            switch (m) {
                              case "string":
                                return s;
                              case "number": {
                                const n = Number(t);
                                return isNaN(n) ? s : n;
                              }
                              case "boolean":
                                if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
                                return s;
                              case "json":
                                return JSON.parse(s);
                              case "auto":
                              default:
                                try { return JSON.parse(t); } catch { return s; }
                            }
                          } catch {
                            return s;
                          }
                        };
                        const parsed = parseByMode(raw, mode);
                        updateCond(i, { value: parsed });
                      }}
                    />

                    <select
                      value={(b.condition?.valueType as string) ?? "auto"}
                      onChange={e => {
                        const vt = e.target.value as "auto" | "string" | "number" | "boolean" | "json";
                        const cur = b.condition?.value;
                        const curRaw = ((): string => {
                          if (cur === undefined || cur === null) return "";
                          if (typeof cur === "string") return cur;
                          try { return JSON.stringify(cur); } catch { return String(cur); }
                        })();
                        const parseByMode = (s: string, m: string): unknown => {
                          const t = String(s).trim();
                          if (t === "") return undefined;
                          if (/^\s*\{\{[^}]+\}\}\s*$/.test(s)) return s;
                          try {
                            switch (m) {
                              case "string":
                                return s;
                              case "number": {
                                const n = Number(t);
                                return isNaN(n) ? s : n;
                              }
                              case "boolean":
                                if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
                                return s;
                              case "json":
                                return JSON.parse(s);
                              case "auto":
                              default:
                                try { return JSON.parse(t); } catch { return s; }
                            }
                          } catch {
                            return s;
                          }
                        };
                        const parsed = parseByMode(curRaw, vt);
                        updateCond(i, { value: parsed, valueType: vt });
                      }}
                      style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }}
                    >
                      <option value="auto">Auto</option>
                      <option value="string">String</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="json">JSON</option>
                    </select>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text }} onChange={e => {
                        const sel = e.target as HTMLSelectElement;
                        const v = sel.value; if (!v) return;
                        const container = sel.parentElement as HTMLElement | null;
                        let suffixInput: HTMLInputElement | null = null;
                        if (container) {
                          const inputs = container.querySelectorAll('input');
                          if (inputs && inputs.length > 0) suffixInput = inputs[inputs.length - 1] as HTMLInputElement;
                        }
                        let suffix = suffixInput?.value?.trim() ?? '';
                        suffix = suffix.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
                        let tpl = '';
                        if (v.startsWith('vars:')) tpl = `{{vars.${v.slice(5)}${suffix ? '.' + suffix : ''}}}`;
                        else if (v.startsWith('node:')) tpl = `{{${v.slice(5)}.output${suffix ? '.' + suffix : ''}}}`;
                        else tpl = `{{${v}${suffix ? '.' + suffix : ''}}}`;
                        updateCond(i, { value: tpl, valueType: 'auto' });
                        sel.value = '';
                        if (suffixInput) suffixInput.value = '';
                      }}>
                        <option value="">Use ref…</option>
                        {Object.keys(vars ?? {}).length > 0 && (
                          <optgroup label="Vars">
                            {Object.keys(vars ?? {}).map(k => <option key={`vars:${k}`} value={`vars:${k}`}>{k}</option>)}
                          </optgroup>
                        )}
                        {otherNodes.length > 0 && (
                          <optgroup label="Node outputs">
                            {otherNodes.map(n => <option key={`node:${n.outputKey ?? n.id}`} value={`node:${n.outputKey ?? n.id}`}>{n.name ?? n.id}</option>)}
                          </optgroup>
                        )}
                      </select>
                      <input defaultValue={dotToBracket(extractTemplateParts(b.condition?.value).suffix ?? "")} placeholder="append .path or [0].key" style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.surface2}`, background: C.mantle, color: C.text, width: 140 }} onBlur={(e) => {
                        const raw = (e.target as HTMLInputElement).value || '';
                        const suffix = raw.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '').trim();
                        const parts = extractTemplateParts(b.condition?.value);
                        if (!parts.pick) return;
                        let tpl = '';
                        if (parts.pick.startsWith('vars:')) tpl = `{{vars.${parts.pick.slice(5)}${suffix ? '.' + suffix : ''}}}`;
                        else if (parts.pick.startsWith('node:')) tpl = `{{${parts.pick.slice(5)}.output${suffix ? '.' + suffix : ''}}}`;
                        else tpl = `{{${parts.pick}${suffix ? '.' + suffix : ''}}}`;
                        updateCond(i, { value: tpl, valueType: 'auto' });
                      }} />
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label style={labelStyle}>Target Node</label>
                <select style={selectStyle} value={b.target ?? ""} onChange={e => update(i, { target: e.target.value })}>
                  <option value="">— connect on canvas —</option>
                  {otherNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
      ))}

      <button onClick={addBranch} style={{
        width: "100%", padding: "7px 0", background: "transparent",
        border: `1px dashed ${C.surface2}`, borderRadius: 6,
        color: C.subtext0, cursor: "pointer", fontSize: "0.78rem", marginBottom: 10,
      }}>
        + Add Branch
      </button>

      {/* Default target */}
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Default Target (no branch matched)</label>
        <select style={selectStyle} value={node.defaultTarget ?? ""} onChange={e => onChange({ ...node, defaultTarget: e.target.value || undefined })}>
          <option value="">None (halt on no match)</option>
          {otherNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </div>
    </div>
  );
}

// ---- Template hint ----

function TemplateTip({ C, nodes }: { C: ThemePalette; nodes: GraphNodeInfo[] }) {
  return (
    <div style={{ fontSize: "0.65rem", color: C.overlay0, marginTop: 4, lineHeight: 1.5 }}>
      Use <code style={{ color: C.teal }}>{"{{input.key}}"}</code> for graph input,
      {" "}<code style={{ color: C.teal }}>{"{{vars.name}}"}</code> for loop variables
      {nodes.length > 0 && <>, <code style={{ color: C.teal }}>{"{{nodeId.output}}"}</code> for prior nodes</>}
    </div>
  );
}

// ---- Tiny button style helper ----

function btnSm(C: ThemePalette): React.CSSProperties {
  return {
    background: "none", border: "none", cursor: "pointer",
    fontSize: "0.85rem", padding: "2px 5px", borderRadius: 4,
    color: C.overlay0, lineHeight: 1,
  };
}
