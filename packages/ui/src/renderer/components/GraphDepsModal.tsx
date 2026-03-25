/**
 * GraphDepsModal
 *
 * Shown when a user tries to install a graph from the marketplace and that
 * graph has tool / skill / agent dependencies that are not yet installed.
 *
 * The modal lets the user:
 *  - See which dependencies are satisfied (green) vs missing (red/yellow)
 *  - Select which missing tools / skills to install from the marketplace
 *  - Click "Install Selected & Add Graph" to install the deps then add the graph
 *  - Or "Add Graph Anyway" if they want to skip dep installation
 */

import React, { useEffect, useState, useMemo } from "react";
import type { GraphDefinitionInfo, GraphDepsResultInfo, MarketplaceItemInfo } from "../global.js";
import { useTheme } from "../theme/ThemeContext.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraphDepsModalProps {
  /** The graph that is being installed. */
  graph: GraphDefinitionInfo;
  /** Dependency check result for this graph. */
  deps: GraphDepsResultInfo;
  /** Full list of marketplace items (already loaded by MarketplaceView). */
  availableItems: MarketplaceItemInfo[];
  /** Called when the user confirms.  `selectedItems` are the marketplace items
   *  to install before saving the graph.  May be empty if the user chose to
   *  skip dep installation.  `skipDeps` is true when the user hit "Add Anyway". */
  onConfirm(selection: { items: MarketplaceItemInfo[]; skipDeps: boolean }): void;
  /** Called when the user cancels the whole operation. */
  onCancel(): void;
}

// ── Helper ────────────────────────────────────────────────────────────────────

