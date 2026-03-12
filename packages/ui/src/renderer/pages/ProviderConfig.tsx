import React, { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext.js";
import { SearchableSelect } from "../components/SearchableSelect.js";

type ModelInfo = { id: string; contextWindow: number; maxOutputTokens: number; description?: string };

export function ProviderConfig(): React.JSX.Element {
  const { palette: C } = useTheme();
  const [providers, setProviders] = useState<Array<{ id: string }>>([]);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [temperature, setTemperature] = useState<string>("");
  const [maxTokens, setMaxTokens] = useState<string>("");

  useEffect(() => {
    if (!window.nyteShiftApi) return;
    window.nyteShiftApi
      .listProviders()
      .then((ps) => {
        setProviders(ps);
        if (ps.length && !selectedProvider) setSelectedProvider(ps[0].id);
      })
      .catch(console.error);
    window.nyteShiftApi.readConfig().then((cfg) => {
      setConfig(cfg || {});
      if (cfg?.defaultProvider) setSelectedProvider(cfg.defaultProvider as string);
      if (cfg?.defaultModel) setSelectedModel(cfg.defaultModel as string);
      if (typeof cfg?.temperature !== "undefined") setTemperature(String(cfg.temperature));
      if (typeof cfg?.maxTokens !== "undefined") setMaxTokens(String(cfg.maxTokens));
    }).catch(console.error);
    // subscribe to provider changes (e.g. side-loaded user providers)
    try {
      window.nyteShiftApi.onProvidersChanged(() => {
        window.nyteShiftApi!.listProviders().then((ps) => {
          setProviders(ps);
          if (ps.length && !selectedProvider) setSelectedProvider(ps[0].id);
        }).catch(console.error);
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (!window.nyteShiftApi || !selectedProvider) return;
    window.nyteShiftApi.listProviderModels(selectedProvider)
      .then((m: ModelInfo[]) => {
        setModels(m || []);
        if (m && m.length) {
          // pick a model when none selected or current model isn't available
          if (!selectedModel || !m.some((x) => x.id === selectedModel)) {
            setSelectedModel(m[0].id);
          }
        }
      })
      .catch((err) => {
        console.error(err);
        setModels([]);
      });
  }, [selectedProvider]);

  const updateProviderSetting = (provId: string, key: string, value: string) => {
    const next = { ...(config || {}) };
    next.providers = { ...(next.providers || {}) };
    next.providers[provId] = { ...(next.providers[provId] || {}) };
    next.providers[provId][key] = value;
    setConfig(next);
  };

  const handleSave = async () => {
    // ensure we persist temperature/maxTokens values into global config
    const next = { ...(config || {}) };
    const parsedTemp = temperature === "" ? undefined : parseFloat(temperature);
    const parsedMax = maxTokens === "" ? undefined : parseInt(maxTokens, 10);
    if (typeof parsedTemp !== "undefined" && !Number.isNaN(parsedTemp)) next.temperature = parsedTemp;
    if (typeof parsedMax !== "undefined" && !Number.isNaN(parsedMax)) next.maxTokens = parsedMax;
    setConfig(next);
    await window.nyteShiftApi!.writeConfig(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSetDefaultModel = async () => {
    const next = { ...(config || {}) };
    next.defaultProvider = selectedProvider;
    next.defaultModel = selectedModel;
    // include temperature/maxTokens if set
    const parsedTemp = temperature === "" ? undefined : parseFloat(temperature);
    const parsedMax = maxTokens === "" ? undefined : parseInt(maxTokens, 10);
    if (typeof parsedTemp !== "undefined" && !Number.isNaN(parsedTemp)) next.temperature = parsedTemp;
    if (typeof parsedMax !== "undefined" && !Number.isNaN(parsedMax)) next.maxTokens = parsedMax;
    setConfig(next);
    await window.nyteShiftApi!.writeConfig(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h1>Provider Configuration</h1>

      <section style={{ marginBottom: 24 }}>
        <h2>Registered Providers</h2>
        <ul>
          {providers.map((p) => (
            <li key={p.id}>{p.id}</li>
          ))}
        </ul>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Default Provider & Model</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label>
            Provider:
            <div style={{ marginTop: 6 }}>
              <SearchableSelect
                value={selectedProvider}
                onChange={(v) => setSelectedProvider(v)}
                options={(providers || []).map((p) => ({ value: p.id, label: p.id }))}
                placeholder=""
              />
            </div>
          </label>

          <label>
            Model:
            <div style={{ marginTop: 6 }}>
              <SearchableSelect
                value={selectedModel}
                onChange={(v) => setSelectedModel(v)}
                options={(models || []).map((m) => ({ value: m.id, label: m.id }))}
                placeholder=""
              />
            </div>
          </label>

          <label>
            Temperature:
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              style={{ width: 100, marginLeft: 8 }}
            />
          </label>

          <label>
            Max tokens:
            <input
              type="number"
              step="1"
              min="1"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              style={{ width: 120, marginLeft: 8 }}
            />
          </label>

          <button onClick={() => {
            if (selectedProvider) window.nyteShiftApi!.listProviderModels(selectedProvider).then((m:any) => setModels(m)).catch(console.error);
          }} style={{ padding: "6px 12px" }}>Refresh Models</button>

          <button onClick={handleSetDefaultModel} style={{ padding: "6px 12px" }}>Set Default</button>
          {saved && <span style={{ color: C.green }}>Saved!</span>}
        </div>
      </section>

      <section>
        <h2>Provider Settings</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ minWidth: 300 }}>
            <label>
              Edit provider:
              <div style={{ marginTop: 8 }}>
                <SearchableSelect
                  value={selectedProvider}
                  onChange={(v) => setSelectedProvider(v)}
                  options={(providers || []).map((p) => ({ value: p.id, label: p.id }))}
                  placeholder=""
                />
              </div>
            </label>

            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 8 }}>
                <label>API Key</label>
                <input
                  type="text"
                  value={(config.providers?.[selectedProvider]?.apiKey) ?? ""}
                  onChange={(e) => updateProviderSetting(selectedProvider, "apiKey", e.target.value)}
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                />
              </div>

              <div>
                <label>Base URL</label>
                <input
                  type="text"
                  value={(config.providers?.[selectedProvider]?.baseUrl) ?? ""}
                  onChange={(e) => updateProviderSetting(selectedProvider, "baseUrl", e.target.value)}
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                />
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 12 }}>
              <button onClick={handleSave} style={{ padding: "6px 16px" }}>Save Config</button>
              {saved && <span style={{ color: C.green, marginLeft: 12 }}>Saved!</span>}
            </div>

            <div>
              <h4>Raw config (read-only)</h4>
              <pre style={{ whiteSpace: "pre-wrap", background: C.surface0, padding: 12, borderRadius: 6 }}>
                {JSON.stringify(config, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
