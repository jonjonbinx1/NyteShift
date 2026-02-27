import React from "react";

interface LogEntry {
  timestamp: number;
  message: string;
}

interface LogViewerProps {
  logs: LogEntry[];
}

export function LogViewer({ logs }: LogViewerProps): React.JSX.Element {
  return (
    <div
      style={{
        fontFamily: "monospace",
        fontSize: "0.85rem",
        background: "#181825",
        color: "#a6adc8",
        padding: "1rem",
        borderRadius: 6,
        maxHeight: 400,
        overflowY: "auto",
      }}
    >
      {logs.length === 0 && <div>No logs yet.</div>}
      {logs.map((entry, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <span style={{ color: "#585b70" }}>
            [{new Date(entry.timestamp).toLocaleTimeString()}]
          </span>{" "}
          {entry.message}
        </div>
      ))}
    </div>
  );
}
