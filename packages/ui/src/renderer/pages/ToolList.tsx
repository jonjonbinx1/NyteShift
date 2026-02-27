import React, { useEffect, useState } from "react";

interface ToolInfo {
  name: string;
  contributor: string;
  description: string;
}

export function ToolList(): React.JSX.Element {
  const [tools, setTools] = useState<ToolInfo[]>([]);

  const reload = () => {
    if (!window.solixApi) return;
    window.solixApi.listTools().then(setTools).catch(console.error);
  };

  useEffect(() => {
    reload();
    if (window.solixApi?.onToolsChanged) {
      window.solixApi.onToolsChanged(reload);
    }
  }, []);

  return (
    <div>
      <h1>Tools</h1>
      {tools.length === 0 ? (
        <p>No tools installed. Sync from the marketplace or add tools to ~/.solix/tools.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Contributor</th>
              <th style={{ padding: 8 }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={`${t.contributor}/${t.name}`} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8 }}>{t.name}</td>
                <td style={{ padding: 8 }}>{t.contributor}</td>
                <td style={{ padding: 8 }}>{t.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
