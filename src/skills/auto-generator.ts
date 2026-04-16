/**
 * Autonomous Skill Generator — Hermes-Inspired Closed Learning Loop
 *
 * After a sub-agent completes a complex delegated task, this module
 * evaluates whether the task was novel and complex enough to warrant
 * a reusable skill. If so, it generates a `.md` skill file and saves
 * it to `skills/auto/`.
 *
 * The existing skills loader (`loader.ts`) already loads from `skills/`
 * recursively, so auto-generated skills are automatically picked up.
 *
 * Criteria for skill creation:
 *   1. Task used 3+ tool calls (multi-step)
 *   2. Sub-agent used 2+ iterations
 *   3. Task description is specific enough (not trivial)
 *   4. No existing skill already covers this pattern
 *
 * Skills are saved with frontmatter metadata for tracking:
 *   - auto_generated: true
 *   - created_at: ISO timestamp
 *   - source_agent: which sub-agent produced it
 *   - effectiveness: starts at 0 (incremented on reuse)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, basename } from "path";
import { routedChat } from "../lib/router.js";
import { getRuntimeConfig } from "../lib/config-sync.js";
import { getActiveSkills } from "./loader.js";

// ─── Config ──────────────────────────────────────────────────────

const AUTO_SKILLS_DIR = resolve(process.cwd(), "skills", "auto");
const MAX_AUTO_SKILLS = 50; // Cap to prevent unbounded growth
const MIN_TASK_LENGTH = 80; // Minimum task description length to consider
const MIN_RESULT_LENGTH = 200; // Minimum result length to consider

// ─── Types ───────────────────────────────────────────────────────

export interface TaskCompletionEvent {
  /** The sub-agent profile name (e.g. "research", "code") */
  agentName: string;
  /** The sub-agent label (e.g. "Research Agent") */
  agentLabel: string;
  /** The original task description sent to the sub-agent */
  taskDescription: string;
  /** The sub-agent's final output */
  result: string;
  /** Number of iterations the sub-agent used */
  iterationsUsed: number;
  /** How long the sub-agent took (seconds) */
  elapsedSeconds: number;
}

// ─── Skill Extraction ────────────────────────────────────────────

/**
 * Evaluate a completed delegated task and potentially create a reusable skill.
 * Runs in the background — never blocks the response.
 *
 * Call this after a sub-agent completes a task successfully.
 */
export function triggerSkillExtraction(event: TaskCompletionEvent): void {
  // Quick pre-filters (no LLM cost)
  if (!shouldConsiderForSkill(event)) return;

  // Fire and forget
  extractAndSaveSkill(event).catch((err) =>
    console.error("[AutoSkill] Background skill extraction error:", err),
  );
}

/**
 * Fast pre-filter: skip trivial tasks that can't produce useful skills.
 */
function shouldConsiderForSkill(event: TaskCompletionEvent): boolean {
  // Must have used at least 2 iterations (indicates multi-step work)
  if (event.iterationsUsed < 2) {
    return false;
  }

  // Task description must be substantial
  if (event.taskDescription.length < MIN_TASK_LENGTH) {
    return false;
  }

  // Result must be substantial
  if (event.result.length < MIN_RESULT_LENGTH) {
    return false;
  }

  // Skip if we've hit the skill cap
  const existingAutoSkills = getAutoSkillCount();
  if (existingAutoSkills >= MAX_AUTO_SKILLS) {
    console.log(
      `[AutoSkill] Skill cap reached (${MAX_AUTO_SKILLS}) — skipping.`,
    );
    return false;
  }

  // Skip creative agent — its outputs are one-off by nature
  if (event.agentName === "creative") {
    return false;
  }

  return true;
}

/**
 * Use an LLM to evaluate whether a task warrants a skill, and if so,
 * generate the skill content + metadata.
 */
