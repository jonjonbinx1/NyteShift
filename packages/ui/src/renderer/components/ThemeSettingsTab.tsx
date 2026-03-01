import React, { useState, useMemo } from "react";
import { useTheme } from "../theme/ThemeContext.js";
import {
  BUILTIN_THEMES,
  groupByContributor,
  createBlankCustomTheme,
  type ThemePalette,
  type CustomTheme,
  type ThemeDefinition,
} from "../theme/themes.js";

/* ─── Palette key labels for the color editor ────────────────────── */
const PALETTE_FIELDS: { key: keyof ThemePalette; label: string; group: string }[] = [
  { key: "base",     label: "Base",       group: "Backgrounds" },
  { key: "mantle",   label: "Mantle",     group: "Backgrounds" },
  { key: "crust",    label: "Crust",      group: "Backgrounds" },
  { key: "surface0", label: "Surface 0",  group: "Surfaces" },
  { key: "surface1", label: "Surface 1",  group: "Surfaces" },
  { key: "surface2", label: "Surface 2",  group: "Surfaces" },
  { key: "overlay0", label: "Overlay 0",  group: "Overlays" },
  { key: "overlay1", label: "Overlay 1",  group: "Overlays" },
  { key: "overlay2", label: "Overlay 2",  group: "Overlays" },
  { key: "text",     label: "Text",       group: "Text" },
  { key: "subtext0", label: "Subtext 0",  group: "Text" },
  { key: "subtext1", label: "Subtext 1",  group: "Text" },
  { key: "mauve",    label: "Mauve",      group: "Accents" },
  { key: "blue",     label: "Blue",       group: "Accents" },
  { key: "green",    label: "Green",      group: "Accents" },
  { key: "red",      label: "Red",        group: "Accents" },
  { key: "yellow",   label: "Yellow",     group: "Accents" },
  { key: "peach",    label: "Peach",      group: "Accents" },
  { key: "teal",     label: "Teal",       group: "Accents" },
];

/* ─── Mini preview component ─────────────────────────────────────── */
function ThemePreview({ palette, size = 48 }: { palette: ThemePalette; size?: number }) {
  const h = size;
  const w = Math.round(h * 1.5);
  return (
    <div style={{
      width: w, height: h, borderRadius: 6, overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
      display: "flex", flexDirection: "column",
    }}>
      {/* Title bar */}
      <div style={{ height: "25%", background: palette.mantle, display: "flex", alignItems: "center", paddingLeft: 4, gap: 2 }}>
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: palette.red }} />
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: palette.yellow }} />
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: palette.green }} />
      </div>
      {/* Body */}
      <div style={{ flex: 1, background: palette.base, display: "flex" }}>
        <div style={{ width: "28%", background: palette.mantle }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 2, gap: 1 }}>
          <div style={{ height: 3, width: "70%", borderRadius: 1, background: palette.text, opacity: 0.6 }} />
          <div style={{ height: 2, width: "50%", borderRadius: 1, background: palette.subtext0, opacity: 0.5 }} />
          <div style={{ flex: 1 }} />
          <div style={{ height: 4, width: "40%", borderRadius: 2, background: palette.mauve, alignSelf: "flex-end" }} />
        </div>
      </div>
    </div>
  );
}

