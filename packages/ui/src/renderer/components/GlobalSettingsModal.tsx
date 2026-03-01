import React, { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext.js";
import { ThemeSettingsTab } from "./ThemeSettingsTab.js";

interface Props {
  onClose: () => void;
}

type ModelInfo = { id: string; contextWindow?: number; maxOutputTokens?: number; description?: string };

// ── Tabs ─────────────────────────────────────────────────────────────────────
type Tab = "providers" | "inference" | "engine" | "themes" | "about";
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "providers", icon: "🔑", label: "Providers" },
  { id: "inference", icon: "🧠", label: "Inference" },
  { id: "engine",    icon: "⚡", label: "Engine" },
  { id: "themes",    icon: "🎨", label: "Themes" },
  { id: "about",     icon: "ℹ️", label: "About" },
];

export function GlobalSettingsModal({ onClose }: Props): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>("providers");
  const { palette: C } = useTheme();

  // ── Styles (derived from theme) ────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    background: C.surface0, border: `1px solid ${C.surface1}`,
    borderRadius: 6, padding: "7px 10px", color: C.text,
    fontSize: 13, outline: "none", fontFamily: "inherit",
    width: "100%", boxSizing: "border-box",
  };
  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer", appearance: "auto" as any };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.subtext0,
    marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em",
    display: "block",
  };
  const sectionStyle: React.CSSProperties = {
    background: C.mantle, borderRadius: 10, padding: "16px 18px",
    display: "flex", flexDirection: "column", gap: 16,
  };

  // ── Global config state ──────────────────────────────────────────────
  const [config, setConfig] = useState<Record<string, any>>({});
  const [providers, setProviders] = useState<Array<{ id: string }>>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Inference
  const [defaultProvider, setDefaultProvider] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("4096");

  // Provider editing
  const [editProvider, setEditProvider] = useState("");
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});

  // Engine
  const [webhookPort, setWebhookPort] = useState("7433");
  const [engineRunning, setEngineRunning] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);

  // UI state
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.solixApi) return;

    window.solixApi.readConfig().then((cfg) => {
      const c = (cfg || {}) as Record<string, any>;
      setConfig(c);
      setDefaultProvider(c.defaultProvider ?? "");
      setDefaultModel(c.defaultModel ?? "");
      setTemperature(String(c.temperature ?? "0.7"));
      setMaxTokens(String(c.maxTokens ?? "4096"));
      setWebhookPort(String(c.webhookPort ?? "7433"));
    }).catch(console.error);

    window.solixApi.listProviders().then((ps) => {
      setProviders(ps);
      if (ps.length && !editProvider) setEditProvider(ps[0].id);
    }).catch(console.error);

    window.solixApi.triggersEngineStatus?.().then((s) => {
      setEngineRunning(s?.running ?? false);
    }).catch(() => {});
  }, []);

  // Reload models when default provider changes.
  useEffect(() => {
    if (!window.solixApi || !defaultProvider) return;
    window.solixApi.listProviderModels(defaultProvider)
      .then((m) => setModels(m || []))
      .catch(() => setModels([]));
  }, [defaultProvider]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Helpers ──────────────────────────────────────────────────────────
  const updateProviderSetting = (provId: string, key: string, value: string) => {
    const next = { ...config };
    next.providers = { ...(next.providers || {}) };
    next.providers[provId] = { ...(next.providers[provId] || {}) };
    next.providers[provId][key] = value;
    setConfig(next);
  };

  const getProviderSetting = (provId: string, key: string): string =>
    (config?.providers?.[provId]?.[key] as string) ?? "";

  const handleSave = async () => {
    if (!window.solixApi) return;
    setSaving(true);
    try {
      const next = { ...config };
      next.defaultProvider = defaultProvider;
      next.defaultModel = defaultModel;
      const parsedTemp = parseFloat(temperature);
      const parsedMax = parseInt(maxTokens, 10);
      if (!isNaN(parsedTemp)) next.temperature = parsedTemp;
      if (!isNaN(parsedMax)) next.maxTokens = parsedMax;
      next.webhookPort = parseInt(webhookPort, 10) || 7433;
      setConfig(next);
      await window.solixApi.writeConfig(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(17,17,27,0.85)",
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Slide-in panel */}
      <div style={{
        width: "min(720px, 100vw)",
        background: C.base, color: C.text,
        display: "flex", flexDirection: "column",
        borderLeft: `1px solid ${C.surface0}`,
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 24px", borderBottom: `1px solid ${C.surface0}`,
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
          background: C.mantle,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "rgba(203,166,247,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, flexShrink: 0,
          }}>⚙️</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Global Settings</div>
            <div style={{ fontSize: 11, color: C.subtext0, marginTop: 1 }}>SolixAI Configuration</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: C.overlay0,
              fontSize: 20, cursor: "pointer", padding: "4px 8px", borderRadius: 6,
              lineHeight: 1,
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: 0, borderBottom: `1px solid ${C.surface0}`,
          background: C.mantle, flexShrink: 0, padding: "0 16px",
        }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: "none", border: "none",
                  borderBottom: isActive ? `2px solid ${C.mauve}` : "2px solid transparent",
                  color: isActive ? C.mauve : C.subtext0,
                  padding: "11px 14px 9px", cursor: "pointer",
                  fontSize: 13, fontWeight: isActive ? 700 : 400,
                  display: "flex", alignItems: "center", gap: 6,
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── Providers ── */}
          {activeTab === "providers" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, color: C.text }}>API Keys & Endpoints</h3>
                <p style={{ margin: "0 0 16px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
                  Configure API keys and base URLs for each provider. These are stored locally
                  in <code style={{ color: C.mauve, fontSize: 11 }}>~/.solix/config.json</code>.
                </p>
              </div>

              {/* Provider list */}
              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Registered Providers</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {providers.map((p) => {
                    const isActive = editProvider === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setEditProvider(p.id)}
                        style={{
                          padding: "8px 16px", borderRadius: 8,
                          border: `1.5px solid ${isActive ? C.mauve : C.surface1}`,
                          background: isActive ? "rgba(203,166,247,0.12)" : C.surface0,
                          color: isActive ? C.mauve : C.subtext0,
                          cursor: "pointer", fontSize: 13,
                          fontWeight: isActive ? 700 : 400,
                          transition: "border-color 0.15s, background 0.15s",
                        }}
                      >
                        {p.id}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Provider detail */}
              {editProvider && (
                <div style={sectionStyle}>
                  <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>
                    {editProvider} <span style={{ fontWeight: 400, color: C.subtext0 }}>settings</span>
                  </h4>

                  <div>
                    <label style={labelStyle}>API Key</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={getProviderSetting(editProvider, "apiKey")}
                        onChange={(e) => updateProviderSetting(editProvider, "apiKey", e.target.value)}
                        placeholder="sk-…"
                        type={showApiKey[editProvider] ? "text" : "password"}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((prev) => ({ ...prev, [editProvider]: !prev[editProvider] }))}
                        style={{
                          background: C.surface0, border: `1px solid ${C.surface1}`,
                          borderRadius: 6, padding: "6px 12px", color: C.subtext0,
                          cursor: "pointer", fontSize: 11, whiteSpace: "nowrap",
                        }}
                      >{showApiKey[editProvider] ? "Hide" : "Show"}</button>
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Base URL <span style={{ fontWeight: 400, textTransform: "none" }}>(optional — for proxies or local models)</span></label>
                    <input
                      value={getProviderSetting(editProvider, "baseUrl")}
                      onChange={(e) => updateProviderSetting(editProvider, "baseUrl", e.target.value)}
                      placeholder={editProvider === "openai" ? "https://api.openai.com/v1" : editProvider === "anthropic" ? "https://api.anthropic.com" : "https://…"}
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Inference ── */}
          {activeTab === "inference" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, color: C.text }}>Default Inference Settings</h3>
                <p style={{ margin: "0 0 16px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
                  These defaults apply to all agents unless overridden in an agent's own settings.
                </p>
              </div>

              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Provider & Model</h4>

                <div>
                  <label style={labelStyle}>Default Provider</label>
                  <select
                    value={defaultProvider}
                    onChange={(e) => { setDefaultProvider(e.target.value); setDefaultModel(""); }}
                    style={selectStyle}
                  >
                    <option value="">— select —</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.id}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Default Model</label>
                  <select
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— select —</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.id}</option>
                    ))}
                  </select>
                  {defaultModel && models.length > 0 && (() => {
                    const m = models.find((x) => x.id === defaultModel);
                    if (!m) return null;
                    return (
                      <div style={{ marginTop: 6, fontSize: 11, color: C.overlay0, lineHeight: 1.5 }}>
                        {m.contextWindow && <span>Context: {m.contextWindow.toLocaleString()} tokens</span>}
                        {m.maxOutputTokens && <span style={{ marginLeft: 12 }}>Max output: {m.maxOutputTokens.toLocaleString()}</span>}
                        {m.description && <span style={{ marginLeft: 12 }}>{m.description}</span>}
                      </div>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (defaultProvider && window.solixApi) {
                        window.solixApi.listProviderModels(defaultProvider)
                          .then((m) => setModels(m || []))
                          .catch(console.error);
                      }
                    }}
                    style={{
                      background: C.surface0, border: `1px solid ${C.surface1}`,
                      borderRadius: 6, padding: "7px 14px", color: C.subtext0,
                      cursor: "pointer", fontSize: 12,
                    }}
                  >Refresh Models</button>
                </div>
              </div>

              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Generation Parameters</h4>

                <div>
                  <label style={labelStyle}>
                    Temperature
                    <span style={{ marginLeft: 8, color: C.mauve, fontWeight: 700 }}>{temperature}</span>
                  </label>
                  <p style={{ margin: "0 0 8px", fontSize: 11, color: C.subtext0, lineHeight: 1.4 }}>
                    Controls randomness. Lower values produce more focused output; higher values produce more creative output.
                  </p>
                  <input
                    type="range" min="0" max="2" step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    style={{ width: "100%", accentColor: C.mauve }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.overlay0, marginTop: 4 }}>
                    <span>0 (Deterministic)</span>
                    <span>1.0</span>
                    <span>2.0 (Creative)</span>
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>
                    Max Tokens
                    <span style={{ marginLeft: 8, color: C.mauve, fontWeight: 700 }}>{maxTokens}</span>
                  </label>
                  <p style={{ margin: "0 0 8px", fontSize: 11, color: C.subtext0, lineHeight: 1.4 }}>
                    Maximum number of output tokens per model response.
                  </p>
                  <input
                    type="range" min="256" max="32768" step="256"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    style={{ width: "100%", accentColor: C.mauve }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.overlay0, marginTop: 4 }}>
                    <span>256</span>
                    <span>16k</span>
                    <span>32k</span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="number" min={256} max={131072}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(e.target.value)}
                      style={{ ...inputStyle, width: 120 }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Engine ── */}
          {activeTab === "engine" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, color: C.text }}>Trigger Engine</h3>
                <p style={{ margin: "0 0 16px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
                  The trigger engine runs cron schedules, webhook listeners, and Discord bridges.
                  Start it to activate all enabled triggers.
                </p>
              </div>

              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Engine Status</h4>

                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 16px", borderRadius: 8,
                  background: engineRunning ? "rgba(166,227,161,0.08)" : "rgba(108,112,134,0.08)",
                  border: `1px solid ${engineRunning ? "rgba(166,227,161,0.25)" : C.surface1}`,
                }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: engineRunning ? C.green : C.overlay0,
                    boxShadow: engineRunning ? `0 0 8px ${C.green}` : "none",
                  }} />
                  <span style={{
                    fontSize: 14, fontWeight: 700,
                    color: engineRunning ? C.green : C.subtext0,
                  }}>
                    {engineRunning ? "Running" : "Stopped"}
                  </span>
                  <div style={{ flex: 1 }} />
                  {!engineRunning ? (
                    <button
                      disabled={engineLoading}
                      onClick={async () => {
                        setEngineLoading(true);
                        try {
                          await window.solixApi?.triggersEngineStart?.();
                          setEngineRunning(true);
                        } catch (err) { console.error(err); }
                        finally { setEngineLoading(false); }
                      }}
                      style={{
                        padding: "7px 18px", borderRadius: 7, border: "none",
                        background: C.green, color: C.crust, fontWeight: 700,
                        cursor: engineLoading ? "not-allowed" : "pointer",
                        fontSize: 12, opacity: engineLoading ? 0.5 : 1,
                      }}
                    >{engineLoading ? "Starting…" : "Start Engine"}</button>
                  ) : (
                    <button
                      disabled={engineLoading}
                      onClick={async () => {
                        setEngineLoading(true);
                        try {
                          await window.solixApi?.triggersEngineStop?.();
                          setEngineRunning(false);
                        } catch (err) { console.error(err); }
                        finally { setEngineLoading(false); }
                      }}
                      style={{
                        padding: "7px 18px", borderRadius: 7, border: "none",
                        background: C.red, color: C.crust, fontWeight: 700,
                        cursor: engineLoading ? "not-allowed" : "pointer",
                        fontSize: 12, opacity: engineLoading ? 0.5 : 1,
                      }}
                    >{engineLoading ? "Stopping…" : "Stop Engine"}</button>
                  )}
                </div>
              </div>

              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Webhook Server</h4>
                <div>
                  <label style={labelStyle}>Webhook Port</label>
                  <p style={{ margin: "0 0 8px", fontSize: 11, color: C.subtext0, lineHeight: 1.4 }}>
                    The port the webhook HTTP server listens on. Requires engine restart to take effect.
                  </p>
                  <input
                    value={webhookPort}
                    onChange={(e) => setWebhookPort(e.target.value)}
                    type="number" min={1024} max={65535}
                    style={{ ...inputStyle, width: 120 }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Themes ── */}
          {activeTab === "themes" && <ThemeSettingsTab />}

          {/* ── About ── */}
          {activeTab === "about" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, color: C.text }}>About SolixAI</h3>
                <p style={{ margin: "0 0 16px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
                  SolixAI is a local-first autonomous agent platform.
                </p>
              </div>

              <div style={sectionStyle}>
                <InfoRow label="Version" value="0.1.0" />
                <InfoRow label="Config Path" value="~/.solix/config.json" />
                <InfoRow label="Agents Path" value="~/.solix/agents/" />
                <InfoRow label="Skills Path" value="~/.solix/skills/" />
                <InfoRow label="Tools Path" value="~/.solix/tools/" />
              </div>

              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Raw Configuration</h4>
                <p style={{ margin: 0, fontSize: 11, color: C.subtext0 }}>
                  Current contents of <code style={{ color: C.mauve }}>~/.solix/config.json</code>. Edit fields above and press Save.
                </p>
                <pre style={{
                  background: C.surface0, borderRadius: 8,
                  padding: "12px 14px", fontSize: 12, color: C.subtext1,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  maxHeight: 240, overflow: "auto", margin: 0,
                  border: `1px solid ${C.surface1}`,
                }}>
                  {JSON.stringify(config, null, 2)}
                </pre>
              </div>

              <div style={{
                background: "rgba(243,139,168,0.08)",
                border: `1px solid rgba(243,139,168,0.2)`,
                borderRadius: 10, padding: "14px 16px",
              }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 13, color: C.red }}>⚠ Danger Zone</h4>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
                  Reset all global settings to their defaults. Provider API keys will be cleared.
                </p>
                <button
                  onClick={async () => {
                    if (!confirm("Reset all global settings to defaults? API keys will be cleared.")) return;
                    const defaults = { defaultProvider: "openai", defaultModel: "gpt-4o", temperature: 0.7, maxTokens: 4096 };
                    await window.solixApi?.writeConfig(defaults);
                    setConfig(defaults);
                    setDefaultProvider("openai");
                    setDefaultModel("gpt-4o");
                    setTemperature("0.7");
                    setMaxTokens("4096");
                    setSaved(true);
                    setTimeout(() => setSaved(false), 2500);
                  }}
                  style={{
                    background: "rgba(243,139,168,0.1)", border: `1px solid rgba(243,139,168,0.3)`,
                    color: C.red, padding: "7px 16px", borderRadius: 7, cursor: "pointer",
                    fontSize: 13, fontWeight: 600,
                  }}
                >
                  🗑 Reset to Defaults
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 24px", borderTop: `1px solid ${C.surface0}`,
          background: C.mantle, display: "flex",
          justifyContent: "flex-end", alignItems: "center", gap: 10, flexShrink: 0,
        }}>
          {saved && (
            <span style={{ fontSize: 13, color: C.green, marginRight: "auto" }}>
              ✓ Settings saved
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              padding: "8px 20px", borderRadius: 8, border: `1px solid ${C.surface1}`,
              background: "transparent", color: C.subtext0, cursor: "pointer", fontSize: 13,
            }}
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "8px 24px", borderRadius: 8, border: "none",
              background: C.mauve, color: C.crust, fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer", fontSize: 13,
              opacity: saving ? 0.7 : 1, transition: "opacity 0.15s",
            }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { palette: C } = useTheme();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 12, color: C.subtext0 }}>{label}</span>
      <span style={{ fontSize: 12, color: C.text, fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}
