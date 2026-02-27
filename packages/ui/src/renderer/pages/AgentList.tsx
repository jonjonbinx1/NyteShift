import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CreateAgentModal } from "../components/CreateAgentModal.js";

export function AgentList(): React.JSX.Element {
  const [agents, setAgents] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);

  const load = async () => {
    console.log("[AgentList] load() called");
    if (!window.solixApi) {
      console.warn("[AgentList] solixApi unavailable");
      return;
    }
    const list = await window.solixApi.listAgents();
    console.log("[AgentList] agents:", list);
    setAgents(list);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete agent "${name}"?`)) return;
    await window.solixApi!.deleteAgent(name);
    await load();
  };

  const filtered = agents.filter((a) =>
    a.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, flex: 1 }}>Agents</h1>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: "8px 18px",
            borderRadius: 6,
            border: "none",
            background: "#cba6f7",
            color: "#1e1e2e",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          + New Agent
        </button>
      </div>

      {/* Search bar */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search agents…"
        style={{
          padding: "7px 12px",
          borderRadius: 6,
          border: "1px solid #45475a",
          background: "#181825",
          color: "#cdd6f4",
          width: "100%",
          boxSizing: "border-box",
          fontSize: 14,
          marginBottom: 16,
        }}
      />

      {filtered.length === 0 ? (
        <p style={{ color: "#585b70" }}>
          {agents.length === 0 ? "No agents yet. Click \"+ New Agent\" to create one." : "No agents match your search."}
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {filtered.map((name) => (
            <li
              key={name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                borderBottom: "1px solid #313244",
                borderRadius: 6,
              }}
            >
              <Link
                to={`/agents/${name}`}
                style={{ fontWeight: 600, color: "#cba6f7", textDecoration: "none" }}
              >
                {name}
              </Link>
              <button
                onClick={() => handleDelete(name)}
                style={{
                  color: "#f38ba8",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {showModal && (
        <CreateAgentModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}