async function extractAndSaveSkill(event: TaskCompletionEvent): Promise<void> {
  // Get existing skill names to avoid duplicates
  const existingSkills = getActiveSkills().map((s) => s.name);
  const autoSkillNames = getAutoSkillNames();
  const allSkillNames = [...existingSkills, ...autoSkillNames];

  const prompt = `You are an AI assistant that creates reusable "skills" — mini instruction sets that help an AI agent handle similar tasks better in the future.

A sub-agent just completed a task. Analyze it and decide if it should become a reusable skill.

## Completed Task
**Agent:** ${event.agentLabel} (${event.agentName})
**Task:** ${event.taskDescription}
**Iterations used:** ${event.iterationsUsed}
**Time taken:** ${event.elapsedSeconds}s
**Result excerpt (first 1500 chars):**
${event.result.substring(0, 1500)}

## Existing Skills (avoid duplicating these)
${allSkillNames.length > 0 ? allSkillNames.join(", ") : "None"}

## Your Decision

Evaluate:
1. Was this task complex enough to warrant a reusable skill? (multi-step, non-trivial)
2. Would similar tasks recur in the future?
3. Does any existing skill already cover this pattern?
4. Can the approach be generalized into clear instructions?

If YES to 1+2+4 and NO to 3, create a skill. Otherwise, return SKIP.

## Output Format

If creating a skill, return EXACTLY this JSON (no markdown fencing):
{
  "create": true,
  "name": "Short Descriptive Name",
  "slug": "short-descriptive-name",
  "description": "One-line description of when to use this skill",
  "category": "research|code|analysis|workflow|integration",
  "content": "The skill instructions in markdown. Use numbered steps, bold key terms, and be specific about WHAT to do and WHY. 5-15 lines max."
}

If NOT creating a skill:
{"create": false, "reason": "brief explanation"}`;

  try {
    const response = await routedChat({
      model: getRuntimeConfig().primaryModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const text = response.text?.trim() || "";

    // Clean markdown fencing if present
    const cleanJson = text
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();

    const result = JSON.parse(cleanJson);

    if (!result.create) {
      console.log(
        `[AutoSkill] Skipped — ${result.reason || "not worthy of a skill"}`,
      );
      return;
    }

    // Validate required fields
    if (!result.name || !result.slug || !result.content) {
      console.warn("[AutoSkill] LLM returned incomplete skill data — skipping.");
      return;
    }

    // Save the skill file
    saveAutoSkill(result, event);
  } catch (err) {
    console.error("[AutoSkill] Skill extraction failed:", err);
  }
}

// ─── File Operations ─────────────────────────────────────────────

/**
 * Save an auto-generated skill to `skills/auto/`.
 */
function saveAutoSkill(
  skill: {
    name: string;
    slug: string;
    description: string;
    category: string;
    content: string;
  },
  event: TaskCompletionEvent,
): void {
  // Ensure the auto directory exists
  if (!existsSync(AUTO_SKILLS_DIR)) {
    mkdirSync(AUTO_SKILLS_DIR, { recursive: true });
  }

  const filename = `${skill.slug}.md`;
  const filepath = resolve(AUTO_SKILLS_DIR, filename);

  // Don't overwrite existing skills
  if (existsSync(filepath)) {
    console.log(
      `[AutoSkill] Skill "${skill.slug}" already exists — skipping.`,
    );
    return;
  }

  const now = new Date().toISOString();
  const frontmatter = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `category: ${skill.category}`,
    `enabled: true`,
    `auto_generated: true`,
    `created_at: ${now}`,
    `source_agent: ${event.agentName}`,
    `effectiveness: 0`,
    "---",
    "",
  ].join("\n");

  const fileContent = frontmatter + skill.content + "\n";

  try {
    writeFileSync(filepath, fileContent, "utf-8");
    console.log(
      `[AutoSkill] ✅ Created new skill: "${skill.name}" → ${filename}`,
    );
    console.log(
      `[AutoSkill]    Source: ${event.agentLabel} | Category: ${skill.category}`,
    );
  } catch (err) {
    console.error(`[AutoSkill] Failed to write ${filepath}:`, err);
  }
}

/**
 * Count how many auto-generated skills exist.
 */
function getAutoSkillCount(): number {
  if (!existsSync(AUTO_SKILLS_DIR)) return 0;
  try {
    return readdirSync(AUTO_SKILLS_DIR).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/**
 * Get names of all auto-generated skills (for dedup checks).
 */
function getAutoSkillNames(): string[] {
  if (!existsSync(AUTO_SKILLS_DIR)) return [];
  try {
    return readdirSync(AUTO_SKILLS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        try {
          const raw = readFileSync(resolve(AUTO_SKILLS_DIR, f), "utf-8");
          const nameMatch = raw.match(/^name:\s*(.+)$/m);
          return nameMatch ? nameMatch[1].trim() : basename(f, ".md");
        } catch {
          return basename(f, ".md");
        }
      });
  } catch {
    return [];
  }
}

/**
 * List all auto-generated skills with their metadata.
 * Used by the /skills command.
 */
export function listAutoSkills(): string {
  if (!existsSync(AUTO_SKILLS_DIR)) {
    return "No auto-generated skills yet.";
  }

  const files = readdirSync(AUTO_SKILLS_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    return "No auto-generated skills yet.";
  }

  const lines: string[] = [
    `📚 **Auto-Generated Skills** (${files.length}/${MAX_AUTO_SKILLS} cap)\n`,
  ];

  for (const file of files) {
    try {
      const raw = readFileSync(resolve(AUTO_SKILLS_DIR, file), "utf-8");
      const nameMatch = raw.match(/^name:\s*(.+)$/m);
      const descMatch = raw.match(/^description:\s*(.+)$/m);
      const agentMatch = raw.match(/^source_agent:\s*(.+)$/m);
      const dateMatch = raw.match(/^created_at:\s*(.+)$/m);
      const effectMatch = raw.match(/^effectiveness:\s*(.+)$/m);

      const name = nameMatch?.[1]?.trim() || basename(file, ".md");
      const desc = descMatch?.[1]?.trim() || "";
      const agent = agentMatch?.[1]?.trim() || "unknown";
      const created = dateMatch?.[1]?.trim() || "";
      const effectiveness = effectMatch?.[1]?.trim() || "0";

      const dateStr = created
        ? new Date(created).toLocaleDateString("en-IN", { dateStyle: "medium" })
        : "";

      lines.push(`• **${name}** — ${desc}`);
      lines.push(`  📅 ${dateStr} · 🤖 ${agent} · ⭐ ${effectiveness} uses`);
    } catch {
      lines.push(`• ${basename(file, ".md")} (could not parse)`);
    }
  }

  return lines.join("\n");
}
