import { readFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { log } from "../logger.js";

// ── Skills System ────────────────────────────────────────

export interface Skill {
  /** Filename without extension */
  name: string;
  /** Raw markdown content */
  content: string;
}

const SKILLS_DIR = join(process.cwd(), "skills");

/**
 * Load all .md files from the /skills directory.
 * Each file becomes a skill that gets injected into the system prompt
 * so the LLM knows what capabilities it has.
 *
 * Skills directory is created if it doesn't exist.
 */
export function loadSkills(): Skill[] {
  // Ensure skills directory exists
  if (!existsSync(SKILLS_DIR)) {
    mkdirSync(SKILLS_DIR, { recursive: true });
    log.info("📁 Created /skills directory");
  }

  const files = readdirSync(SKILLS_DIR).filter((f) =>
    f.toLowerCase().endsWith(".md"),
  );

  const skills: Skill[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(SKILLS_DIR, file), "utf-8").trim();
      if (content) {
        skills.push({
          name: basename(file, ".md"),
          content,
        });
      }
    } catch (err) {
      log.warn(err, `⚠️ Failed to load skill ${file}`);
    }
  }

  return skills;
}

/**
 * Format loaded skills into a block of text for the system prompt.
 * Returns empty string if no skills are loaded.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const blocks = skills.map((s) => `### Skill: ${s.name}\n${s.content}`);

  return (
    "\n\n---\n\n## Loaded Skills\n\n" +
    "The following skills define additional capabilities and behaviours:\n\n" +
    blocks.join("\n\n---\n\n")
  );
}
