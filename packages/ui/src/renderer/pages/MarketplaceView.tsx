import React, { useEffect, useState, useCallback, useMemo } from "react";
import type {
  MarketplaceItemInfo,
  MarketplaceSourceConfig,
  MarketplaceSyncResultInfo,
} from "../global.js";
import { useTheme } from "../theme/ThemeContext.js";

const CAT_COLORS: Record<string, string> = {
  skills: "#cba6f7",
  tools: "#a6e3a1",
  triggers: "#f9e2af",
  souls: "#fab387",
  "soul-templates": "#fab387",
  themes: "#89b4fa",
  "ui-themes": "#89b4fa",
};
const catColor = (c: string) => CAT_COLORS[c] ?? "#9399b2";

/* ════════════════════════════════════════════════════════════════════════
   MarketplaceView
   ════════════════════════════════════════════════════════════════════════ */
export function MarketplaceView(): React.JSX.Element {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };

  /* ── data state ─────────────────────────────────────────────────── */
  const [items, setItems] = useState<MarketplaceItemInfo[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<MarketplaceSyncResultInfo[]>([]);
  const [sources, setSources] = useState<MarketplaceSourceConfig[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  /* ── navigation state ───────────────────────────────────────────── */
  const [activeContributor, setActiveContributor] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [query, setQuery] = useState("");

  /* ── sources form ───────────────────────────────────────────────── */
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newBranch, setNewBranch] = useState("main");
  const [globalAutoUpdate, setGlobalAutoUpdate] = useState(false);
  const [installedIndex, setInstalledIndex] = useState<any>(null);

  const api = () => (window as any).solixApi;

  /* ── data loading ─────────────────────────────────────────────────── */
  const loadItems = useCallback(async () => {
    const a = api(); if (!a) return;
    try { setItems(await a.marketplaceBrowse({})); } catch { /* */ }
  }, []);

  const loadSources = useCallback(async () => {
    const a = api(); if (!a) return;
    try { setSources((await a.marketplaceConfigRead()).sources); } catch { /* */ }
  }, []);

  const loadInstalledIndex = useCallback(async () => {
    const a = api(); if (!a) return;
    try {
      const idx = await a.marketplaceInstalled();
      setInstalledIndex(idx);
      if (typeof idx.globalAutoUpdate === "boolean") {
        setGlobalAutoUpdate(!!idx.globalAutoUpdate);
      } else {
        // fallback to config
        try {
          const cfg = await a.readConfig();
          setGlobalAutoUpdate(!!(cfg.autoUpdate?.marketplace));
        } catch {
          setGlobalAutoUpdate(false);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const handleGlobalAutoToggle = async (en: boolean) => {
    const a = api(); if (!a) return;
    await a.marketplaceSetGlobalAutoUpdate(en);
    setGlobalAutoUpdate(en);
    // also write into global config so future installs use default
    try {
      const cfg = await a.readConfig();
      cfg.autoUpdate = cfg.autoUpdate ?? {};
      cfg.autoUpdate.marketplace = en;
      await a.writeConfig(cfg);
    } catch {
      // ignore
    }
  };

  const handleItemAutoToggle = async (item: MarketplaceItemInfo, en: boolean) => {
    const a = api(); if (!a) return;
    await a.marketplaceSetAutoUpdate({ category: item.category, contributor: item.contributor, name: item.name }, en);
    await loadInstalledIndex();
    await loadItems();
  };

  const handleUpdate = async (item?: MarketplaceItemInfo) => {
    const a = api(); if (!a) return;
    try {
      const res = await a.marketplaceUpdate(item ? { category: item.category, contributor: item.contributor, name: item.name } : undefined);
      if (item) {
        flash(res.message || "Updated");
      } else {
        flash("Checked for updates");
      }
      await loadItems();
      await loadInstalledIndex();
    } catch (e: any) {
      flash(`Error: ${e.message}`);
    }
  };

  /* initial boot */
  const autoSyncedRef = React.useRef(false);
  useEffect(() => {
    const boot = async (a: any) => {
      await Promise.all([loadSources(), loadItems(), loadInstalledIndex()]);
      if (!autoSyncedRef.current) {
        const cats = await a.marketplaceCategories();
        if (cats.length === 0) {
          autoSyncedRef.current = true;
          setSyncing(true);
          try {
            const res = await a.marketplaceSync();
            setSyncResults(res);
            await loadItems();
            await loadInstalledIndex();
          } catch (e: any) {
            setSyncResults([{ source: "?", status: "error", message: e.message }]);
          } finally { setSyncing(false); }
        }
      }
      setLoading(false);
    };
    const a = api();
    if (a) { boot(a); return; }
    const id = setInterval(() => { const a2 = api(); if (a2) { clearInterval(id); boot(a2); } }, 80);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── derived grouping ─────────────────────────────────────────────── */
  const byContributor = useMemo(() => {
    const m = new Map<string, MarketplaceItemInfo[]>();
    for (const item of items) {
      if (!m.has(item.contributor)) m.set(item.contributor, []);
      m.get(item.contributor)!.push(item);
    }
    return m;
  }, [items]);

  const allContributors = useMemo(() => Array.from(byContributor.keys()).sort(), [byContributor]);

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) s.add(i.category);
    return Array.from(s).sort();
  }, [items]);

  /* ── contributor view filtering ───────────────────────────────────── */
  const filteredContributors = useMemo(() => {
    return allContributors.filter((contrib) => {
      const contribItems = byContributor.get(contrib)!;
      if (activeTab !== "all" && !contribItems.some((i) => i.category === activeTab)) return false;
      if (query.trim()) {
        return contrib.toLowerCase().includes(query.toLowerCase());
      }
      return true;
    });
  }, [allContributors, byContributor, activeTab, query]);

  /* ── drill-down filtering ─────────────────────────────────────────── */
  const drillItems = useMemo(() => {
    if (!activeContributor) return [];
    let base = byContributor.get(activeContributor) ?? [];
    if (activeTab !== "all") base = base.filter((i) => i.category === activeTab);
    if (query.trim()) {
      const q = query.toLowerCase();
      base = base.filter(
        (i) => i.name.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q),
      );
    }
    return base;
  }, [activeContributor, byContributor, activeTab, query]);

  const drillCategories = useMemo(() => {
    if (!activeContributor) return [];
    const s = new Set<string>();
    for (const i of byContributor.get(activeContributor) ?? []) s.add(i.category);
    return Array.from(s).sort();
  }, [activeContributor, byContributor]);

  /* tab counts change meaning depending on which view we're in */
  const tabCounts = useMemo(() => {
    const m: Record<string, number> = {};
    if (activeContributor) {
      const base = byContributor.get(activeContributor) ?? [];
      m.all = base.length;
      for (const i of base) m[i.category] = (m[i.category] ?? 0) + 1;
    } else {
      m.all = filteredContributors.length;
      for (const cat of allCategories) {
        m[cat] = filteredContributors.filter((c) =>
          (byContributor.get(c) ?? []).some((i) => i.category === cat),
        ).length;
      }
    }
    return m;
  }, [activeContributor, byContributor, filteredContributors, allCategories]);

  const tabCategories = activeContributor ? drillCategories : allCategories;

  /* ── navigation ──────────────────────────────────────────────────── */
  const drillInto = (contributor: string) => {
    setActiveContributor(contributor);
    // Preserve the active category tab if the contributor actually has items in it,
    // otherwise fall back to "all"
    const contribItems = byContributor.get(contributor) ?? [];
    const hasTab = activeTab !== "all" && contribItems.some((i) => i.category === activeTab);
    if (!hasTab) setActiveTab("all");
    setQuery("");
  };
  const goBack = () => {
    setActiveContributor(null); setActiveTab("all"); setQuery("");
  };

  /* ── actions ─────────────────────────────────────────────────────── */
  const handleSync = async () => {
    const a = api(); if (!a) return;
    setSyncing(true); setSyncResults([]);
    try {
      setSyncResults(await a.marketplaceSync());
      await loadItems();
      await loadInstalledIndex();
    } catch (e: any) {
      setSyncResults([{ source: "?", status: "error", message: e.message }]);
    } finally { setSyncing(false); }
  };

  const handleInstall = async (item: MarketplaceItemInfo) => {
    const a = api(); if (!a) return;
    const k = ikey(item); setBusy(k);
    try {
      const r = await a.marketplaceInstall({ category: item.category, contributor: item.contributor, name: item.name, localPath: item.localPath });
      flash(r.message); await loadItems(); await loadInstalledIndex();
      if (item.category === "tools") a.notifyToolsChanged?.();
    } catch (e: any) { flash(`Error: ${e.message}`); }
    finally { setBusy(null); }
  };

  const handleUninstall = async (item: MarketplaceItemInfo) => {
    const a = api(); if (!a) return;
    const k = ikey(item); setBusy(k);
    try {
      const r = await a.marketplaceUninstall({ category: item.category, contributor: item.contributor, name: item.name });
      flash(r.message); await loadItems(); await loadInstalledIndex();
    } catch (e: any) { flash(`Error: ${e.message}`); }
    finally { setBusy(null); }
  };

  const handleAddSource = async () => {
    const a = api(); if (!a || !newName.trim() || !newUrl.trim()) return;
    await a.marketplaceSourceAdd({ name: newName.trim(), url: newUrl.trim(), branch: newBranch.trim() || "main", enabled: true });
    setNewName(""); setNewUrl(""); setNewBranch("main");
    await loadSources(); flash(`Added source: ${newName.trim()}`);
  };

  const handleRemoveSource = async (name: string) => {
    const a = api(); if (!a) return;
    await a.marketplaceSourceRemove(name); await loadSources(); flash(`Removed: ${name}`);
  };

  const handleToggleSource = async (name: string, en: boolean) => {
    const a = api(); if (!a) return;
    await a.marketplaceSourceToggle(name, en); await loadSources();
  };

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  /* ── render ──────────────────────────────────────────────────────── */
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: t.text, overflow: "hidden" }}>

      {/* ▸ HEADER ──────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 0 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {activeContributor && (
            <button onClick={goBack} style={{
              background: "none", border: `1px solid ${t.border}`, color: t.subtext,
              borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: "0.82rem",
            }}>
              ← Back
            </button>
          )}
          <div>
            {activeContributor ? (
              <>
                <div style={{ fontSize: "0.76rem", color: t.dim, marginBottom: 2 }}>
                  <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={goBack}>Marketplace</span>
                  {" / "}
                  <span style={{ color: t.accent }}>{activeContributor}</span>
                </div>
                <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{activeContributor}</h1>
              </>
            ) : (
              <>
                <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Marketplace</h1>
                <p style={{ margin: "2px 0 0", color: t.subtext, fontSize: "0.84rem" }}>
                  {allContributors.length} contributor{allContributors.length !== 1 ? "s" : ""} · {items.length} extension{items.length !== 1 ? "s" : ""}
                </p>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn variant="ghost" onClick={() => setShowSources((v) => !v)}>
            {showSources ? "✕ Close" : "⚙ Sources"}
          </Btn>
          <Btn variant="accent" onClick={handleSync} disabled={syncing}>
            {syncing ? <><Spinner /> Syncing…</> : "↻ Sync All"}
          </Btn>
          <Btn variant="ghost" onClick={() => handleUpdate()} disabled={syncing}>
            Check updates
          </Btn>
          <label style={{ display: "flex", alignItems: "center", gap: 4, color: t.subtext, fontSize: "0.84rem" }}>
            <input type="checkbox" checked={globalAutoUpdate} onChange={(e) => handleGlobalAutoToggle(e.target.checked)}
              style={{ accentColor: t.accent, width: 14, height: 14 }} />
            auto‑update
          </label>
        </div>
      </div>

      {/* ▸ TOAST ───────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 28, right: 28, background: t.card, color: t.text,
          padding: "11px 22px", borderRadius: 10, border: `1px solid ${t.accent}`,
          boxShadow: `0 8px 28px ${t.overlay}90`, zIndex: 9999, fontSize: "0.86rem",
          maxWidth: 380, animation: "fadeIn .2s ease",
        }}>
          {toast}
        </div>
      )}

      {/* ▸ SYNC RESULTS ────────────────────────────────────────────── */}
      {syncResults.length > 0 && (
        <div style={{ flexShrink: 0, marginBottom: 16, padding: "12px 16px", background: t.surface, borderRadius: 10, border: `1px solid ${t.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>Sync Results</span>
            <Btn variant="ghost" style={{ padding: "1px 8px", fontSize: "0.74rem" }} onClick={() => setSyncResults([])}>Dismiss</Btn>
          </div>
          {syncResults.map((r, i) => (
            <div key={i} style={{ fontSize: "0.84rem", padding: "2px 0", color: r.status === "error" ? t.danger : t.success }}>
              {r.status === "error" ? "✗" : "✓"} <b>{r.source}</b> — <span style={{ color: t.subtext }}>{r.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ▸ SOURCES PANEL ───────────────────────────────────────────── */}
      {showSources && (
        <div style={{ flexShrink: 0, marginBottom: 18, padding: 18, background: t.surface, borderRadius: 12, border: `1px solid ${t.border}` }}>
          <h2 style={{ margin: "0 0 4px", fontSize: "1.05rem", fontWeight: 600 }}>Marketplace Sources</h2>
          <p style={{ color: t.dim, fontSize: "0.82rem", margin: "0 0 14px" }}>Git repos containing SolixAI extensions.</p>
          {sources.map((s) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", marginBottom: 6, background: t.card, borderRadius: 8, border: `1px solid ${t.border}` }}>
              <input type="checkbox" checked={s.enabled} onChange={(e) => handleToggleSource(s.name, e.target.checked)}
                style={{ accentColor: t.accent, width: 15, height: 15, cursor: "pointer" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{s.name}</div>
                <div style={{ fontSize: "0.75rem", color: t.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.url} <span style={{ color: t.subtext }}>({s.branch ?? "main"})</span>
                </div>
              </div>
              <Btn variant="danger" style={{ padding: "3px 10px", fontSize: "0.76rem" }} onClick={() => handleRemoveSource(s.name)}>Remove</Btn>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <MiniInput value={newName} onChange={setNewName} placeholder="Name" style={{ flex: 1 }} />
            <MiniInput value={newUrl} onChange={setNewUrl} placeholder="Git URL (https://…)" style={{ flex: 2 }} />
            <MiniInput value={newBranch} onChange={setNewBranch} placeholder="Branch" style={{ flex: "0 0 80px" }} />
            <Btn variant="accent" onClick={handleAddSource}>+ Add</Btn>
          </div>
        </div>
      )}

      {/* ▸ SEARCH ──────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, marginBottom: 14 }}>
        <div style={{ position: "relative", maxWidth: 520 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: t.dim, pointerEvents: "none", fontSize: "0.88rem" }}>🔍</span>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={activeContributor ? `Search ${activeContributor}'s extensions…` : "Search contributors…"}
            style={{
              width: "100%", boxSizing: "border-box", padding: "10px 16px 10px 38px",
              borderRadius: 10, border: `1px solid ${t.border}`, background: t.surface,
              color: t.text, fontSize: "0.88rem", outline: "none", transition: "border-color .15s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = t.accent; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = t.border; }}
          />
        </div>
      </div>

      {/* ▸ CATEGORY TABS ───────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, display: "flex", gap: 0, marginBottom: 18, borderBottom: `1px solid ${t.border}`, overflowX: "auto" }}>
        <TabBtn label="All" count={tabCounts.all ?? 0} active={activeTab === "all"} onClick={() => setActiveTab("all")} />
        {tabCategories.map((cat) => (
          <TabBtn key={cat} label={prettyCat(cat)} count={tabCounts[cat] ?? 0} active={activeTab === cat} onClick={() => setActiveTab(cat)} />
        ))}
      </div>

      {/* ▸ CONTENT ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 24 }}>
        {loading || syncing ? (
          <SkeletonGrid itemCards={!!activeContributor} />
        ) : activeContributor ? (
          drillItems.length === 0 ? (
            <EmptyMsg>No extensions match your search.</EmptyMsg>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
              {drillItems.map((item) => (
                <ItemCard key={ikey(item)} item={item} busy={busy === ikey(item)}
                  onInstall={() => handleInstall(item)} onUninstall={() => handleUninstall(item)}
                  onUpdate={() => handleUpdate(item)}
                  onAutoToggle={(en) => handleItemAutoToggle(item, en)} />
              ))}
            </div>
          )
        ) : items.length === 0 ? (
          <EmptyState />
        ) : filteredContributors.length === 0 ? (
          <EmptyMsg>No contributors match your search.</EmptyMsg>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {filteredContributors.map((contrib) => (
              <ContributorCard
                key={contrib}
                contributor={contrib}
                items={byContributor.get(contrib)!}
                onClick={() => drillInto(contrib)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Contributor card ────────────────────────────────────────────────── */
function ContributorCard({ contributor, items, onClick }: {
  contributor: string; items: MarketplaceItemInfo[]; onClick: () => void;
}) {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };
  const [hovered, setHovered] = useState(false);
  const installedCount = items.filter((i) => i.installed).length;
  const cats = Array.from(new Set(items.map((i) => i.category)));
  const preview = items.slice(0, 4);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? t.cardHover : t.card,
        borderRadius: 14, border: `1px solid ${hovered ? t.borderHover : t.border}`,
        padding: 20, cursor: "pointer",
        transition: "background .12s, border-color .15s",
        display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      {/* avatar + counts */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: "rgba(203,166,247,0.14)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: "1.1rem", color: t.accent,
        }}>
          {contributor.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "2px 9px", borderRadius: 14, background: t.accent, color: "#1e1e2e" }}>
            {items.length} extension{items.length !== 1 ? "s" : ""}
          </span>
          {installedCount > 0 && (
            <span style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 7px", borderRadius: 14, background: `${t.success}20`, color: t.success }}>
              {installedCount} installed
            </span>
          )}
        </div>
      </div>

      {/* name */}
      <div style={{ fontWeight: 700, fontSize: "0.96rem" }}>{contributor}</div>

      {/* category pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {cats.map((c) => (
          <span key={c} style={{
            fontSize: "0.68rem", fontWeight: 600, padding: "2px 8px", borderRadius: 10,
            background: catColor(c) + "22", color: catColor(c), border: `1px solid ${catColor(c)}40`,
          }}>
            {prettyCat(c)}
          </span>
        ))}
      </div>

      {/* item name preview */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {preview.map((i) => (
          <span key={i.name} style={{
            fontSize: "0.71rem", padding: "2px 8px", borderRadius: 8,
            background: t.surface, color: t.subtext, border: `1px solid ${t.border}`,
          }}>
            {i.name}
          </span>
        ))}
        {items.length > 4 && (
          <span style={{ fontSize: "0.71rem", padding: "2px 8px", borderRadius: 8, color: t.dim }}>
            +{items.length - 4} more
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Item card (drill-down) ──────────────────────────────────────────── */
function ItemCard({ item, busy, onInstall, onUninstall, onUpdate, onAutoToggle }: {
  item: MarketplaceItemInfo;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onUpdate?: () => void;
  onAutoToggle?: (enabled: boolean) => void;
}) {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };
  const [hovered, setHovered] = useState(false);
  const color = catColor(item.category);
  return (
    <div
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? t.cardHover : t.card,
        borderRadius: 12, border: `1px solid ${hovered ? t.borderHover : t.border}`,
        padding: "18px 18px 14px", display: "flex", flexDirection: "column",
        justifyContent: "space-between", minHeight: 150,
        transition: "background .12s, border-color .15s",
      }}
    >
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: "0.96rem", lineHeight: 1.3 }}>{item.name}</span>
          <span style={{
            flexShrink: 0, padding: "2px 9px", borderRadius: 14, fontSize: "0.7rem",
            fontWeight: 700, textTransform: "capitalize", background: color, color: "#1e1e2e",
          }}>{prettyCat(item.category)}</span>
        </div>
        {item.source !== "Official SolixAI" && (
          <span style={{ fontSize: "0.7rem", padding: "0 6px", borderRadius: 4, background: t.surface, color: t.dim, marginBottom: 6, display: "inline-block" }}>
            {item.source}
          </span>
        )}
        {item.description && (
          <p style={{
            fontSize: "0.84rem", color: t.subtext, margin: "6px 0 0", lineHeight: 1.45,
            display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {item.description}
          </p>
        )}
      </div>
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {item.installed ? (
          <>
            <span style={{ padding: "3px 10px", borderRadius: 14, fontSize: "0.74rem", fontWeight: 700, background: `${t.success}18`, color: t.success }}>
              ✓ Installed
            </span>
            {item.needsUpdate && onUpdate && (
              <Btn variant="accent" style={{ padding: "4px 12px", fontSize: "0.78rem" }} onClick={onUpdate} disabled={busy}>
                {busy ? "…" : "Update"}
              </Btn>
            )}
            <Btn variant="danger" style={{ padding: "4px 12px", fontSize: "0.78rem" }} onClick={onUninstall} disabled={busy}>
              {busy ? "…" : "Uninstall"}
            </Btn>
            {onAutoToggle && (
              <label style={{ fontSize: "0.72rem", marginLeft: 8, display: "flex", alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={!!item.autoUpdate} onChange={(e) => onAutoToggle(e.target.checked)}
                  style={{ accentColor: t.accent }} /> auto‑update
              </label>
            )}
          </>
        ) : (
          <Btn variant="accent" onClick={onInstall} disabled={busy}>
            {busy ? <><Spinner /> Installing…</> : "Install"}
          </Btn>
        )}
      </div>
    </div>
  );
}

/* ── Tab button ──────────────────────────────────────────────────────── */
function TabBtn({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };
  return (
    <button onClick={onClick} style={{
      padding: "8px 18px", background: "transparent", border: "none",
      borderBottom: active ? `2px solid ${t.accent}` : "2px solid transparent",
      color: active ? t.accent : t.dim, fontWeight: active ? 700 : 500,
      fontSize: "0.86rem", cursor: "pointer", transition: "color .12s, border-color .12s",
      display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
    }}>
      {label}
      <span style={{
        fontSize: "0.68rem", padding: "1px 6px", borderRadius: 8, fontWeight: 700,
        background: active ? t.accent : t.border, color: active ? "#1e1e2e" : t.dim,
      }}>{count}</span>
    </button>
  );
}

/* ── Skeleton grid ───────────────────────────────────────────────────── */
function SkeletonGrid({ itemCards }: { itemCards: boolean }) {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${itemCards ? 280 : 260}px, 1fr))`, gap: 14 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{
          background: t.card, borderRadius: 12, border: `1px solid ${t.border}`,
          padding: 18, minHeight: itemCards ? 150 : 170, animation: "pulse 1.5s ease-in-out infinite",
        }}>
          <div style={{ width: "50%", height: 14, borderRadius: 6, background: t.border, marginBottom: 12 }} />
          <div style={{ width: "30%", height: 10, borderRadius: 6, background: t.border, marginBottom: 16 }} />
          <div style={{ width: "85%", height: 10, borderRadius: 6, background: t.border, marginBottom: 8 }} />
          <div style={{ width: "65%", height: 10, borderRadius: 6, background: t.border }} />
        </div>
      ))}
    </div>
  );
}

/* ── Empty states ────────────────────────────────────────────────────── */
function EmptyState() {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };
  return (
    <div style={{ textAlign: "center", padding: "4rem 1rem", color: t.dim }}>
      <p style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: 6 }}>Welcome to the Marketplace</p>
      <p style={{ fontSize: "0.88rem", maxWidth: 400, margin: "0 auto 14px", color: t.subtext }}>
        Click <b style={{ color: t.accent }}>Sync All</b> to fetch extensions from your configured sources.
      </p>
      <p style={{ fontSize: "0.78rem" }}>Use <b>Sources</b> to add or manage repositories.</p>
    </div>
  );
}
function EmptyMsg({ children }: { children: React.ReactNode }) {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };
  return (
    <div style={{ textAlign: "center", padding: "3rem 1rem", color: t.dim }}>
      <p style={{ fontSize: "1rem", fontWeight: 500 }}>{children}</p>
    </div>
  );
}

/* ── Spinner ─────────────────────────────────────────────────────────── */
function Spinner() {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };
  return <span style={{
    display: "inline-block", width: 13, height: 13, marginRight: 4,
    border: `2px solid ${t.dim}`, borderTopColor: t.accent,
    borderRadius: "50%", animation: "spin .55s linear infinite",
  }} />;
}

/* ── Shared button ───────────────────────────────────────────────────── */
function Btn({ variant, children, style, ...rest }: {
  variant: "accent" | "ghost" | "danger"; children: React.ReactNode; style?: React.CSSProperties;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
    padding: "7px 18px", borderRadius: 8, fontSize: "0.84rem", fontWeight: 700,
    border: "none", transition: "opacity .12s",
    ...(variant === "accent" ? { background: t.accent, color: "#1e1e2e" } :
      variant === "danger" ? { background: t.danger, color: "#1e1e2e" } :
      { background: "transparent", border: `1px solid ${t.border}`, color: t.subtext }),
    ...style,
  };
  return <button style={base} {...rest}>{children}</button>;
}

/* ── Mini input (sources form) ───────────────────────────────────────── */
function MiniInput({ value, onChange, placeholder, style }: {
  value: string; onChange: (v: string) => void; placeholder: string; style?: React.CSSProperties;
}) {
  const { palette: P } = useTheme();
  const t = { bg: P.base, surface: P.mantle, card: P.surface0, cardHover: P.surface1, border: P.surface1, borderHover: P.mauve, accent: P.mauve, danger: P.red, success: P.green, muted: P.surface2, text: P.text, subtext: P.subtext0, dim: P.overlay0, overlay: P.crust };
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
        background: t.card, color: t.text, fontSize: "0.86rem", outline: "none", ...style }} />
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */
function ikey(i: MarketplaceItemInfo) { return `${i.source}::${i.category}/${i.contributor}/${i.name}`; }
function prettyCat(c: string) { return c.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()); }
