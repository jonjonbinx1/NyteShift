import React from "react";
import { NavLink } from "react-router-dom";

const links = [
  { to: "/agents", label: "Agents" },
  { to: "/skills", label: "Skills" },
  { to: "/tools", label: "Tools" },
  { to: "/providers", label: "Providers" },
  { to: "/marketplace", label: "Marketplace" },
  { to: "/logs", label: "Logs" },
];

const navStyle: React.CSSProperties = {
  width: 200,
  background: "#1e1e2e",
  color: "#cdd6f4",
  display: "flex",
  flexDirection: "column",
  padding: "1rem 0",
};

const linkStyle: React.CSSProperties = {
  padding: "0.6rem 1.2rem",
  color: "#cdd6f4",
  textDecoration: "none",
  fontSize: "0.95rem",
};

const activeLinkStyle: React.CSSProperties = {
  ...linkStyle,
  background: "#313244",
  fontWeight: 600,
};

export function Sidebar(): React.JSX.Element {
  return (
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
    </nav>
  );
}
