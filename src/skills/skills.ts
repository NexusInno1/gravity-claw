/**
 * Skills / Plugin System
 *
 * Loads `.md` skill files from a directory and injects their content
 * into the agent's system prompt, extending its capabilities without
 * code changes.
 *
 * Each skill file can have optional YAML frontmatter:
 *   ---
 *   name: My Skill
 *   description: What this skill does
 *   enabled: true
 *   ---
 *   [Skill content in markdown]
 *
 * If no frontmatter is present, the filename is used as the name.
 */

import { readdirSync, readFileSync } from "fs";
import { resolve, basename } from "path";

export interface Skill {
  /** Skill name (from frontmatter or filename) */
  name: string;
  /** Optional description */
  description: string;
  /** The markdown content (the actual skill prompt) */
  content: string;
  /** Source filename */
  filename: string;
}

/**
 * Parse optional YAML frontmatter from a markdown string.
 * Returns { metadata, content } where content is the body after frontmatter.
 */
function parseFrontmatter(raw: string): {
  metadata: Record<string, string>;
  content: string;
} {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { metadata: {}, content: raw };
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    return { metadata: {}, content: raw };
  }

  const frontmatterBlock = trimmed.substring(3, endIndex).trim();
  const content = trimmed.substring(endIndex + 3).trim();

  const metadata: Record<string, string> = {};
  for (const line of frontmatterBlock.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      metadata[key] = value;
    }
  }

  return { metadata, content };
}

/**
 * Load all `.md` skill files from the given directory.
 * Returns an array of parsed Skill objects (only enabled skills).
 */
export function loadSkills(dir: string): Skill[] {
  const skills: Skill[] = [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    console.log(`[Skills] No skills directory found at ${dir} — skipping.`);
    return [];
  }

  for (const file of files) {
    try {
      const raw = readFileSync(resolve(dir, file), "utf-8");
      const { metadata, content } = parseFrontmatter(raw);

      // Skip disabled skills
      if (metadata.enabled === "false") {
        console.log(`[Skills] Skipping disabled skill: ${file}`);
        continue;
      }

      const skill: Skill = {
        name: metadata.name || basename(file, ".md"),
        description: metadata.description || "",
        content,
        filename: file,
      };

      skills.push(skill);
      console.log(`[Skills] Loaded: ${skill.name} (${file})`);
    } catch (err) {
      console.warn(`[Skills] Failed to load ${file}:`, err);
    }
  }

  console.log(`[Skills] ${skills.length} skill(s) loaded.`);
  return skills;
}

/**
 * Build a prompt section from loaded skills to inject into the system instruction.
 */
export function buildSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const parts = ["## Active Skills"];

  for (const skill of skills) {
    parts.push(`### ${skill.name}`);
    if (skill.description) {
      parts.push(`_${skill.description}_`);
    }
    parts.push(skill.content);
  }

  return parts.join("\n\n");
}
