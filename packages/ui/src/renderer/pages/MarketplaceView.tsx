import React, { useEffect, useState, useCallback } from "react";
import type {
  MarketplaceItemInfo,
  MarketplaceSourceConfig,
  MarketplaceSyncResultInfo,
} from "../global.js";

// ── Colour tokens ──────────────────────────────────────────────────────
const c = {
  bg: "#f8f9fa",
  card: "#ffffff",
  border: "#dee2e6",
  accent: "#6c5ce7",
  accentHover: "#5a4bd1",
  danger: "#e74c3c",
  success: "#27ae60",
  muted: "#6c757d",
  text: "#212529",
  textLight: "#495057",
  tagBg: "#e9ecef",
};

const pillStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 12,
  fontSize: "0.78rem",
  fontWeight: 600,
  textTransform: "capitalize",
};

// ── Main component ─────────────────────────────────────────────────────

export function MarketplaceView(): React.JSX.Element {
  // State
  const [items, setItems] = useState<MarketplaceItemInfo[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<MarketplaceSyncResultInfo[]>([]);
  const [sources, setSources] = useState<MarketplaceSourceConfig[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  // Debug log panel
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [pollCount, setPollCount] = useState(0);
  const addLog = useCallback((...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    setDebugLogs((l) => [...l, msg]);
    console.log(...args);
  }, []);


  // New source form
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newBranch, setNewBranch] = useState("main");

  // note: window.solixApi may be undefined initially, so always access it when needed
  const getApi = () => (window as any).solixApi; // typed as any to avoid TS errors

  // ── Data loading ───────────────────────────────────────────────────
  const loadItems = useCallback(async () => {
    const api = getApi();
    if (!api) { addLog("[Marketplace] loadItems: api not ready"); return; }
    const opts: { category?: string; search?: string } = {};
    if (activeCategory !== "all") opts.category = activeCategory;
    if (search.trim()) opts.search = search.trim();
    addLog("[Marketplace] loadItems — opts:", opts);
    try {
      const data = await api.marketplaceBrowse(opts);
      addLog(`[Marketplace] loadItems — received ${data.length} item(s)`);
      setItems(data);
    } catch (err) {
      addLog("[Marketplace] loadItems — ERROR:", err);
    }
  }, [activeCategory, search]);

  const loadCategories = useCallback(async () => {
    const api = getApi();
    if (!api) { addLog("[Marketplace] loadCategories: api not ready"); return; }
    addLog("[Marketplace] loadCategories — calling");
    try {
      const cats = await api.marketplaceCategories();
      addLog("[Marketplace] loadCategories — result:", cats);
      setCategories(cats);
    } catch (err) {
      addLog("[Marketplace] loadCategories — ERROR:", err);
    }
  }, []);

  const loadSources = useCallback(async () => {
    const api = getApi();
    if (!api) { addLog("[Marketplace] loadSources: api not ready"); return; }
    addLog("[Marketplace] loadSources — calling");
    try {
      const cfg = await api.marketplaceConfigRead();
      addLog("[Marketplace] loadSources — sources:", cfg.sources.map((s: MarketplaceSourceConfig) => s.name));
      setSources(cfg.sources);
    } catch (err) {
      addLog("[Marketplace] loadSources — ERROR:", err);
    }
  }, []);

  // Track whether we've already attempted an auto-sync so we don't loop
  const autoSyncedRef = React.useRef(false);

  // On mount, if API isn't ready yet we poll until it shows up so we can load data
  useEffect(() => {
    addLog("[Marketplace] mount — preload flag:", (window as any).__preload_executed);
    addLog("[Marketplace] mount — window.solixApi present:", !!window.solixApi);
    if (getApi()) {
      loadCategories();
      loadSources();
      loadItems();
    } else {
      addLog("[Marketplace] api not yet available, starting poll");
      const interval = setInterval(() => {
        const apiNow = getApi();
        setPollCount((c) => c + 1);
        addLog("[Marketplace] poll tick, api", apiNow);
        if (apiNow) {
          addLog("[Marketplace] api became available (poll)");
          loadCategories();
          loadSources();
          loadItems();
          clearInterval(interval);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [loadCategories, loadSources, loadItems]);

  useEffect(() => {
    if (getApi()) loadItems();
  }, [loadItems]);

  // Auto-sync on first open when the cache is empty (no categories discovered yet)
  useEffect(() => {
    const api = getApi();
    addLog(`[Marketplace] auto-sync check — api:${!!api} alreadySynced:${autoSyncedRef.current} syncing:${syncing} categories:${categories.length} items:${items.length}`);
    if (!api || autoSyncedRef.current || syncing) return;
    if (categories.length === 0 && items.length === 0) {
      addLog("[Marketplace] auto-sync — triggering first-time sync");
      autoSyncedRef.current = true;
      setSyncing(true);
      setSyncResults([]);
      api.marketplaceSync()
        .then(async (results: MarketplaceSyncResultInfo[]) => {
          addLog("[Marketplace] auto-sync — sync finished:", results);
          setSyncResults(results);
          await loadCategories();
          await loadItems();
        })
        .catch((err: Error) => {
          addLog("[Marketplace] auto-sync — ERROR:", err);
          setSyncResults([{ source: "?", status: "error", message: err.message }]);
        })
        .finally(() => {
          addLog("[Marketplace] auto-sync — done, setSyncing(false)");
          setSyncing(false);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length, items.length, syncing]);

  // ── Actions ────────────────────────────────────────────────────────
  const handleSync = async () => {
    const api = getApi();
    if (!api) { addLog("[Marketplace] handleSync: api not ready"); return; }
    setSyncing(true);
    setSyncResults([]);
    try {
      const results = await api.marketplaceSync();
      setSyncResults(results);
      await loadCategories();
      await loadItems();
    } catch (err) {
      setSyncResults([{ source: "?", status: "error", message: (err as Error).message }]);
    } finally {
      setSyncing(false);
    }
  };

  const handleInstall = async (item: MarketplaceItemInfo) => {
    const api = getApi();
    if (!api) { addLog("[Marketplace] handleInstall: api not ready"); return; }
    const key = itemKey(item);
    setBusy(key);
    try {
      const res = await api.marketplaceInstall({
        category: item.category,
        contributor: item.contributor,
        name: item.name,
        localPath: item.localPath,
      });
      showToast(res.message);
      await loadItems();
      // notify tools page if we installed a tool
      if (item.category === "tools") {
        api.notifyToolsChanged?.();
      }
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleUninstall = async (item: MarketplaceItemInfo) => {
    const api = getApi();
    if (!api) { addLog("[Marketplace] handleUninstall: api not ready"); return; }
    const key = itemKey(item);
    setBusy(key);
    try {
      const res = await api.marketplaceUninstall({
        category: item.category,
        contributor: item.contributor,
        name: item.name,
      });
      showToast(res.message);
      await loadItems();
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleAddSource = async () => {
    const api = getApi();
    if (!api || !newName.trim() || !newUrl.trim()) { addLog("[Marketplace] handleAddSource: api not ready or invalid input"); return; }
    await api.marketplaceSourceAdd({
      name: newName.trim(),
      url: newUrl.trim(),
      branch: newBranch.trim() || "main",
      enabled: true,
    });
    setNewName("");
    setNewUrl("");
    setNewBranch("main");
    await loadSources();
    showToast(`Added source: ${newName.trim()}`);
  };

  const handleRemoveSource = async (name: string) => {
    const api = getApi();
    if (!api) { addLog("[Marketplace] handleRemoveSource: api not ready"); return; }
    await api.marketplaceSourceRemove(name);
    await loadSources();
    showToast(`Removed source: ${name}`);
  };

  const handleToggleSource = async (name: string, enabled: boolean) => {
    const api = getApi();
    if (!api) { addLog("[Marketplace] handleToggleSource: api not ready"); return; }
    await api.marketplaceSourceToggle(name, enabled);
    await loadSources();
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Marketplace</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowSources(!showSources)} style={btnSecondary}>
            {showSources ? "Hide Sources" : "Manage Sources"}
          </button>
          <button onClick={handleSync} disabled={syncing} style={btnPrimary}>
            {syncing ? "Syncing…" : "Sync All"}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, background: c.accent, color: "#fff",
          padding: "10px 20px", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 1000, fontSize: "0.9rem",
        }}>
          {toast}
        </div>
      )}
      {/* debug helpers */}
      <button
        onClick={() => addLog("manual check api", getApi())}
        style={{ position: "fixed", bottom: 24, left: 24, padding: "4px 8px", fontSize: "0.75rem" }}
      >
        Check API
      </button>
      {/* show waiting warning after a few failed polls */}
      {pollCount > 20 && !getApi() && (
        <div style={{ color: c.danger, marginTop: 10, fontSize: "0.85rem" }}>
          Still waiting for backend preload. Check DevTools console for errors.
        </div>
      )}

      {/* Debug log panel (also printed to console) */}
      {debugLogs.length > 0 && (
        <div style={{
          marginBottom: 16,
          padding: 12,
          background: "#f1f3f5",
          color: c.textLight,
          borderRadius: 8,
          fontSize: "0.75rem",
          maxHeight: 120,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}>
          <strong>Debug:</strong>
          {debugLogs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      {/* Sync results */}
      {syncResults.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: c.bg, borderRadius: 8, border: `1px solid ${c.border}` }}>
          <strong>Sync Results:</strong>
          <ul style={{ margin: "8px 0 0 0", padding: "0 0 0 20px", listStyle: "disc" }}>
            {syncResults.map((r, i) => (
              <li key={i} style={{ color: r.status === "error" ? c.danger : c.success, fontSize: "0.9rem" }}>
                <strong>{r.source}</strong>: {r.status} — {r.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sources panel */}
      {showSources && (
        <div style={{ marginBottom: 24, padding: 16, background: c.card, borderRadius: 10, border: `1px solid ${c.border}` }}>
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Marketplace Sources</h2>
          <p style={{ color: c.muted, fontSize: "0.85rem", marginBottom: 12 }}>
            Add git repositories that contain skills, tools, triggers, and other SolixAI extensions.
          </p>

          {/* Existing sources */}
          {sources.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: `2px solid ${c.border}` }}>
                  <th style={th}>Name</th>
                  <th style={th}>URL</th>
                  <th style={th}>Branch</th>
                  <th style={th}>Enabled</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.name} style={{ borderBottom: `1px solid ${c.border}` }}>
                    <td style={td}>{s.name}</td>
                    <td style={{ ...td, fontSize: "0.82rem", color: c.muted, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.url}
                    </td>
                    <td style={td}>{s.branch ?? "main"}</td>
                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={(e) => handleToggleSource(s.name, e.target.checked)}
                      />
                    </td>
                    <td style={td}>
                      <button onClick={() => handleRemoveSource(s.name)} style={{ ...btnDanger, padding: "2px 10px", fontSize: "0.8rem" }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Add source form */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Source name"
              style={inputStyle}
            />
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="Git URL (https://…)"
              style={{ ...inputStyle, flex: 2 }}
            />
            <input
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="Branch"
              style={{ ...inputStyle, width: 80, flex: "none" }}
            />
            <button onClick={handleAddSource} style={btnPrimary}>
              Add Source
            </button>
          </div>
        </div>
      )}

      {/* Search + category filter bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search marketplace…"
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <CategoryButton label="all" active={activeCategory === "all"} onClick={() => setActiveCategory("all")} />
          {categories.map((cat) => (
            <CategoryButton key={cat} label={cat} active={activeCategory === cat} onClick={() => setActiveCategory(cat)} />
          ))}
        </div>
      </div>

      {/* Items grid */}
      {items.length === 0 ? (
        <EmptyState syncing={syncing} synced={syncResults.length > 0 || categories.length > 0} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {items.map((item) => {
            const key = itemKey(item);
            return (
              <div key={key} style={{
                background: c.card,
                borderRadius: 10,
                border: `1px solid ${c.border}`,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                transition: "box-shadow 0.15s",
              }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: "1rem", color: c.text }}>{item.name}</span>
                    <span style={{ ...pillStyle, background: categoryColor(item.category), color: "#fff" }}>
                      {item.category}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.82rem", color: c.muted, marginBottom: 6 }}>
                    by <strong>{item.contributor}</strong>
                    {item.source !== "Official SolixAI" && (
                      <span style={{ ...pillStyle, background: c.tagBg, color: c.textLight, marginLeft: 6 }}>{item.source}</span>
                    )}
                  </div>
                  {item.description && (
                    <p style={{ fontSize: "0.88rem", color: c.textLight, margin: "8px 0 0" }}>
                      {item.description}
                    </p>
                  )}
                </div>

                <div style={{ marginTop: 14 }}>
                  {item.installed ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ ...pillStyle, background: c.success, color: "#fff" }}>Installed</span>
                      <button
                        onClick={() => handleUninstall(item)}
                        disabled={busy === key}
                        style={{ ...btnDanger, padding: "4px 12px", fontSize: "0.82rem" }}
                      >
                        {busy === key ? "…" : "Uninstall"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleInstall(item)}
                      disabled={busy === key}
                      style={btnPrimary}
                    >
                      {busy === key ? "Installing…" : "Install"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function CategoryButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 14px",
        borderRadius: 16,
        border: `1px solid ${active ? c.accent : c.border}`,
        background: active ? c.accent : "transparent",
        color: active ? "#fff" : c.textLight,
        cursor: "pointer",
        fontSize: "0.84rem",
        fontWeight: active ? 600 : 400,
        textTransform: "capitalize",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}

function EmptyState({ syncing, synced }: { syncing: boolean; synced: boolean }) {
  if (syncing) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 1rem", color: c.muted }}>
        <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>Syncing marketplace…</p>
        <p>Cloning marketplace repository, this may take a moment.</p>
      </div>
    );
  }
  return (
    <div style={{
      textAlign: "center",
      padding: "3rem 1rem",
      color: c.muted,
    }}>
      {synced ? (
        <>
          <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>No items found</p>
          <p>Try a different search or category filter.</p>
        </>
      ) : (
        <>
          <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>Marketplace not synced yet</p>
          <p>Click <strong>Sync All</strong> to clone the marketplace repositories and discover available skills, tools, and more.</p>
          <p style={{ fontSize: "0.85rem" }}>
            The default source is <code>https://github.com/jonjonbinx1/SolixAI-Marketplace.git</code>.
            <br />Use <strong>Manage Sources</strong> to add more.
          </p>
        </>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function itemKey(item: MarketplaceItemInfo): string {
  return `${item.source}::${item.category}/${item.contributor}/${item.name}`;
}

const CAT_COLORS: Record<string, string> = {
  skills: "#6c5ce7",
  tools: "#00b894",
  triggers: "#fdcb6e",
  souls: "#e17055",
  themes: "#0984e3",
  "soul-templates": "#e17055",
  "ui-themes": "#0984e3",
};

function categoryColor(cat: string): string {
  return CAT_COLORS[cat] ?? "#636e72";
}

// ── Styles ─────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  padding: "7px 18px",
  borderRadius: 6,
  border: "none",
  background: c.accent,
  color: "#fff",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: "0.88rem",
};

const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: "transparent",
  border: `1px solid ${c.border}`,
  color: c.textLight,
};

const btnDanger: React.CSSProperties = {
  ...btnPrimary,
  background: c.danger,
};

const inputStyle: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 6,
  border: `1px solid ${c.border}`,
  fontSize: "0.9rem",
  flex: 1,
};

const th: React.CSSProperties = { padding: "6px 10px", fontSize: "0.84rem", color: c.muted };
const td: React.CSSProperties = { padding: "8px 10px", fontSize: "0.9rem" };
