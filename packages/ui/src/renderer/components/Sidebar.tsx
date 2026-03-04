import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import { GlobalSettingsModal } from "./GlobalSettingsModal.js";
import { useTheme } from "../theme/ThemeContext.js";

const links = [
  { to: "/", label: "Home" },
  { to: "/agents", label: "Agents" },
  { to: "/triggers", label: "Triggers" },
  { to: "/skills", label: "Skills" },
  { to: "/tools", label: "Tools" },
  { to: "/providers", label: "Providers" },
  { to: "/marketplace", label: "Marketplace" },
  { to: "/logs", label: "Logs" },
];

export function Sidebar(): React.JSX.Element {
  const [showSettings, setShowSettings] = useState(false);
  const { palette: C } = useTheme();

  const navStyle: React.CSSProperties = {
    width: 200,
    background: C.base,
    color: C.text,
    display: "flex",
    flexDirection: "column",
    padding: "1rem 0",
  };

  const linkStyle: React.CSSProperties = {
    padding: "0.6rem 1.2rem",
    color: C.text,
    textDecoration: "none",
    fontSize: "0.95rem",
  };

  const activeLinkStyle: React.CSSProperties = {
    ...linkStyle,
    background: C.surface0,
    fontWeight: 600,
  };

  return (
    <>
      <nav style={navStyle}>
        <div style={{ padding: "0 1.2rem 1rem", fontWeight: 700, fontSize: "1.2rem" }}>
          SolixAI
        </div>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            style={({ isActive }) => (isActive ? activeLinkStyle : linkStyle)}
          >
            {l.label}
          </NavLink>
        ))}

        {/* Spacer pushes settings to bottom */}
        <div style={{ flex: 1 }} />

        {/* Settings button */}
        <button
          onClick={() => setShowSettings(true)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            margin: "0.5rem 0.8rem", padding: "0.6rem 1rem",
            background: "transparent", border: `1px solid ${C.surface0}`,
            borderRadius: 8, color: C.subtext0, cursor: "pointer",
            fontSize: "0.85rem", transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = C.surface0;
            (e.currentTarget as HTMLButtonElement).style.color = C.text;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = C.subtext0;
          }}
        >
          <span style={{ fontSize: 16 }}>⚙️</span>
          <span>Settings</span>
        </button>
      </nav>

      {showSettings && (
        <GlobalSettingsModal onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}