/* ─── Main tab component ─────────────────────────────────────────── */
export function ThemeSettingsTab(): React.JSX.Element {
  const { palette: C, current, customThemes, setThemeById, saveCustomTheme, deleteCustomTheme } = useTheme();

  const [editingTheme, setEditingTheme] = useState<CustomTheme | null>(null);
  const [newName, setNewName] = useState("");

  const byContributor = useMemo(() => groupByContributor(BUILTIN_THEMES), []);
  const contributors = useMemo(() => Object.keys(byContributor), [byContributor]);

  /* ── Section styles ────────────────────────────────────────────── */
  const sectionStyle: React.CSSProperties = {
    background: C.mantle, borderRadius: 10, padding: "16px 18px",
    display: "flex", flexDirection: "column", gap: 14,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.subtext0,
    marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.07em",
    display: "block",
  };
  const inputStyle: React.CSSProperties = {
    background: C.surface0, border: `1px solid ${C.surface1}`,
    borderRadius: 6, padding: "7px 10px", color: C.text,
    fontSize: 13, outline: "none", fontFamily: "inherit",
    width: "100%", boxSizing: "border-box",
  };

  /* ── Card for a single theme ───────────────────────────────────── */
  const renderThemeCard = (theme: ThemeDefinition, isCustom = false) => {
    const active = current.id === theme.id;
    return (
      <button
        key={theme.id}
        onClick={() => setThemeById(theme.id)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 14px", borderRadius: 10,
          border: `1.5px solid ${active ? C.mauve : C.surface1}`,
          background: active ? `${C.mauve}18` : C.surface0,
          cursor: "pointer", textAlign: "left", width: "100%",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <ThemePreview palette={theme.palette} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? C.mauve : C.text }}>
            {theme.name}
          </div>
          {theme.description && (
            <div style={{ fontSize: 11, color: C.subtext0, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {theme.description}
            </div>
          )}
        </div>
        {active && <span style={{ fontSize: 14, color: C.mauve, flexShrink: 0 }}>✓</span>}
        {isCustom && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setEditingTheme(theme as CustomTheme); }}
              style={{
                background: C.surface0, border: `1px solid ${C.surface1}`,
                borderRadius: 5, padding: "3px 8px", color: C.subtext0,
                cursor: "pointer", fontSize: 11,
              }}
            >✏️</button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete custom theme "${theme.name}"?`)) deleteCustomTheme(theme.id);
              }}
              style={{
                background: C.surface0, border: `1px solid ${C.surface1}`,
                borderRadius: 5, padding: "3px 8px", color: C.red,
                cursor: "pointer", fontSize: 11,
              }}
            >🗑</button>
          </div>
        )}
      </button>
    );
  };

  /* ── Color editor for custom themes ────────────────────────────── */
  if (editingTheme) {
    const groups = PALETTE_FIELDS.reduce<Record<string, typeof PALETTE_FIELDS>>((acc, f) => {
      (acc[f.group] ??= []).push(f);
      return acc;
    }, {});

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => setEditingTheme(null)}
            style={{
              background: C.surface0, border: `1px solid ${C.surface1}`,
              borderRadius: 6, padding: "6px 12px", color: C.subtext0,
              cursor: "pointer", fontSize: 12,
            }}
          >← Back</button>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: C.text }}>Edit: {editingTheme.name}</h3>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: C.subtext0 }}>
              Adjust each color using the picker. Changes are saved when you click Apply.
            </p>
          </div>
        </div>

        {/* Theme name */}
        <div style={sectionStyle}>
          <div>
            <label style={labelStyle}>Theme Name</label>
            <input
              value={editingTheme.name}
              onChange={(e) => setEditingTheme({ ...editingTheme, name: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <input
              value={editingTheme.description ?? ""}
              onChange={(e) => setEditingTheme({ ...editingTheme, description: e.target.value })}
              placeholder="Optional description…"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Live preview */}
        <div style={sectionStyle}>
          <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>Preview</h4>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ThemePreview palette={editingTheme.palette} size={64} />
            {/* Color swatches row */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {Object.entries(editingTheme.palette).map(([key, val]) => (
                <div
                  key={key}
                  title={key}
                  style={{
                    width: 18, height: 18, borderRadius: 4,
                    background: val, border: "1px solid rgba(255,255,255,0.08)",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Color groups */}
        {Object.entries(groups).map(([groupName, fields]) => (
          <div key={groupName} style={sectionStyle}>
            <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>{groupName}</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {fields.map((field) => (
                <div key={field.key}>
                  <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: 3,
                      background: editingTheme.palette[field.key],
                      border: "1px solid rgba(255,255,255,0.1)",
                      flexShrink: 0,
                    }} />
                    {field.label}
                  </label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="color"
                      value={editingTheme.palette[field.key]}
                      onChange={(e) =>
                        setEditingTheme({
                          ...editingTheme,
                          palette: { ...editingTheme.palette, [field.key]: e.target.value },
                        })
                      }
                      style={{
                        width: 36, height: 32, padding: 0, border: `1px solid ${C.surface1}`,
                        borderRadius: 4, background: "transparent", cursor: "pointer",
                      }}
                    />
                    <input
                      value={editingTheme.palette[field.key]}
                      onChange={(e) =>
                        setEditingTheme({
                          ...editingTheme,
                          palette: { ...editingTheme.palette, [field.key]: e.target.value },
                        })
                      }
                      style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 12 }}
                      maxLength={7}
                      placeholder="#000000"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={() => setEditingTheme(null)}
            style={{
              padding: "8px 20px", borderRadius: 8, border: `1px solid ${C.surface1}`,
              background: "transparent", color: C.subtext0, cursor: "pointer", fontSize: 13,
            }}
          >Cancel</button>
          <button
            onClick={() => {
              saveCustomTheme(editingTheme);
              setThemeById(editingTheme.id);
              setEditingTheme(null);
            }}
            style={{
              padding: "8px 24px", borderRadius: 8, border: "none",
              background: C.mauve, color: C.crust, fontWeight: 700,
              cursor: "pointer", fontSize: 13,
            }}
          >Apply Theme</button>
        </div>
      </div>
    );
  }

  /* ── Main browsing view ────────────────────────────────────────── */
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <h3 style={{ margin: "0 0 6px", fontSize: 14, color: C.text }}>Themes</h3>
        <p style={{ margin: "0 0 4px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
          Choose a built-in theme or create your own. The selected theme is applied
          instantly and persisted across restarts.
        </p>
        <p style={{ margin: 0, fontSize: 11, color: C.overlay0 }}>
          Active: <strong style={{ color: C.mauve }}>{current.name}</strong>
          <span style={{ marginLeft: 8, color: C.overlay0 }}>by {current.contributor}</span>
        </p>
      </div>

      {/* ── Built-in themes by contributor ── */}
      {contributors.map((contrib) => (
        <div key={contrib} style={sectionStyle}>
          <h4 style={{ margin: 0, fontSize: 13, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: C.mauve,
              display: "inline-block",
            }} />
            {contrib}
            <span style={{ fontSize: 11, fontWeight: 400, color: C.overlay0 }}>
              ({byContributor[contrib].length} {byContributor[contrib].length === 1 ? "theme" : "themes"})
            </span>
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {byContributor[contrib].map((t) => renderThemeCard(t))}
          </div>
        </div>
      ))}

      {/* ── Custom themes ── */}
      <div style={sectionStyle}>
        <h4 style={{ margin: 0, fontSize: 13, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%", background: C.teal,
            display: "inline-block",
          }} />
          Custom Themes
          <span style={{ fontSize: 11, fontWeight: 400, color: C.overlay0 }}>
            ({customThemes.length})
          </span>
        </h4>

        {customThemes.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {customThemes.map((t) => renderThemeCard(t, true))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: C.overlay0 }}>
            No custom themes yet. Create one below!
          </p>
        )}

        {/* New theme creator */}
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-end",
          borderTop: `1px solid ${C.surface0}`, paddingTop: 14,
        }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>New Theme Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My awesome theme…"
              style={inputStyle}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  const t = createBlankCustomTheme(newName.trim());
                  saveCustomTheme(t);
                  setNewName("");
                  setEditingTheme(t);
                }
              }}
            />
          </div>
          <button
            disabled={!newName.trim()}
            onClick={() => {
              const t = createBlankCustomTheme(newName.trim());
              saveCustomTheme(t);
              setNewName("");
              setEditingTheme(t);
            }}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: newName.trim() ? C.teal : C.surface1,
              color: newName.trim() ? C.crust : C.overlay0,
              fontWeight: 700, cursor: newName.trim() ? "pointer" : "not-allowed",
              fontSize: 13, whiteSpace: "nowrap",
              transition: "background 0.15s",
            }}
          >+ Create</button>
        </div>
      </div>
    </div>
  );
}
