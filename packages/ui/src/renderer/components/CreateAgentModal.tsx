import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface SkillInfo {
  frontmatter: { name: string; contributor: string; description: string };
}
interface ToolInfo {
  name: string;
  contributor: string;
  description: string;
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

// ── Tiny helpers ─────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "#1e1e2e",
  color: "#cdd6f4",
  borderRadius: 10,
  padding: "2rem",
  width: 640,
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  display: "flex",
  flexDirection: "column",
  gap: "1.25rem",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#a6adc8",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 6,
  border: "1px solid #45475a",
  background: "#181825",
  color: "#cdd6f4",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  borderBottom: "1px solid #313244",
  paddingBottom: 6,
  marginBottom: 4,
};

function CheckList({
  items,
  selected,
  onChange,
  keyOf,
  labelOf,
  descOf,
}: {
  items: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  keyOf: (i: string) => string;
  labelOf: (i: string) => string;
  descOf: (i: string) => string;
}) {
  const toggle = (k: string) => {
    onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  };
  if (items.length === 0) return <p style={{ color: "#585b70", fontSize: 13, margin: 0 }}>None installed.</p>;
  const allKeys = items.map(keyOf);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.includes(k));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
      {/* Select-all row */}
      <label style={{
        display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
        padding: "5px 8px", borderRadius: 6,
        background: allSelected ? "rgba(203,166,247,0.08)" : "transparent",
        borderBottom: "1px solid #313244", marginBottom: 2,
      }}>
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onChange(allSelected ? [] : allKeys)}
          style={{ accentColor: "#cba6f7", width: 13, height: 13 }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, color: allSelected ? "#cba6f7" : "#a6adc8" }}>
          {allSelected ? "Deselect all" : "Select all"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#585b70" }}>{selected.length} / {items.length}</span>
      </label>
      {items.map((item) => {
        const k = keyOf(item);
        const checked = selected.includes(k);
        return (
          <label
            key={k}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
              padding: "6px 8px",
              borderRadius: 6,
              background: checked ? "#313244" : "transparent",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(k)}
              style={{ marginTop: 2, accentColor: "#cba6f7" }}
            />
            <span>
              <strong style={{ fontSize: 13 }}>{labelOf(item)}</strong>
              {descOf(item) && (
                <span style={{ marginLeft: 6, fontSize: 12, color: "#7f849c" }}>{descOf(item)}</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ── Main modal ───────────────────────────────────────────────────────────────

export function CreateAgentModal({ onClose, onCreated }: Props): React.JSX.Element {
  const navigate = useNavigate();

  // Form state
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState<string>("");
  const [maxTokens, setMaxTokens] = useState<string>("");
  const [soul, setSoul] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  // Options
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<import("../global.js").ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.solixApi) return;
    window.solixApi.listProviders().then((ps) => setProviders(ps.map((p) => p.id))).catch(console.error);
    window.solixApi.listSkills().then(setSkills).catch(console.error);
    window.solixApi.listTools().then(setTools).catch(console.error);
  }, []);

  // Fetch models whenever the selected provider changes
  useEffect(() => {
    if (!window.solixApi) return;
    setModels([]);
    if (!provider) return;
    setModelsLoading(true);
    window.solixApi
      .listProviderModels(provider)
      .then((ms) => setModels(ms))
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, [provider]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Agent name is required."); return; }
    if (!window.solixApi) { setError("API unavailable."); return; }
    setBusy(true);
    setError("");
    try {
      // 1. Create the agent directory + default config
      await window.solixApi.createAgent(trimmedName);

      // 2. Persist extended config
      const cfg: Record<string, unknown> = { name: trimmedName };
      if (provider)                   cfg.provider    = provider;
      if (model.trim())               cfg.model       = model.trim();
      if (temperature !== "")         cfg.temperature = parseFloat(temperature);
      if (maxTokens !== "")           cfg.maxTokens   = parseInt(maxTokens, 10);
      if (selectedSkills.length > 0)  cfg.skills      = selectedSkills;
      if (selectedTools.length > 0)   cfg.tools       = selectedTools;
      await window.solixApi.writeAgentConfig(trimmedName, cfg);

      // 3. Persist soul.md if the user typed anything
      if (soul.trim()) {
        await window.solixApi.writeSoul(trimmedName, soul);
      }

      onCreated();
      navigate(`/agents/${encodeURIComponent(trimmedName)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Create New Agent</h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#cdd6f4", fontSize: 20, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* ── Identity ──────────────────────────────────────────────── */}
        <div>
          <p style={sectionHeadStyle}>Identity</p>
          <div style={fieldStyle}>
            <label style={labelStyle}>Name *</label>
            <input
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-agent"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoFocus
            />
          </div>
        </div>

        {/* ── Model ─────────────────────────────────────────────────── */}
        <div>
          <p style={sectionHeadStyle}>Model</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Provider</label>
              <select
                style={{ ...inputStyle, appearance: "auto" }}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="">— inherit default —</option>
                {providers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>
                Model ID{modelsLoading && <span style={{ marginLeft: 6, fontSize: 11, color: "#7f849c", fontWeight: 400 }}>loading…</span>}
              </label>
              <input
                style={inputStyle}
                list="model-options"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={models.length > 0 ? `${models.length} models available…` : "gpt-4o / claude-3-5-sonnet …"}
              />
              {models.length > 0 && (
                <datalist id="model-options">
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.description ?? m.id}
                    </option>
                  ))}
                </datalist>
              )}
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Temperature</label>
              <input
                style={inputStyle}
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="0.7"
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Max Tokens</label>
              <input
                style={inputStyle}
                type="number"
                min={1}
                step={1}
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="4096"
              />
            </div>
          </div>
        </div>

        {/* ── Skills ────────────────────────────────────────────────── */}
        <div>
          <p style={sectionHeadStyle}>Skills</p>
          <CheckList
            items={skills as unknown as string[]}
            selected={selectedSkills}
            onChange={setSelectedSkills}
            keyOf={(i) => {
              const s = i as unknown as SkillInfo;
              return `${s.frontmatter.contributor}/${s.frontmatter.name}`;
            }}
            labelOf={(i) => {
              const s = i as unknown as SkillInfo;
              return `${s.frontmatter.contributor}/${s.frontmatter.name}`;
            }}
            descOf={(i) => (i as unknown as SkillInfo).frontmatter.description ?? ""}
          />
        </div>

        {/* ── Tools ─────────────────────────────────────────────────── */}
        <div>
          <p style={sectionHeadStyle}>Tools</p>
          <CheckList
            items={tools as unknown as string[]}
            selected={selectedTools}
            onChange={setSelectedTools}
            keyOf={(i) => {
              const t = i as unknown as ToolInfo;
              return `${t.contributor}/${t.name}`;
            }}
            labelOf={(i) => {
              const t = i as unknown as ToolInfo;
              return `${t.contributor}/${t.name}`;
            }}
            descOf={(i) => (i as unknown as ToolInfo).description ?? ""}
          />
        </div>

        {/* ── Soul.md ───────────────────────────────────────────────── */}
        <div>
          <p style={sectionHeadStyle}>Soul.md</p>
          <p style={{ fontSize: 12, color: "#7f849c", margin: "0 0 6px" }}>
            Optional system persona for this agent. Supports Markdown / plain text.
          </p>
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: 100, fontFamily: "monospace", fontSize: 13 }}
            value={soul}
            onChange={(e) => setSoul(e.target.value)}
            placeholder="You are a helpful assistant specialized in…"
          />
        </div>

        {/* ── Error / Actions ───────────────────────────────────────── */}
        {error && (
          <div style={{ color: "#f38ba8", background: "#2a1727", borderRadius: 6, padding: "8px 12px", fontSize: 14 }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 20px", borderRadius: 6, border: "1px solid #45475a", background: "transparent", color: "#cdd6f4", cursor: "pointer", fontSize: 14 }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: "#cba6f7", color: "#1e1e2e", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", fontSize: 14, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Creating…" : "Create Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