/** Given a dep name (bare or contributor/name) find a matching marketplace item. */
function matchDep(
  depName: string,
  category: "tools" | "skills",
  items: MarketplaceItemInfo[],
): MarketplaceItemInfo | undefined {
  return items.find((it) => {
    if (it.category !== category) return false;
    const qn = `${it.contributor}/${it.name}`;
    return it.name === depName || qn === depName;
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ ok }: { ok: boolean }) {
  const { palette: P } = useTheme();
  return (
    <span style={{
      flexShrink: 0,
      fontSize: "0.68rem",
      fontWeight: 700,
      padding: "1px 8px",
      borderRadius: 10,
      background: ok ? `${P.green}20` : `${P.red}20`,
      color: ok ? P.green : P.red,
    }}>
      {ok ? "✓ Installed" : "✗ Missing"}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  const { palette: P } = useTheme();
  return (
    <div style={{
      fontSize: "0.74rem",
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: P.subtext0,
      marginTop: 18,
      marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GraphDepsModal({
  graph,
  deps,
  availableItems,
  onConfirm,
  onCancel,
}: GraphDepsModalProps): React.JSX.Element {
  const { palette: P } = useTheme();

  // Build the list of marketplace items that match missing deps
  const missingToolItems = useMemo(
    () =>
      deps.missingTools.map((name) => ({
        name,
        item: matchDep(name, "tools", availableItems),
      })),
    [deps.missingTools, availableItems],
  );
  const missingSkillItems = useMemo(
    () =>
      deps.missingSkills.map((name) => ({
        name,
        item: matchDep(name, "skills", availableItems),
      })),
    [deps.missingSkills, availableItems],
  );

  // Checked state — keyed by dep name, default true when a marketplace item exists
  const [checkedTools, setCheckedTools] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const { name, item } of missingToolItems) init[name] = !!item;
    return init;
  });
  const [checkedSkills, setCheckedSkills] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const { name, item } of missingSkillItems) init[name] = !!item;
    return init;
  });

  // Re-initialise if deps change (shouldn't normally happen but be safe)
  useEffect(() => {
    const tools: Record<string, boolean> = {};
    for (const { name, item } of missingToolItems) tools[name] = !!item;
    setCheckedTools(tools);

    const skills: Record<string, boolean> = {};
    for (const { name, item } of missingSkillItems) skills[name] = !!item;
    setCheckedSkills(skills);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);

  const selectedItems = useMemo(() => {
    const out: MarketplaceItemInfo[] = [];
    for (const { name, item } of missingToolItems) {
      if (checkedTools[name] && item) out.push(item);
    }
    for (const { name, item } of missingSkillItems) {
      if (checkedSkills[name] && item) out.push(item);
    }
    return out;
  }, [checkedTools, checkedSkills, missingToolItems, missingSkillItems]);

  const handleInstallAndAdd = () => onConfirm({ items: selectedItems, skipDeps: false });
  const handleAddAnyway = () => onConfirm({ items: [], skipDeps: true });

  // ── Satisfied deps (for the "already installed" section) ────────────────
  const satisfiedTools = deps.tools.filter((t) => !deps.missingTools.includes(t));
  const satisfiedSkills = deps.skills.filter((s) => !deps.missingSkills.includes(s));

  const hasMissingDeps =
    deps.missingTools.length > 0 ||
    deps.missingSkills.length > 0 ||
    deps.missingAgents.length > 0;

  return (
    /* ── Backdrop ─────────────────────────────────────────────────────────── */
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      <div style={{
        background: P.mantle,
        border: `1px solid ${P.surface1}`,
        borderRadius: 16,
        width: 560,
        maxWidth: "92vw",
        maxHeight: "85vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: `0 24px 64px rgba(0,0,0,0.5)`,
        overflow: "hidden",
      }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{
          padding: "22px 24px 16px",
          borderBottom: `1px solid ${P.surface1}`,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "1.15rem", fontWeight: 700, color: P.text, marginBottom: 4 }}>
                Graph Dependencies
              </div>
              <div style={{ fontSize: "0.84rem", color: P.subtext0 }}>
                <span style={{ color: P.mauve, fontWeight: 600 }}>{graph.name}</span>
                {hasMissingDeps
                  ? " requires some tools or skills that are not yet installed."
                  : " — all dependencies are satisfied."}
              </div>
            </div>
            <button
              onClick={onCancel}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: P.overlay0, fontSize: "1.2rem", lineHeight: 1,
                padding: "2px 4px",
              }}
            >✕</button>
          </div>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 24px 20px" }}>

          {/* Missing tools */}
          {deps.missingTools.length > 0 && (
            <>
              <SectionLabel>Missing Tools</SectionLabel>
              {missingToolItems.map(({ name, item }) => (
                <DepRow
                  key={`tool:${name}`}
                  name={name}
                  category="tool"
                  marketplaceItem={item}
                  checked={!!checkedTools[name]}
                  onCheck={(v) => setCheckedTools((prev) => ({ ...prev, [name]: v }))}
                />
              ))}
            </>
          )}

          {/* Missing skills */}
          {deps.missingSkills.length > 0 && (
            <>
              <SectionLabel>Missing Skills</SectionLabel>
              {missingSkillItems.map(({ name, item }) => (
                <DepRow
                  key={`skill:${name}`}
                  name={name}
                  category="skill"
                  marketplaceItem={item}
                  checked={!!checkedSkills[name]}
                  onCheck={(v) => setCheckedSkills((prev) => ({ ...prev, [name]: v }))}
                />
              ))}
            </>
          )}

          {/* Missing agents (can't be auto-installed) */}
          {deps.missingAgents.length > 0 && (
            <>
              <SectionLabel>Required Agents</SectionLabel>
              <div style={{
                fontSize: "0.82rem", color: P.subtext0, marginBottom: 8,
                padding: "8px 12px", background: `${P.yellow}12`,
                borderRadius: 8, border: `1px solid ${P.yellow}40`,
              }}>
                ⚠ The following agents are referenced by this graph but do not exist locally.
                You can create them after installing — they cannot be installed from the marketplace.
              </div>
              {deps.missingAgents.map((name) => (
                <div key={name} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "9px 12px", marginBottom: 6,
                  background: P.surface0, borderRadius: 8, border: `1px solid ${P.surface1}`,
                }}>
                  <div style={{ fontWeight: 600, fontSize: "0.88rem", color: P.text }}>{name}</div>
                  <span style={{
                    fontSize: "0.68rem", fontWeight: 700, padding: "1px 8px",
                    borderRadius: 10, background: `${P.yellow}20`, color: P.yellow,
                  }}>
                    Create manually
                  </span>
                </div>
              ))}
            </>
          )}

          {/* Already-satisfied deps (collapsed summary) */}
          {(satisfiedTools.length > 0 || satisfiedSkills.length > 0) && (
            <>
              <SectionLabel>Already Installed</SectionLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  ...satisfiedTools.map((n) => ({ n, cat: "tool" })),
                  ...satisfiedSkills.map((n) => ({ n, cat: "skill" })),
                ].map(({ n, cat }) => (
                  <span key={`${cat}:${n}`} style={{
                    fontSize: "0.76rem", padding: "3px 10px", borderRadius: 10,
                    background: `${P.green}14`, color: P.green,
                    border: `1px solid ${P.green}30`,
                  }}>
                    ✓ {n}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* Agents satisfied */}
          {deps.agents.length > 0 && deps.missingAgents.length === 0 && (
            <>
              <SectionLabel>Required Agents</SectionLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {deps.agents.map((n) => (
                  <span key={n} style={{
                    fontSize: "0.76rem", padding: "3px 10px", borderRadius: 10,
                    background: `${P.green}14`, color: P.green,
                    border: `1px solid ${P.green}30`,
                  }}>
                    ✓ {n}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0,
          padding: "14px 24px",
          borderTop: `1px solid ${P.surface1}`,
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 18px", borderRadius: 8, cursor: "pointer",
              background: "none", border: `1px solid ${P.surface2}`,
              color: P.subtext0, fontSize: "0.86rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleAddAnyway}
            style={{
              padding: "8px 18px", borderRadius: 8, cursor: "pointer",
              background: P.surface0, border: `1px solid ${P.surface2}`,
              color: P.text, fontSize: "0.86rem",
            }}
          >
            Add Graph Anyway
          </button>
          {hasMissingDeps && selectedItems.length > 0 && (
            <button
              onClick={handleInstallAndAdd}
              style={{
                padding: "8px 20px", borderRadius: 8, cursor: "pointer",
                background: P.mauve, border: `1px solid ${P.mauve}`,
                color: "#1e1e2e", fontWeight: 700, fontSize: "0.86rem",
              }}
            >
              Install {selectedItems.length} dep{selectedItems.length !== 1 ? "s" : ""} & Add Graph
            </button>
          )}
          {(!hasMissingDeps || selectedItems.length === 0) && deps.allSatisfied && (
            <button
              onClick={() => onConfirm({ items: [], skipDeps: false })}
              style={{
                padding: "8px 20px", borderRadius: 8, cursor: "pointer",
                background: P.mauve, border: `1px solid ${P.mauve}`,
                color: "#1e1e2e", fontWeight: 700, fontSize: "0.86rem",
              }}
            >
              Add Graph
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DepRow sub-component ──────────────────────────────────────────────────────

function DepRow({
  name,
  category,
  marketplaceItem,
  checked,
  onCheck,
}: {
  name: string;
  category: "tool" | "skill";
  marketplaceItem: MarketplaceItemInfo | undefined;
  checked: boolean;
  onCheck: (v: boolean) => void;
}) {
  const { palette: P } = useTheme();
  const canInstall = !!marketplaceItem;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px", marginBottom: 6,
      background: P.surface0, borderRadius: 8,
      border: `1px solid ${canInstall ? P.surface1 : P.red + "40"}`,
    }}>
      {/* Checkbox — only shown when a marketplace item is available */}
      {canInstall ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          style={{ accentColor: P.mauve, width: 15, height: 15, cursor: "pointer", flexShrink: 0 }}
        />
      ) : (
        <span style={{ width: 15, flexShrink: 0, textAlign: "center", color: P.red, fontSize: "0.8rem" }}>✗</span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.88rem", color: P.text }}>{name}</div>
        {marketplaceItem ? (
          <div style={{ fontSize: "0.74rem", color: P.subtext0, marginTop: 1 }}>
            by {marketplaceItem.contributor}
            {marketplaceItem.description
              ? ` — ${marketplaceItem.description.slice(0, 80)}`
              : ""}
          </div>
        ) : (
          <div style={{ fontSize: "0.74rem", color: P.red, marginTop: 1 }}>
            Not found in marketplace — you will need to install this manually.
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {/* Category pill */}
        <span style={{
          fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 10,
          background: category === "tool" ? "#a6e3a122" : "#cba6f722",
          color: category === "tool" ? "#a6e3a1" : "#cba6f7",
        }}>
          {category}
        </span>
        <StatusPill ok={false} />
      </div>
    </div>
  );
}
