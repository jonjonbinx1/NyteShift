import React from "react";
import { useTheme } from "../theme/ThemeContext.js";

interface LogEntry {
  timestamp: number;
  message: string;
}

interface LogViewerProps {
  logs: LogEntry[];
}

export function LogViewer({ logs }: LogViewerProps): React.JSX.Element {
  const { palette: C } = useTheme();
  return (
    <div
      style={{
        fontFamily: "monospace",
        fontSize: "0.85rem",
        background: C.mantle,
        color: C.subtext0,
        padding: "1rem",
        borderRadius: 6,
        maxHeight: 400,
        overflowY: "auto",
      }}
    >
      {logs.length === 0 && <div>No logs yet.</div>}
      {logs.map((entry, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <span style={{ color: C.surface2 }}>
            [{new Date(entry.timestamp).toLocaleTimeString()}]
          </span>{" "}
          {entry.message}
        </div>
      ))}
    </div>
  );
}
