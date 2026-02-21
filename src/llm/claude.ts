import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";
import { config } from "../config.js";
import { loadSkills, formatSkillsForPrompt } from "../skills/loader.js";

// OpenRouter uses the OpenAI-compatible API
export const llm = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.openRouterApiKey,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/gravity-claw",
    "X-Title": "Gravity Claw",
  },
});

// ── Load soul.md ─────────────────────────────────────────

let soulDirective = "";
try {
  soulDirective = readFileSync(join(process.cwd(), "soul.md"), "utf-8").trim();
  console.log("🧬 Soul loaded from soul.md");
} catch {
  console.warn("⚠️ soul.md not found — using default personality");
}

// ── Load Skills ──────────────────────────────────────────

const skills = loadSkills();
if (skills.length > 0) {
  console.log(
    `📚 Loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`,
  );
}
const skillsBlock = formatSkillsForPrompt(skills);

// ── System Prompt ────────────────────────────────────────

export const SYSTEM_PROMPT = `${soulDirective || "You are Gravity Claw — a personal AI assistant."}

---

Operational guidelines:
- When using tools, briefly explain what you're doing.
- If you don't know something, say so honestly.
- Never reveal API keys, tokens, or sensitive configuration.
- Format responses for Telegram (Markdown supported).
- Use web_search when you need current information, facts, or research.

Current capabilities:
- get_current_time: Check the current time in any timezone.
- web_search: Search the web via DuckDuckGo for current info.
- push_canvas: Push interactive widgets (charts, tables, forms, markdown, HTML) to the user's Live Canvas at http://localhost:3100. Use this for any visual or structured data that would look better as a chart, table, or interactive element rather than plain text.
- browser: Automate a real Chromium browser. Navigate to URLs, click elements, type text, take screenshots, extract content, and run JavaScript. The browser persists between calls.
- schedule_task: Create recurring scheduled tasks that run on cron schedules. Supports natural language like "every day at 6pm" or cron expressions. Tasks execute a prompt through the agent and send results via Telegram.
- manage_tasks: List, pause, resume, or delete scheduled tasks.
- manage_webhooks: Create, list, or delete webhook endpoints. Webhooks receive HTTP POST requests at http://localhost:3100/webhook/<id> and trigger the agent with the payload.
${skillsBlock}
`;
