import React, { useEffect, useState } from "react";

interface SkillInfo {
  frontmatter: { name: string; contributor: string; description: string };
}

export function SkillList(): React.JSX.Element {
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useEffect(() => {
    if (!window.solixApi) return;
    window.solixApi.listSkills().then(setSkills).catch(console.error);
  }, []);

  return (
    <div>
      <h1>Skills</h1>
      {skills.length === 0 ? (
        <p>No skills installed. Sync from the marketplace or add skills to ~/.solix/skills.</p>
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
            {skills.map((s) => (
              <tr key={`${s.frontmatter.contributor}/${s.frontmatter.name}`} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8 }}>{s.frontmatter.name}</td>
                <td style={{ padding: 8 }}>{s.frontmatter.contributor}</td>
                <td style={{ padding: 8 }}>{s.frontmatter.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
