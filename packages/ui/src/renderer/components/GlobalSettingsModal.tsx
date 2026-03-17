import React, { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext.js";
import { ThemeSettingsTab } from "./ThemeSettingsTab.js";
import { SearchableSelect } from "./SearchableSelect.js";

interface Props {
  onClose: () => void;
}

type ModelInfo = { id: string; contextWindow?: number; maxOutputTokens?: number; description?: string };

// ── Tabs ─────────────────────────────────────────────────────────────────────
type Tab = "providers" | "inference" | "engine" | "discord" | "themes" | "about";
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "providers", icon: "🔑", label: "Providers" },
  { id: "inference", icon: "🧠", label: "Inference" },
  { id: "engine",    icon: "⚡", label: "Engine" },
  { id: "discord",   icon: "💬", label: "Discord" },
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

  // Ensure our chosen model stays valid when provider changes
  useEffect(() => {
    if (!defaultProvider) return;
    // refresh model list when provider flips (models state is managed elsewhere)
    if (models && models.length) {
      if (!defaultModel || !models.some((m) => m.id === defaultModel)) {
        setDefaultModel(models[0].id);
      }
    }
  }, [defaultProvider, models]);
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("4096");

  // Provider editing
  const [editProvider, setEditProvider] = useState("");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});

  // Engine
  const [webhookPort, setWebhookPort] = useState("7433");
  const [engineRunning, setEngineRunning] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);

  // Global Discord
  const [discordBotToken, setDiscordBotToken] = useState("");
  const [discordGuildId, setDiscordGuildId] = useState("");
  const [discordChannelIds, setDiscordChannelIds] = useState("");
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordMode, setDiscordMode] = useState<"bridge" | "trigger">("bridge");
  const [discordRunning, setDiscordRunning] = useState(false);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [discordError, setDiscordError] = useState("");
  const [showDiscordToken, setShowDiscordToken] = useState(false);
  const [channelAgentRows, setChannelAgentRows] = useState<Array<{ channelId: string; agentName: string }>>([]);
  const [agentList, setAgentList] = useState<string[]>([]);  const [discordNeedsRestart, setDiscordNeedsRestart] = useState(false);
  const discordInitialized = React.useRef(false);
  const markDiscordDirty = React.useCallback(() => {
    if (discordInitialized.current) setDiscordNeedsRestart(true);
  }, []);
  // UI state
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.nyteShiftApi) return;

    window.nyteShiftApi.readConfig().then((cfg) => {
      const c = (cfg || {}) as Record<string, any>;
      setConfig(c);
      setDefaultProvider(c.defaultProvider ?? "");
      setDefaultModel(c.defaultModel ?? "");
      setTemperature(String(c.temperature ?? "0.7"));
      setMaxTokens(String(c.maxTokens ?? "4096"));
      setWebhookPort(String(c.webhookPort ?? "7433"));
    }).catch(console.error);

    window.nyteShiftApi.listProviders().then((ps) => {
      setProviders(ps);
      if (ps.length && !editProvider) setEditProvider(ps[0].id);
      // Load API keys from the secret store (never from config.json)
      Promise.all(
        ps.map(async (p) => {
          const key = await window.nyteShiftApi!.secretGet?.(`provider:${p.id}:apiKey`).catch(() => undefined);
          return [p.id, key ?? ""] as const;
        })
      ).then((entries) => {
        setApiKeys(Object.fromEntries(entries.filter(([, v]) => v !== "")));
      }).catch(() => {});
    }).catch(console.error);

    window.nyteShiftApi.triggersEngineStatus?.().then((s) => {
      setEngineRunning(s?.running ?? false);
    }).catch(() => {});

    // Load global Discord config
    window.nyteShiftApi.discordGlobalConfigRead?.().then((cfg: any) => {
      if (cfg) {
        setDiscordBotToken(cfg.botToken || "");
        setDiscordGuildId(cfg.guildId || "");
        setDiscordChannelIds(cfg.channelIds?.join(", ") || "");
        setDiscordEnabled(cfg.enabled ?? false);
        setDiscordMode(cfg.mode ?? "bridge");
        if (cfg.channelAgentMap && typeof cfg.channelAgentMap === "object") {
          setChannelAgentRows(
            Object.entries(cfg.channelAgentMap).map(([channelId, agentName]) => ({
              channelId,
              agentName: agentName as string,
            }))
          );
        }
      }
      // Mark initialized only after Discord form values are settled so field
      // changes afterwards can correctly set the dirty flag.
      discordInitialized.current = true;
    }).catch(console.error);
    window.nyteShiftApi.discordGlobalStatus?.().then((s: any) => {
      setDiscordRunning(s?.running ?? false);
    }).catch(() => {});
    window.nyteShiftApi.listAgents().then(setAgentList).catch(console.error);
  }, []);

  // Reload models when default provider changes.
  useEffect(() => {
    if (!window.nyteShiftApi || !defaultProvider) return;
    window.nyteShiftApi.listProviderModels(defaultProvider)
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

  const { current, customThemes } = useTheme();

  const handleSave = async () => {
    if (!window.nyteShiftApi) return;
    setSaving(true);
    try {
      // always re-read the latest config from disk to avoid stomping
      // over changes made elsewhere (e.g. theme picker).  This ensures
      // we merge in any recent theme updates rather than using the stale
      // `config` state that was captured when the modal mounted.
      const base = (await window.nyteShiftApi.readConfig()) || {};
      const next = { ...base } as Record<string, any>;

      // Only update if values are set (prevent empty string from clearing)
      if (defaultProvider) next.defaultProvider = defaultProvider;
      if (defaultModel) next.defaultModel = defaultModel;
      const parsedTemp = parseFloat(temperature);
      const parsedMax = parseInt(maxTokens, 10);
      if (!isNaN(parsedTemp)) next.temperature = parsedTemp;
      if (!isNaN(parsedMax)) next.maxTokens = parsedMax;
      next.webhookPort = parseInt(webhookPort, 10) || 7433;

      // make sure theme preferences are always preserved when saving
      // global settings.  the theme context holds the canonical values.
      next.themeId = current.id;
      next.customThemes = customThemes;

      // ── Secrets: never write API keys or tokens to config.json ─────
      // Save current provider's API key to the secret store.
      if (editProvider) {
        const keyToSave = (apiKeys[editProvider] ?? "").trim();
        if (keyToSave) {
          await window.nyteShiftApi.secretSet?.(`provider:${editProvider}:apiKey`, keyToSave);
        }
        // Save base URL (non-secret) for the current provider.
        const baseUrl = (config?.providers?.[editProvider]?.baseUrl as string | undefined) ?? "";
        if (baseUrl) {
          next.providers = { ...(next.providers || {}) };
          next.providers[editProvider] = { ...(next.providers[editProvider] || {}) };
          next.providers[editProvider].baseUrl = baseUrl;
        }
      }

      // Save Discord bot token to the secret store (writeGlobalDiscordConfig
      // also handles this, but persisting here ensures it is saved even when
      // the user clicks the general Save button without restarting the bridge).
      if (discordBotToken.trim()) {
        await window.nyteShiftApi.secretSet?.("discord:global:botToken", discordBotToken.trim());
      }

      // Persist global Discord non-secret settings into config.
      {
        const builtMap: Record<string, string> = {};
        for (const row of channelAgentRows) {
          if (row.channelId.trim() && row.agentName.trim()) {
            builtMap[row.channelId.trim()] = row.agentName.trim();
          }
        }
        // Only set globalDiscord if there's meaningful discord config to save.
        if (discordBotToken.trim() || discordGuildId.trim() || discordChannelIds.trim()) {
          next.globalDiscord = {
            // botToken intentionally omitted: writeGlobalConfig strips it as a safety-net;
            // it was already saved to the secret store above.
            guildId: discordGuildId.trim() || undefined,
            channelIds: discordChannelIds.trim()
              ? discordChannelIds.split(",").map((s: string) => s.trim()).filter(Boolean)
              : undefined,
            enabled: discordEnabled,
            mode: discordMode,
            channelAgentMap: Object.keys(builtMap).length > 0 ? builtMap : undefined,
          };
        }
      }

      setConfig(next);
      await window.nyteShiftApi.writeConfig(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  // Build the Discord config object from current form state.
  const buildDiscordConfig = () => {
    const builtMap: Record<string, string> = {};
    for (const row of channelAgentRows) {
      if (row.channelId.trim() && row.agentName.trim()) {
        builtMap[row.channelId.trim()] = row.agentName.trim();
      }
    }
    return {
      botToken: discordBotToken.trim(),
      guildId: discordGuildId.trim() || undefined,
      channelIds: discordChannelIds.trim()
        ? discordChannelIds.split(",").map((s: string) => s.trim()).filter(Boolean)
        : undefined,
      enabled: true,
      mode: discordMode,
      channelAgentMap: Object.keys(builtMap).length > 0 ? builtMap : undefined,
    };
  };

  // Stop → re-save config → Start in one click.
  const handleRestartBridge = async () => {
    setDiscordLoading(true); setDiscordError("");
    try {
      if (discordRunning) {
        await window.nyteShiftApi?.discordGlobalStop?.();
        setDiscordRunning(false);
      }
      const cfg = buildDiscordConfig();
      await window.nyteShiftApi?.discordGlobalConfigWrite?.(cfg);
      setDiscordEnabled(true);
      await window.nyteShiftApi?.discordGlobalStart?.();
      setDiscordRunning(true);
      setDiscordNeedsRestart(false);
    } catch (err) { setDiscordError((err as Error).message); }
    finally { setDiscordLoading(false); }
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
            <div style={{ fontSize: 11, color: C.subtext0, marginTop: 1 }}>NyteShift Configuration</div>
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
                  Configure API keys and base URLs for each provider. API keys are stored
                  encrypted in <code style={{ color: C.mauve, fontSize: 11 }}>~/.nyteshift/secrets.json</code> using
                  AES-256-GCM — not in plain-text config.
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
                        value={apiKeys[editProvider] ?? ""}
                        onChange={(e) => setApiKeys(prev => ({ ...prev, [editProvider]: e.target.value }))}
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
                    <div style={{ fontSize: 11, color: C.subtext0, marginTop: 4 }}>
                      🔒 Stored encrypted in <code style={{ color: C.mauve, fontSize: 11 }}>~/.nyteshift/secrets.json</code> — never in plain-text config.
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
                  <SearchableSelect
                    value={defaultProvider}
                    onChange={async (v) => {
                      setDefaultProvider(v);
                      await window.nyteShiftApi!.writeConfig({ ...config, defaultProvider: v });
                    }}
                    options={[{ value: "", label: "— select —" }, ...(providers || []).map((p) => ({ value: p.id, label: p.id }))]}
                    placeholder="— select —"
                  />
                </div>

                <div>
                  <label style={labelStyle}>Default Model</label>
                  <SearchableSelect
                    value={defaultModel}
                    onChange={(v) => setDefaultModel(v)}
                    options={[{ value: "", label: "— select —" }, ...(models || []).map((m) => ({ value: m.id, label: m.id }))]}
                    placeholder="— select —"
                  />
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
                      if (defaultProvider && window.nyteShiftApi) {
                        window.nyteShiftApi.listProviderModels(defaultProvider)
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
                          await window.nyteShiftApi?.triggersEngineStart?.();
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
                          await window.nyteShiftApi?.triggersEngineStop?.();
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

          {/* ── Discord ── */}
          {activeTab === "discord" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, color: C.text }}>Global Discord Bot</h3>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
                  Connect a single shared Discord bot that can route messages to <strong>any</strong> agent by name.
                  Agents with their own per-agent Discord bot configured in their settings can be messaged directly.
                  Agents without their own bot must be addressed by name:
                </p>
                <div style={{
                  background: C.surface0, borderRadius: 8,
                  padding: "10px 14px", fontSize: 12, color: C.subtext1,
                  fontFamily: "monospace", lineHeight: 1.7,
                  border: `1px solid ${C.surface1}`, marginBottom: 4,
                }}>
                  @AgentName do something for me<br />
                  AgentName: summarise the latest news
                </div>
                <p style={{ margin: 0, fontSize: 11, color: C.overlay0, lineHeight: 1.4 }}>
                  Name matching is case-insensitive. The prefix is stripped before the task reaches the agent.
                </p>
              </div>

              {/* Bot token */}
              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Bot Token</h4>
                <p style={{ margin: 0, fontSize: 11, color: C.subtext0, lineHeight: 1.4 }}>
                  Create a bot at{" "}
                  <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer"
                    style={{ color: C.mauve, textDecoration: "none" }}
                  >discord.com/developers</a>.
                  Enable <strong>Message Content Intent</strong> under Privileged Gateway Intents.
                </p>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={discordBotToken}
                    onChange={(e) => { setDiscordBotToken(e.target.value); markDiscordDirty(); }}
                    placeholder="Paste your Discord bot token"
                    type={showDiscordToken ? "text" : "password"}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    type="button" onClick={() => setShowDiscordToken(!showDiscordToken)}
                    style={{
                      background: C.surface0, border: `1px solid ${C.surface1}`,
                      borderRadius: 6, padding: "6px 12px", color: C.subtext0,
                      cursor: "pointer", fontSize: 11, whiteSpace: "nowrap",
                    }}
                  >{showDiscordToken ? "Hide" : "Show"}</button>
                </div>
              </div>

              {/* Filtering */}
              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Channel Filtering</h4>
                <div>
                  <label style={labelStyle}>Guild (Server) ID</label>
                  <input
                    value={discordGuildId}
                    onChange={(e) => { setDiscordGuildId(e.target.value); markDiscordDirty(); }}
                    placeholder="Optional — restrict to a specific server"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Channel IDs</label>
                  <input
                    value={discordChannelIds}
                    onChange={(e) => { setDiscordChannelIds(e.target.value); markDiscordDirty(); }}
                    placeholder="Comma-separated — blank = all visible channels"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Conversation Mode</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {(["bridge", "trigger"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => { setDiscordMode(m); markDiscordDirty(); }}
                        style={{
                          flex: 1, padding: "8px 12px", borderRadius: 8,
                          background: discordMode === m ? "rgba(203,166,247,0.15)" : C.surface0,
                          border: discordMode === m ? `1px solid rgba(203,166,247,0.4)` : `1px solid transparent`,
                          color: discordMode === m ? C.mauve : C.subtext0,
                          fontWeight: discordMode === m ? 700 : 400,
                          cursor: "pointer", fontSize: 12,
                        }}
                      >
                        {m === "bridge" ? "Bridge (persistent chat)" : "Trigger (one-shot)"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Channel → Agent routing */}
              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Channel → Agent Routing</h4>
                <p style={{ margin: 0, fontSize: 11, color: C.subtext0, lineHeight: 1.5 }}>
                  Assign a specific agent to a Discord channel. Messages sent in that channel will go
                  directly to the assigned agent — no name prefix required.
                  Use the <strong>channel name</strong> (e.g. <code style={{ color: C.mauve }}>codi</code>) or its numeric ID.
                  Channel names are matched case-insensitively.
                </p>
                {channelAgentRows.map((row, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      value={row.channelId}
                      onChange={(e) => {
                        const next = [...channelAgentRows];
                        next[i] = { ...next[i], channelId: e.target.value };
                        setChannelAgentRows(next);
                        markDiscordDirty();
                      }}
                      placeholder="Channel name or ID"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <select
                      value={row.agentName}
                      onChange={(e) => {
                        const next = [...channelAgentRows];
                        next[i] = { ...next[i], agentName: e.target.value };
                        setChannelAgentRows(next);
                        markDiscordDirty();
                      }}
                      style={{ ...selectStyle, flex: 1 }}
                    >
                      <option value="">— Select agent —</option>
                      {agentList.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => { setChannelAgentRows(channelAgentRows.filter((_, j) => j !== i)); markDiscordDirty(); }}
                      style={{
                        background: "rgba(243,139,168,0.1)", border: `1px solid rgba(243,139,168,0.25)`,
                        borderRadius: 6, padding: "6px 10px", color: C.red,
                        cursor: "pointer", fontSize: 13, lineHeight: 1,
                      }}
                    >🗑</button>
                  </div>
                ))}
                <button
                  onClick={() => { setChannelAgentRows([...channelAgentRows, { channelId: "", agentName: "" }]); markDiscordDirty(); }}
                  style={{
                    alignSelf: "flex-start", background: C.surface0, border: `1px solid ${C.surface1}`,
                    borderRadius: 7, padding: "6px 14px", color: C.subtext1,
                    cursor: "pointer", fontSize: 12,
                  }}
                >+ Add channel mapping</button>
              </div>

              {/* Enable / status */}
              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Bridge Status</h4>

                {/* Dirty / needs-restart banner */}
                {discordRunning && discordNeedsRestart && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", borderRadius: 8,
                    background: "rgba(249,226,175,0.08)",
                    border: "1px solid rgba(249,226,175,0.35)",
                  }}>
                    <span style={{ fontSize: 15 }}>⚠️</span>
                    <span style={{ flex: 1, fontSize: 12, color: "#f9e2af", lineHeight: 1.4 }}>
                      Settings changed — refresh the bridge to apply them.
                    </span>
                    <button
                      disabled={discordLoading}
                      onClick={handleRestartBridge}
                      style={{
                        padding: "5px 14px", borderRadius: 6, border: "1px solid rgba(249,226,175,0.4)",
                        background: "rgba(249,226,175,0.12)", color: "#f9e2af",
                        cursor: discordLoading ? "not-allowed" : "pointer",
                        fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                        opacity: discordLoading ? 0.5 : 1,
                      }}
                    >{discordLoading ? "Restarting…" : "Refresh Now"}</button>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox" id="gdc-enabled" checked={discordEnabled}
                    onChange={(e) => { setDiscordEnabled(e.target.checked); markDiscordDirty(); }}
                    style={{ accentColor: C.mauve }}
                  />
                  <label htmlFor="gdc-enabled" style={{ fontSize: 13, color: C.text, cursor: "pointer" }}>
                    Enable global Discord bridge
                  </label>
                </div>

                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 14px", borderRadius: 8,
                  background: discordRunning ? "rgba(166,227,161,0.08)" : "rgba(108,112,134,0.08)",
                  border: `1px solid ${discordRunning ? "rgba(166,227,161,0.25)" : C.surface1}`,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: discordRunning ? C.green : C.overlay0,
                    boxShadow: discordRunning ? `0 0 6px ${C.green}` : "none",
                  }} />
                  <span style={{ fontSize: 13, color: discordRunning ? C.green : C.subtext0, fontWeight: 600 }}>
                    {discordRunning ? "Connected" : "Offline"}
                  </span>
                  <div style={{ flex: 1 }} />
                  {!discordRunning ? (
                    <button
                      disabled={discordLoading || !discordBotToken.trim()}
                      onClick={async () => {
                        setDiscordLoading(true); setDiscordError("");
                        try {
                          const builtMap: Record<string, string> = {};
                          for (const row of channelAgentRows) {
                            if (row.channelId.trim() && row.agentName.trim()) {
                              builtMap[row.channelId.trim()] = row.agentName.trim();
                            }
                          }
                          const cfg = {
                            botToken: discordBotToken.trim(),
                            guildId: discordGuildId.trim() || undefined,
                            channelIds: discordChannelIds.trim()
                              ? discordChannelIds.split(",").map((s) => s.trim()).filter(Boolean)
                              : undefined,
                            enabled: true,
                            mode: discordMode,
                            channelAgentMap: Object.keys(builtMap).length > 0 ? builtMap : undefined,
                          };
                          await window.nyteShiftApi?.discordGlobalConfigWrite?.(cfg);
                          setDiscordEnabled(true);
                          await window.nyteShiftApi?.discordGlobalStart?.();
                          setDiscordRunning(true);
                          setDiscordNeedsRestart(false);
                        } catch (err) { setDiscordError((err as Error).message); }
                        finally { setDiscordLoading(false); }
                      }}
                      style={{
                        padding: "6px 16px", borderRadius: 7, border: "none",
                        background: C.green, color: C.crust, fontWeight: 700,
                        cursor: discordLoading || !discordBotToken.trim() ? "not-allowed" : "pointer",
                        fontSize: 12, opacity: discordLoading || !discordBotToken.trim() ? 0.5 : 1,
                      }}
                    >{discordLoading ? "Connecting…" : "Start"}</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        disabled={discordLoading || !discordBotToken.trim()}
                        onClick={handleRestartBridge}
                        style={{
                          padding: "6px 16px", borderRadius: 7, border: "none",
                          background: "#f9e2af", color: "#1e1e2e", fontWeight: 700,
                          cursor: discordLoading || !discordBotToken.trim() ? "not-allowed" : "pointer",
                          fontSize: 12, opacity: discordLoading || !discordBotToken.trim() ? 0.5 : 1,
                        }}
                      >{discordLoading ? "Restarting…" : "⟳ Refresh"}</button>
                      <button
                        disabled={discordLoading}
                        onClick={async () => {
                          setDiscordLoading(true); setDiscordError("");
                          try {
                            await window.nyteShiftApi?.discordGlobalStop?.();
                            setDiscordRunning(false);
                            setDiscordNeedsRestart(false);
                          } catch (err) { setDiscordError((err as Error).message); }
                          finally { setDiscordLoading(false); }
                        }}
                        style={{
                          padding: "6px 16px", borderRadius: 7, border: "none",
                          background: C.red, color: C.crust, fontWeight: 700,
                          cursor: discordLoading ? "not-allowed" : "pointer",
                          fontSize: 12, opacity: discordLoading ? 0.5 : 1,
                        }}
                      >{discordLoading ? "Stopping…" : "Stop"}</button>
                    </div>
                  )}
                </div>

                {discordError && (
                  <div style={{
                    padding: "8px 12px", borderRadius: 8,
                    background: "rgba(243,139,168,0.08)",
                    border: `1px solid rgba(243,139,168,0.2)`,
                    fontSize: 12, color: C.red, wordBreak: "break-word",
                  }}>{discordError}</div>
                )}
              </div>
            </div>
          )}

          {/* ── Themes ── */}
          {activeTab === "themes" && <ThemeSettingsTab />}

          {/* ── About ── */}
          {activeTab === "about" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, color: C.text }}>About NyteShift</h3>
                <p style={{ margin: "0 0 16px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
                  NyteShift is a local-first autonomous agent platform.
                </p>
              </div>

              <div style={sectionStyle}>
                <InfoRow label="Version" value="0.1.0" />
                <InfoRow label="Config Path" value="~/.nyteshift/config.json" />
                <InfoRow label="Agents Path" value="~/.nyteshift/agents/" />
                <InfoRow label="Skills Path" value="~/.nyteshift/skills/" />
                <InfoRow label="Tools Path" value="~/.nyteshift/tools/" />
              </div>

              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Raw Configuration</h4>
                <p style={{ margin: 0, fontSize: 11, color: C.subtext0 }}>
                  Current contents of <code style={{ color: C.mauve }}>~/.nyteshift/config.json</code>. Edit fields above and press Save.
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
                    await window.nyteShiftApi?.writeConfig(defaults);
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
