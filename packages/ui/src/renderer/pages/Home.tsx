import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext.js";

// Import so Vite bundles the asset and returns the correct hashed path.
import logoSrc from "../nyteshift_logo.png";

interface Stats {
  agents: number;
  triggers: number;
  hasProvider: boolean;
  defaultProvider: string | null;
}

const quickLinks = [
  { to: "/agents",      icon: "🤖", label: "Agents",      desc: "Create and manage your AI agents" },
  { to: "/triggers",    icon: "⚡", label: "Triggers",    desc: "Schedule tasks and webhooks" },
  { to: "/skills",      icon: "🧩", label: "Skills",      desc: "Add capabilities to agents" },
  { to: "/tools",       icon: "🔧", label: "Tools",       desc: "Connect tools and integrations" },
  { to: "/providers",   icon: "🔑", label: "Providers",   desc: "Configure AI model providers" },
  { to: "/marketplace", icon: "🛒", label: "Marketplace", desc: "Browse community skills and tools" },
];

export function Home(): React.JSX.Element {
  const { palette: C } = useTheme();
  const [stats, setStats] = useState<Stats>({ agents: 0, triggers: 0, hasProvider: false, defaultProvider: null });

  useEffect(() => {
    if (!window.nyteShiftApi) return;
    Promise.all([
      window.nyteShiftApi.listAgents().catch(() => [] as string[]),
      window.nyteShiftApi.triggersListAll().catch(() => [] as any[]),
      window.nyteShiftApi.readConfig().catch(() => ({} as any)),
    ]).then(([agents, triggers, cfg]) => {
      setStats({
        agents: (agents as string[]).length,
        triggers: (triggers as any[]).length,
        hasProvider: !!cfg?.defaultProvider,
        defaultProvider: cfg?.defaultProvider ?? null,
      });
    });
  }, []);

  const cardBase: React.CSSProperties = {
    background: C.surface0,
    borderRadius: 12,
    padding: "1.25rem 1.5rem",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>

      {/* ── Hero ── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.surface0} 0%, ${C.surface1} 100%)`,
        borderRadius: 16,
        padding: "2rem 2.5rem",
        marginBottom: "2rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <img src={logoSrc} alt="NyteShift" style={{ width: 64, height: 64, borderRadius: 10 }} />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.8rem", fontWeight: 800, color: C.text }}>
              Welcome to NyteShift
            </h1>
            <p style={{ margin: "0.4rem 0 0", color: C.subtext0, fontSize: "1rem" }}>
              Your local AI agent platform — build, schedule, and automate.
            </p>
          </div>
        </div>

        {!stats.hasProvider && (
          <Link
            to="/providers"
            style={{
              background: C.mauve,
              color: C.base,
              padding: "0.6rem 1.4rem",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: "0.9rem",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            🔑 Setup a Provider
          </Link>
        )}
        {stats.hasProvider && (
          <div style={{
            background: `rgba(166,227,161,0.12)`,
            border: `1px solid ${C.green}44`,
            borderRadius: 8,
            padding: "0.5rem 1rem",
            fontSize: "0.85rem",
            color: C.green,
            fontWeight: 600,
          }}>
            ✅ {stats.defaultProvider} connected
          </div>
        )}
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
        <div style={{ ...cardBase, alignItems: "center", textAlign: "center" }}>
          <span style={{ fontSize: "2rem" }}>🤖</span>
          <span style={{ fontSize: "2rem", fontWeight: 800, color: C.mauve }}>{stats.agents}</span>
          <span style={{ fontSize: "0.85rem", color: C.subtext0 }}>Agents</span>
        </div>
        <div style={{ ...cardBase, alignItems: "center", textAlign: "center" }}>
          <span style={{ fontSize: "2rem" }}>⚡</span>
          <span style={{ fontSize: "2rem", fontWeight: 800, color: C.blue }}>{stats.triggers}</span>
          <span style={{ fontSize: "0.85rem", color: C.subtext0 }}>Triggers</span>
        </div>
        <div style={{ ...cardBase, alignItems: "center", textAlign: "center" }}>
          <span style={{ fontSize: "2rem" }}>🔑</span>
          <span style={{ fontSize: "2rem", fontWeight: 800, color: stats.hasProvider ? C.green : C.red }}>
            {stats.hasProvider ? "OK" : "–"}
          </span>
          <span style={{ fontSize: "0.85rem", color: C.subtext0 }}>Provider</span>
        </div>
      </div>

      {/* ── Helper nudge ── */}
      <div style={{
        ...cardBase,
        flexDirection: "row",
        alignItems: "center",
        gap: "1rem",
        marginBottom: "2rem",
        border: `1px solid ${C.mauve}44`,
        background: `${C.mauve}10`,
      }}>
        <span style={{ fontSize: "2rem", flexShrink: 0 }}>💬</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: C.text, marginBottom: 2 }}>Need help getting started?</div>
          <div style={{ fontSize: "0.85rem", color: C.subtext0 }}>
            Use the <strong style={{ color: C.mauve }}>NyteShift Assistant</strong> chat bubble in the bottom-right corner — just describe
            what you want and it will help you set up agents, triggers, and more.
          </div>
        </div>
      </div>

      {/* ── Quick-nav grid ── */}
      <h2 style={{ color: C.subtext0, fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
        Quick Access
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
        {quickLinks.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            style={{
              background: C.surface0,
              borderRadius: 10,
              padding: "1rem 1.2rem",
              textDecoration: "none",
              color: C.text,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.background = C.surface1)}
            onMouseLeave={(e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.background = C.surface0)}
          >
            <span style={{ fontSize: "1.4rem", flexShrink: 0, marginTop: 2 }}>{l.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{l.label}</div>
              <div style={{ fontSize: "0.8rem", color: C.subtext0, marginTop: 2 }}>{l.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
