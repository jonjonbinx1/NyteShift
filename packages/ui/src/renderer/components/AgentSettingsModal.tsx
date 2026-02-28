import React, { useEffect, useState } from "react";

// ── Catppuccin Mocha palette ─────────────────────────────────────────────────
const C = {
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay0: "#6c7086",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  subtext1: "#bac2de",
  mauve: "#cba6f7",
  blue: "#89b4fa",
  green: "#a6e3a1",
  red: "#f38ba8",
  yellow: "#f9e2af",
  peach: "#fab387",
  teal: "#94e2d5",
} as const;

type PermLevel = "allow" | "deny" | "prompt";

interface SkillInfo {
  frontmatter: { name: string; contributor: string; description: string };
}
interface ToolInfo {
  name: string;
  contributor: string;
  description: string;
}

interface Props {
  agentName: string;
  onClose: () => void;
}

// ── Style helpers ────────────────────────────────────────────────────────────
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

// ── CheckList for skills / tools ─────────────────────────────────────────────
function CheckList<T>({
  items, selected, onChange, keyOf, labelOf, descOf,
}: {
  items: T[];
  selected: string[];
  onChange: (v: string[]) => void;
  keyOf: (i: T) => string;
  labelOf: (i: T) => string;
  descOf: (i: T) => string;
}) {
  const toggle = (k: string) =>
    onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);

  if (items.length === 0)
    return <p style={{ color: C.overlay0, fontSize: 13, margin: 0 }}>None installed.</p>;

  const allKeys = items.map(keyOf);
  const allSelected = allKeys.every((k) => selected.includes(k));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Select-all row */}
      <label style={{
        display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
        padding: "7px 10px", borderRadius: 8,
        background: allSelected ? "rgba(203,166,247,0.06)" : "transparent",
        border: `1px solid ${allSelected ? "rgba(203,166,247,0.2)" : "transparent"}`,
        marginBottom: 4,
      }}>
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onChange(allSelected ? [] : allKeys)}
          style={{ marginTop: 0, accentColor: C.mauve, width: 14, height: 14, flexShrink: 0 }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, color: allSelected ? C.mauve : C.subtext0 }}>
          {allSelected ? "Deselect all" : "Select all"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: C.overlay0 }}>
          {selected.length} / {items.length}
        </span>
      </label>
      {items.map((item) => {
        const k = keyOf(item);
        const checked = selected.includes(k);
        return (
          <label
            key={k}
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
              padding: "8px 10px", borderRadius: 8,
              background: checked ? "rgba(203,166,247,0.08)" : C.surface0,
              border: checked ? `1px solid rgba(203,166,247,0.25)` : `1px solid transparent`,
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(k)}
              style={{ marginTop: 2, accentColor: C.mauve, width: 14, height: 14, flexShrink: 0 }}
            />
            <span style={{ flex: 1 }}>
              <strong style={{ fontSize: 13, color: checked ? C.mauve : C.text }}>{labelOf(item)}</strong>
              {descOf(item) && (
                <span style={{ display: "block", marginTop: 2, fontSize: 11, color: C.subtext0 }}>
                  {descOf(item)}
                </span>
              )}
            </span>
            <span style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 20, flexShrink: 0,
              background: checked ? "rgba(166,227,161,0.18)" : C.surface1,
              color: checked ? C.green : C.overlay0, fontWeight: 700,
            }}>
              {checked ? "Enabled" : "Disabled"}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ── Permission row ───────────────────────────────────────────────────────────
function PermissionRow({
  icon, label, desc, value, onChange,
}: {
  icon: string;
  label: string;
  desc: string;
  value: PermLevel;
  onChange: (v: PermLevel) => void;
}) {
  const colors: Record<PermLevel, string> = {
    allow: C.green,
    deny: C.red,
    prompt: C.yellow,
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      background: C.surface0, borderRadius: 8, padding: "12px 14px",
    }}>
      <div style={{ fontSize: 22, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{label}</div>
        <div style={{ fontSize: 11, color: C.subtext0, marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {(["allow", "prompt", "deny"] as PermLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => onChange(level)}
            style={{
              padding: "4px 12px", borderRadius: 20, border: "none",
              cursor: "pointer", fontSize: 11, fontWeight: 700,
              background: value === level ? colors[level] : C.surface1,
              color: value === level ? C.crust : C.subtext0,
              transition: "background 0.15s color 0.15s",
              textTransform: "capitalize",
            }}
          >
            {level}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Tab button ───────────────────────────────────────────────────────────────
type Tab = "permissions" | "skills" | "tools" | "advanced";
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "permissions", icon: "🔐", label: "Permissions" },
  { id: "skills", icon: "⚡", label: "Skills" },
  { id: "tools", icon: "🔧", label: "Tools" },
  { id: "advanced", icon: "🛠", label: "Advanced" },
];

// ── Main modal ───────────────────────────────────────────────────────────────
export function AgentSettingsModal({ agentName, onClose }: Props): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>("permissions");
  const [config, setConfig] = useState<Record<string, any>>({});

  // Skills & tools
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  // Permissions
  const [fsPermission, setFsPermission] = useState<PermLevel>("allow");
  const [netPermission, setNetPermission] = useState<PermLevel>("allow");
  const [codePermission, setCodePermission] = useState<PermLevel>("allow");

  // Advanced
  const [maxSteps, setMaxSteps] = useState("30");
  const [description, setDescription] = useState("");
  const [autonomyLevel, setAutonomyLevel] = useState<"full" | "supervised" | "manual">("full");

  // UI state
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load existing config
  useEffect(() => {
    if (!window.solixApi) return;

    window.solixApi.getAgentConfig(agentName).then((cfg) => {
      const c = (cfg || {}) as Record<string, any>;
      setConfig(c);
      setSelectedSkills((c.skills as string[]) || []);
      setSelectedTools((c.tools as string[]) || []);
      setMaxSteps(String(c.maxSteps ?? 30));
      setDescription((c.description as string) ?? "");
      setAutonomyLevel((c.autonomyLevel as any) ?? "full");
      const perms = (c.permissions as Record<string, PermLevel>) || {};
      setFsPermission(perms.filesystem ?? "allow");
      setNetPermission(perms.network ?? "allow");
      setCodePermission(perms.codeExecution ?? "allow");
    }).catch(console.error);

    window.solixApi.listSkills().then(setSkills).catch(console.error);
    window.solixApi.listTools().then(setTools).catch(console.error);
  }, [agentName]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = async () => {
    if (!window.solixApi) return;
    setSaving(true);
    try {
      const next: Record<string, unknown> = {
        ...config,
        skills: selectedSkills,
        tools: selectedTools,
        description,
        maxSteps: parseInt(maxSteps, 10) || 30,
        autonomyLevel,
        permissions: {
          filesystem: fsPermission,
          network: netPermission,
          codeExecution: codePermission,
        },
      };
      await window.solixApi.writeAgentConfig(agentName, next);
      setConfig(next as Record<string, any>);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const enabledSkillCount = selectedSkills.length;
  const enabledToolCount = selectedTools.length;

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
        width: "min(680px, 100vw)",
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
          }}>🤖</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{agentName}</div>
            <div style={{ fontSize: 11, color: C.subtext0, marginTop: 1 }}>Agent Configuration</div>
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
            const badge =
              tab.id === "skills" ? enabledSkillCount :
              tab.id === "tools" ? enabledToolCount : 0;
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
                {badge > 0 && (
                  <span style={{
                    background: C.mauve, color: C.crust, borderRadius: 20,
                    fontSize: 10, fontWeight: 700, padding: "1px 6px",
                  }}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── Permissions ── */}
          {activeTab === "permissions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, color: C.text }}>Runtime Permissions</h3>
                <p style={{ margin: "0 0 16px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
                  Control what this agent is allowed to do when executing tasks. "Prompt" will ask
                  for confirmation before proceeding.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <PermissionRow
                    icon="📁"
                    label="File System"
                    desc="Read and write files on disk"
                    value={fsPermission}
                    onChange={setFsPermission}
                  />
                  <PermissionRow
                    icon="🌐"
                    label="Network Access"
                    desc="Make outbound HTTP requests to external services"
                    value={netPermission}
                    onChange={setNetPermission}
                  />
                  <PermissionRow
                    icon="⚙️"
                    label="Code Execution"
                    desc="Execute shell commands and scripts"
                    value={codePermission}
                    onChange={setCodePermission}
                  />
                </div>
              </div>

              <div style={{ background: C.mantle, borderRadius: 10, padding: "14px 16px" }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 13, color: C.text }}>Autonomy Level</h4>
                <p style={{ margin: "0 0 12px", fontSize: 11, color: C.subtext0, lineHeight: 1.5 }}>
                  Controls how much the agent acts independently vs. checking in with you.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  {([
                    { id: "full", icon: "🚀", label: "Full Auto", desc: "Agent runs all steps without interruption" },
                    { id: "supervised", icon: "👁", label: "Supervised", desc: "Agent pauses at key decision points" },
                    { id: "manual", icon: "🕹", label: "Manual", desc: "Agent proposes actions, user approves each" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setAutonomyLevel(opt.id)}
                      style={{
                        flex: 1, background: autonomyLevel === opt.id
                          ? "rgba(203,166,247,0.15)" : C.surface0,
                        border: autonomyLevel === opt.id
                          ? `1px solid rgba(203,166,247,0.4)` : `1px solid transparent`,
                        borderRadius: 8, padding: "10px 8px", cursor: "pointer",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                        transition: "background 0.15s, border-color 0.15s",
                      }}
                    >
                      <span style={{ fontSize: 20 }}>{opt.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: autonomyLevel === opt.id ? C.mauve : C.text }}>
                        {opt.label}
                      </span>
                      <span style={{ fontSize: 10, color: C.subtext0, textAlign: "center", lineHeight: 1.3 }}>
                        {opt.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Skills ── */}
          {activeTab === "skills" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <h3 style={{ margin: "0 0 4px", fontSize: 14, color: C.text }}>Enabled Skills</h3>
                  <p style={{ margin: 0, fontSize: 12, color: C.subtext0 }}>
                    Skills provide this agent with additional capabilities via structured prompts.
                    {selectedSkills.length > 0 && (
                      <span style={{ marginLeft: 6, color: C.green, fontWeight: 700 }}>
                        {selectedSkills.length} of {skills.length} enabled
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <CheckList<SkillInfo>
                items={skills}
                selected={selectedSkills}
                onChange={setSelectedSkills}
                keyOf={(i) => `${i.frontmatter.contributor}/${i.frontmatter.name}`}
                labelOf={(i) => `${i.frontmatter.contributor}/${i.frontmatter.name}`}
                descOf={(i) => i.frontmatter.description ?? ""}
              />
            </div>
          )}

          {/* ── Tools ── */}
          {activeTab === "tools" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <h3 style={{ margin: "0 0 4px", fontSize: 14, color: C.text }}>Enabled Tools</h3>
                  <p style={{ margin: 0, fontSize: 12, color: C.subtext0 }}>
                    Tools give this agent access to functions like file I/O, HTTP requests, and code execution.
                    {selectedTools.length > 0 && (
                      <span style={{ marginLeft: 6, color: C.green, fontWeight: 700 }}>
                        {selectedTools.length} of {tools.length} enabled
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <CheckList<ToolInfo>
                items={tools}
                selected={selectedTools}
                onChange={setSelectedTools}
                keyOf={(i) => `${i.contributor}/${i.name}`}
                labelOf={(i) => `${i.contributor}/${i.name}`}
                descOf={(i) => i.description ?? ""}
              />
            </div>
          )}

          {/* ── Advanced ── */}
          {activeTab === "advanced" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={sectionStyle}>
                <h3 style={{ margin: 0, fontSize: 14, color: C.text }}>General</h3>
                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this agent do?"
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
                  />
                </div>
              </div>

              <div style={sectionStyle}>
                <h3 style={{ margin: 0, fontSize: 14, color: C.text }}>Execution Limits</h3>
                <div>
                  <label style={labelStyle}>
                    Max Steps
                    <span style={{ marginLeft: 6, color: C.mauve, fontWeight: 700 }}>{maxSteps}</span>
                  </label>
                  <p style={{ margin: "0 0 8px", fontSize: 11, color: C.subtext0, lineHeight: 1.4 }}>
                    Maximum number of tool-use steps the agent may take per request before stopping.
                  </p>
                  <input
                    type="range" min="1" max="100" step="1"
                    value={maxSteps}
                    onChange={(e) => setMaxSteps(e.target.value)}
                    style={{ width: "100%", accentColor: C.mauve, marginBottom: 4 }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.overlay0 }}>
                    <span>1 (Minimal)</span>
                    <span>50</span>
                    <span>100 (Unrestricted)</span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="number" min={1} max={200}
                      value={maxSteps}
                      onChange={(e) => setMaxSteps(e.target.value)}
                      style={{ ...inputStyle, width: 100 }}
                    />
                  </div>
                </div>
              </div>

              <div style={{
                background: "rgba(243,139,168,0.08)",
                border: `1px solid rgba(243,139,168,0.2)`,
                borderRadius: 10, padding: "14px 16px",
              }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 13, color: C.red }}>⚠ Danger Zone</h4>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>
                  These actions cannot be undone.
                </p>
                <button
                  onClick={async () => {
                    if (!confirm(`Delete all chat history for "${agentName}"?`)) return;
                    await window.solixApi?.deleteAllChatSessions?.(agentName);
                  }}
                  style={{
                    background: "rgba(243,139,168,0.1)", border: `1px solid rgba(243,139,168,0.3)`,
                    color: C.red, padding: "7px 16px", borderRadius: 7, cursor: "pointer",
                    fontSize: 13, fontWeight: 600,
                  }}
                >
                  🗑 Clear all chat history
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
