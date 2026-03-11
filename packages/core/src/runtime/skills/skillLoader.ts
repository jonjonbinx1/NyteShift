import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

import type { Skill, SkillFrontmatter } from "../../types/index.js";
import { skillsDir, readTextFile, pathExists } from "../../utils/index.js";
import { getInstalledItem } from "../marketplace/installed.js";

/**
 * Scans ~/.nyteshift/skills for skill.md files.
 *
 * Expected layout:
 *   ~/.nyteshift/skills/<contributor>/<skill-name>/skill.md
 */
export async function loadSkills(): Promise<Skill[]> {
  const root = skillsDir();
  if (!(await pathExists(root))) return [];

  const skills: Skill[] = [];
  const contributors = await readdir(root);

  for (const contributor of contributors) {
    const contributorDir = join(root, contributor);
    const cStat = await stat(contributorDir);
    if (!cStat.isDirectory()) continue;

    const skillDirs = await readdir(contributorDir);
    for (const skillDir of skillDirs) {
      const skillPath = join(contributorDir, skillDir, "skill.md");
      if (!(await pathExists(skillPath))) continue;

      try {
        const raw = await readTextFile(skillPath);
        const parsed = matter(raw);
        const fm = parsed.data as SkillFrontmatter;

        if (!fm.name || !fm.version || !fm.contributor) {
          console.warn(`[SkillLoader] Invalid frontmatter in ${skillPath}, skipping.`);
          continue;
        }

        if (!fm.schema) {
          console.warn(
            `[SkillLoader] Skill "${fm.contributor}/${fm.name}" has no schema block — ` +
            `add an inputs/outputs/verify section to enable contract validation.`,
          );
        }

        const skill: any = {
          frontmatter: {
            name: fm.name,
            version: fm.version,
            contributor: fm.contributor,
            description: fm.description ?? "",
            tags: Array.isArray(fm.tags) ? fm.tags : undefined,
            schema: fm.schema ?? undefined,
            config: Array.isArray(fm.config) ? fm.config : undefined,
          },
          body: parsed.content.trim(),
          filePath: skillPath,
        };

        // try to merge in installed metadata if available
        try {
          const meta = await getInstalledItem("skills", fm.contributor, fm.name);
          if (meta) {
            skill.hash = meta.hash;
            skill.autoUpdate = meta.autoUpdate;
            if (meta.version) skill.frontmatter.version = meta.version;
          }
        } catch {
          // ignore
        }

        skills.push(skill);
      } catch (err) {
        console.warn(`[SkillLoader] Failed to parse ${skillPath}:`, err);
      }
    }
  }

  return skills;
}

/** Look up a single skill by `<contributor>/<skill-name>`. */
export async function getSkill(qualifiedName: string): Promise<Skill | undefined> {
  const skills = await loadSkills();
  return skills.find(
    (s) => `${s.frontmatter.contributor}/${s.frontmatter.name}` === qualifiedName,
  );
}
