import React, { useEffect, useState } from "react";
import type { ConfigFieldDefinitionInfo } from "../global.js";
import { useTheme } from "../theme/ThemeContext.js";

// ── Props ────────────────────────────────────────────────────────────────────

export interface SkillToolConfigModalProps {
  /** "skill" or "tool" */
  kind: "skill" | "tool";
  /** Qualified name, e.g. "base/search" */
  qualifiedName: string;
  /** Human-readable display label */
  displayName: string;
  /** Field definitions declared by the skill/tool */
  fields: ConfigFieldDefinitionInfo[];
  /** Available agent names for scope selector */
  agents?: string[];
  /** Called when modal is dismissed */
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function SkillToolConfigModal({
  kind,
  qualifiedName,
  displayName,
  fields,
  agents,
  onClose,
}: SkillToolConfigModalProps): React.JSX.Element {
  const { palette: C } = useTheme();

  // ── Styles ──────────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    background: C.surface0, border: `1px solid ${C.surface1}`, borderRadius: 6,
    padding: "7px 10px", color: C.text, fontSize: 13, outline: "none",
    fontFamily: "inherit", width: "100%", boxSizing: "border-box",
  };
  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer", appearance: "auto" as any };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.subtext0, marginBottom: 4,
    textTransform: "uppercase", letterSpacing: "0.07em", display: "block",
  };
  const sectionStyle: React.CSSProperties = {
    background: C.mantle, borderRadius: 10, padding: "16px 18px",
    display: "flex", flexDirection: "column", gap: 16,
  };

  // Scope: "global" or a specific agent name
  const [scope, setScope] = useState<string>("global");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Load values when scope changes ──────────────────────────────────
  useEffect(() => {
    if (!window.solixApi) return;
    setLoading(true);
    const agentName = scope === "global" ? undefined : scope;
    window.solixApi
      .skillToolConfigRead(kind, qualifiedName, agentName)
      .then((v) => {
        setValues(v ?? {});
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load config:", err);
        setValues({});
        setLoading(false);
      });
  }, [kind, qualifiedName, scope]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Helpers ──────────────────────────────────────────────────────────
  const setValue = (key: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const getVal = (key: string, defaultVal?: unknown): any => {
    const v = values[key];
    if (v !== undefined && v !== null) return v;
    return defaultVal ?? "";
  };

  const handleSave = async () => {
    if (!window.solixApi) return;
    setSaving(true);
    try {
      const agentName = scope === "global" ? undefined : scope;
      await window.solixApi.skillToolConfigWrite(kind, qualifiedName, values, agentName);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("Failed to save config:", err);
    } finally {
      setSaving(false);
    }
  };

  // ── Render a single field ────────────────────────────────────────────
  const renderField = (field: ConfigFieldDefinitionInfo) => {
    const val = getVal(field.key, field.default);

    switch (field.type) {
      case "string":
        return (
          <input
            style={inputStyle}
            value={String(val ?? "")}
            onChange={(e) => setValue(field.key, e.target.value)}
            placeholder={field.placeholder ?? ""}
          />
        );

      case "secret":
        return (
          <div style={{ display: "flex", gap: 6 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              type={showSecrets[field.key] ? "text" : "password"}
              value={String(val ?? "")}
              onChange={(e) => setValue(field.key, e.target.value)}
              placeholder={field.placeholder ?? "sk-…"}
            />
            <button
              type="button"
              onClick={() =>
                setShowSecrets((prev) => ({
                  ...prev,
                  [field.key]: !prev[field.key],
                }))
              }
              style={{
                background: C.surface0,
                border: `1px solid ${C.surface1}`,
                borderRadius: 6,
                padding: "6px 12px",
                color: C.subtext0,
                cursor: "pointer",
                fontSize: 11,
                whiteSpace: "nowrap",
              }}
            >
              {showSecrets[field.key] ? "Hide" : "Show"}
            </button>
          </div>
        );

      case "number":
        return (
          <div>
            {field.min !== undefined && field.max !== undefined ? (
              <>
                <input
                  type="range"
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 1}
                  value={Number(val ?? field.min)}
                  onChange={(e) => setValue(field.key, Number(e.target.value))}
                  style={{ width: "100%", accentColor: C.mauve }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 10,
                    color: C.overlay0,
                    marginTop: 3,
                  }}
                >
                  <span>{field.min}</span>
                  <span style={{ color: C.mauve, fontWeight: 700 }}>
                    {String(val ?? field.default ?? field.min)}
                  </span>
                  <span>{field.max}</span>
                </div>
              </>
            ) : (
              <input
                type="number"
                style={{ ...inputStyle, width: 140 }}
                value={String(val ?? "")}
                onChange={(e) =>
                  setValue(field.key, e.target.value === "" ? "" : Number(e.target.value))
                }
                min={field.min}
                max={field.max}
                step={field.step}
                placeholder={field.placeholder}
              />
            )}
          </div>
        );

      case "boolean":
        return (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
            }}
          >
            <div
              onClick={() => setValue(field.key, !val)}
              style={{
                width: 40,
                height: 22,
                borderRadius: 11,
                background: val ? C.mauve : C.surface1,
                position: "relative",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: C.text,
                  position: "absolute",
                  top: 3,
                  left: val ? 21 : 3,
                  transition: "left 0.15s",
                }}
              />
            </div>
            <span style={{ fontSize: 13, color: val ? C.text : C.subtext0 }}>
              {val ? "Enabled" : "Disabled"}
            </span>
          </label>
        );

      case "select":
        return (
          <select
            style={selectStyle}
            value={String(val ?? "")}
            onChange={(e) => setValue(field.key, e.target.value)}
          >
            <option value="">— select —</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );

      case "multiselect": {
        const selected: string[] = Array.isArray(val) ? val : [];
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(field.options ?? []).map((opt) => {
              const isSelected = selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setValue(
                        field.key,
                        selected.filter((s) => s !== opt),
                      );
                    } else {
                      setValue(field.key, [...selected, opt]);
                    }
                  }}
                  style={{
                    padding: "5px 14px",
                    borderRadius: 7,
                    border: `1.5px solid ${isSelected ? C.mauve : C.surface1}`,
                    background: isSelected ? "rgba(203,166,247,0.12)" : C.surface0,
                    color: isSelected ? C.mauve : C.subtext0,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 400,
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        );
      }

      case "textarea":
        return (
          <textarea
            style={{
              ...inputStyle,
              minHeight: 80,
              resize: "vertical",
              fontFamily: "monospace",
            }}
            value={String(val ?? "")}
            onChange={(e) => setValue(field.key, e.target.value)}
            placeholder={field.placeholder}
          />
        );

      default:
        return (
          <input
            style={inputStyle}
            value={String(val ?? "")}
            onChange={(e) => setValue(field.key, e.target.value)}
          />
        );
    }
  };

  // ── Count required fields that are empty ──────────────────────────
  const missingRequired = fields.filter(
    (f) => f.required && !getVal(f.key, f.default),
  ).length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(17,17,27,0.85)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Slide-in panel */}
      <div
        style={{
          width: "min(620px, 100vw)",
          background: C.base,
          color: C.text,
          display: "flex",
          flexDirection: "column",
          borderLeft: `1px solid ${C.surface0}`,
          fontFamily: "system-ui, -apple-system, sans-serif",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: `1px solid ${C.surface0}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
            background: C.mantle,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background:
                kind === "skill"
                  ? "rgba(203,166,247,0.15)"
                  : "rgba(166,227,161,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            {kind === "skill" ? "🧩" : "🔧"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>
              Configure {displayName}
            </div>
            <div style={{ fontSize: 11, color: C.subtext0, marginTop: 1 }}>
              {qualifiedName} · {kind}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.overlay0,
              fontSize: 20,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
              lineHeight: 1,
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Scope selector */}
        <div
          style={{
            padding: "12px 24px",
            borderBottom: `1px solid ${C.surface0}`,
            background: C.mantle,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: C.subtext0,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
            }}
          >
            Scope:
          </span>
          <button
            onClick={() => setScope("global")}
            style={{
              padding: "5px 14px",
              borderRadius: 7,
              border: `1.5px solid ${scope === "global" ? C.mauve : C.surface1}`,
              background: scope === "global" ? "rgba(203,166,247,0.12)" : C.surface0,
              color: scope === "global" ? C.mauve : C.subtext0,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: scope === "global" ? 700 : 400,
            }}
          >
            🌐 Global
          </button>
          {(agents ?? []).map((agent) => (
            <button
              key={agent}
              onClick={() => setScope(agent)}
              style={{
                padding: "5px 14px",
                borderRadius: 7,
                border: `1.5px solid ${scope === agent ? C.blue : C.surface1}`,
                background: scope === agent ? "rgba(137,180,250,0.12)" : C.surface0,
                color: scope === agent ? C.blue : C.subtext0,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: scope === agent ? 700 : 400,
              }}
            >
              🤖 {agent}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: C.overlay0 }}>
            {scope === "global"
              ? "Applies to all agents"
              : `Overrides global for "${scope}"`}
          </span>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "3rem",
                color: C.subtext0,
              }}
            >
              Loading configuration…
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Info banner */}
              <div
                style={{
                  background: "rgba(137,180,250,0.06)",
                  border: `1px solid rgba(137,180,250,0.15)`,
                  borderRadius: 10,
                  padding: "12px 16px",
                  fontSize: 12,
                  color: C.subtext0,
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: C.blue }}>ℹ How it works:</strong>{" "}
                Global values apply to all agents. Agent-level values override
                globals for that specific agent.
                {missingRequired > 0 && (
                  <span style={{ display: "block", marginTop: 6, color: C.yellow }}>
                    ⚠ {missingRequired} required field
                    {missingRequired !== 1 ? "s" : ""} not yet configured.
                  </span>
                )}
              </div>

              {/* Fields */}
              <div style={sectionStyle}>
                <h4 style={{ margin: 0, fontSize: 13, color: C.text }}>
                  Configuration Fields
                </h4>

                {fields.map((field) => (
                  <div key={field.key}>
                    <label style={labelStyle}>
                      {field.label}
                      {field.required && (
                        <span
                          style={{
                            color: C.red,
                            marginLeft: 4,
                            fontSize: 10,
                          }}
                        >
                          required
                        </span>
                      )}
                    </label>
                    {field.description && (
                      <p
                        style={{
                          margin: "0 0 6px",
                          fontSize: 11,
                          color: C.subtext0,
                          lineHeight: 1.4,
                        }}
                      >
                        {field.description}
                      </p>
                    )}
                    {renderField(field)}
                  </div>
                ))}
              </div>

              {/* Current values preview */}
              <details
                style={{
                  background: C.mantle,
                  borderRadius: 10,
                  padding: "12px 16px",
                }}
              >
                <summary
                  style={{
                    fontSize: 12,
                    color: C.subtext0,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  Raw values (JSON)
                </summary>
                <pre
                  style={{
                    marginTop: 10,
                    background: C.surface0,
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: 11,
                    color: C.subtext1,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 180,
                    overflow: "auto",
                    border: `1px solid ${C.surface1}`,
                  }}
                >
                  {JSON.stringify(values, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 24px",
            borderTop: `1px solid ${C.surface0}`,
            background: C.mantle,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          {saved && (
            <span
              style={{ fontSize: 13, color: C.green, marginRight: "auto" }}
            >
              ✓ Configuration saved
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              color: C.overlay0,
              marginRight: "auto",
            }}
          >
            Scope:{" "}
            <strong style={{ color: scope === "global" ? C.mauve : C.blue }}>
              {scope === "global" ? "Global" : scope}
            </strong>
          </span>
          <button
            onClick={onClose}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: `1px solid ${C.surface1}`,
              background: "transparent",
              color: C.subtext0,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "8px 24px",
              borderRadius: 8,
              border: "none",
              background: C.mauve,
              color: C.crust,
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 13,
              opacity: saving ? 0.7 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
