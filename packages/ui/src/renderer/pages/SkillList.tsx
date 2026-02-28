import React, { useEffect, useState, useMemo } from "react";

/* ── Catppuccin Mocha palette ─────────────────────────────────────── */
const c = {
  bg: "#1e1e2e",
  surface: "#181825",
  card: "#252536",
  cardHover: "#2e2e44",
  border: "#393952",
  borderHover: "#cba6f7",
  accent: "#cba6f7",
  muted: "#6c7086",
  text: "#cdd6f4",
  subtext: "#a6adc8",
  dim: "#585b70",
};

interface SkillInfo {
  frontmatter: { name: string; contributor: string; description: string };
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ position: "relative", maxWidth: 480 }}>
      <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: c.muted, pointerEvents: "none", fontSize: "0.88rem" }}>🔍</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 14px 9px 36px", borderRadius: 10,
          border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: "0.88rem", outline: "none" }}
        onFocus={(e) => { e.currentTarget.style.borderColor = c.accent; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = c.border; }}
      />
    </div>
  );
}

export function SkillList(): React.JSX.Element {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [search, setSearch] = useState("");
  const [activeContributor, setActiveContributor] = useState<string | null>(null);

  useEffect(() => {
    if (!window.solixApi) return;
    window.solixApi.listSkills().then(setSkills).catch(console.error);
  }, []);

  /* group by contributor */
  const byContributor = useMemo(() => {
    const m = new Map<string, SkillInfo[]>();
    for (const s of skills) {
      const key = s.frontmatter.contributor;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    return m;
  }, [skills]);

  const contributors = useMemo(() => Array.from(byContributor.keys()).sort(), [byContributor]);

  /* filtered for contributor view (search contributor name) */
  const filteredContributors = useMemo(() => {
    if (!search.trim()) return contributors;
    const q = search.toLowerCase();
    return contributors.filter((c) => c.toLowerCase().includes(q));
  }, [contributors, search]);

  /* filtered for drilled-down view (search skill name/desc) */
  const drillItems = useMemo(() => {
    const items = activeContributor ? (byContributor.get(activeContributor) ?? []) : [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (s) => s.frontmatter.name.toLowerCase().includes(q) || (s.frontmatter.description ?? "").toLowerCase().includes(q),
    );
  }, [activeContributor, byContributor, search]);

  const handleContributorClick = (name: string) => { setActiveContributor(name); setSearch(""); };
  const handleBack = () => { setActiveContributor(null); setSearch(""); };

  if (skills.length === 0) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", color: c.text }}>
        <h1 style={{ margin: "0 0 8px", fontSize: "1.6rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Skills</h1>
        <div style={{ textAlign: "center", padding: "4rem 1rem", color: c.muted, background: c.surface, borderRadius: 14, border: `1px solid ${c.border}` }}>
          <p style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: 6 }}>No skills installed</p>
          <p style={{ fontSize: "0.88rem" }}>Sync from the <strong style={{ color: c.accent }}>Marketplace</strong> or add skill files to <code style={{ color: c.subtext }}>~/.solix/skills</code>.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", color: c.text }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        {activeContributor && (
          <button onClick={handleBack} style={{ background: "none", border: `1px solid ${c.border}`, color: c.subtext, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 5 }}>
            ← Back
          </button>
        )}
        <div style={{ flex: 1 }}>
          {activeContributor ? (
            <>
              <div style={{ fontSize: "0.78rem", color: c.muted, marginBottom: 2 }}>
                <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={handleBack}>Skills</span>
                {" / "}
                <span style={{ color: c.accent }}>{activeContributor}</span>
              </div>
              <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{activeContributor}</h1>
            </>
          ) : (
            <>
              <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Skills</h1>
              <p style={{ margin: "2px 0 0", color: c.subtext, fontSize: "0.88rem" }}>
                {contributors.length} contributor{contributors.length !== 1 ? "s" : ""} · {skills.length} skill{skills.length !== 1 ? "s" : ""} installed
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Search ── */}
      <div style={{ marginBottom: 20 }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={activeContributor ? `Search ${activeContributor}'s skills…` : "Search contributors or skills…"}
        />
      </div>

      {/* ── Contributor grid ── */}
      {!activeContributor && (
        filteredContributors.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", color: c.muted }}>
            <p style={{ fontWeight: 500 }}>No contributors match your search</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {filteredContributors.map((contrib) => {
              const items = byContributor.get(contrib)!;
              return (
                <div key={contrib} onClick={() => handleContributorClick(contrib)}
                  style={{ background: c.card, borderRadius: 14, border: `1px solid ${c.border}`,
                    padding: 20, cursor: "pointer", transition: "background .12s, border-color .15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = c.cardHover; e.currentTarget.style.borderColor = c.borderHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = c.card; e.currentTarget.style.borderColor = c.border; }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(203,166,247,0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: 700, color: c.accent }}
                    >
                      {contrib.slice(0, 1).toUpperCase()}
                    </div>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "3px 9px", borderRadius: 14,
                      background: c.accent, color: "#1e1e2e" }}>
                      {items.length} skill{items.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: "0.96rem", marginBottom: 8 }}>{contrib}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {items.slice(0, 4).map((s) => (
                      <span key={s.frontmatter.name} style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 8,
                        background: c.surface, color: c.subtext, border: `1px solid ${c.border}` }}>
                        {s.frontmatter.name}
                      </span>
                    ))}
                    {items.length > 4 && (
                      <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 8, background: c.surface, color: c.muted }}>+{items.length - 4} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Skill detail grid ── */}
      {activeContributor && (
        drillItems.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", color: c.muted }}>
            <p style={{ fontWeight: 500 }}>No skills match your search</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
            {drillItems.map((s) => (
              <div key={s.frontmatter.name}
                style={{ background: c.card, borderRadius: 14, border: `1px solid ${c.border}`, padding: 18, transition: "border-color .15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = c.accent; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = c.border; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: "1rem" }}>{s.frontmatter.name}</span>
                  <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 600, background: c.accent, color: "#1e1e2e" }}>skill</span>
                </div>
                {s.frontmatter.description && (
                  <p style={{ fontSize: "0.86rem", color: c.subtext, margin: 0, lineHeight: 1.5 }}>{s.frontmatter.description}</p>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
