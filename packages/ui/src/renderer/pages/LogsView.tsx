import React, { useState } from "react";
import { LogViewer } from "../components/LogViewer.js";
import { useTheme } from "../theme/ThemeContext.js";

interface LogEntry {
  timestamp: number;
  message: string;
}

export function LogsView(): React.JSX.Element {
  const { palette: C } = useTheme();
  const [logs] = useState<LogEntry[]>([]);

  return (
    <div>
      <h1>Logs</h1>
      <p style={{ color: C.overlay0, marginBottom: 12 }}>
        Real-time logs from agent runs will appear here.
      </p>
      <LogViewer logs={logs} />
    </div>
  );
}
