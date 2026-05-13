/**
 * Heartbeat Jobs — Define all scheduled proactive messages here.
 *
 * Each job runs at a specific IST time and sends a message
 * to the user's Telegram chat.
 *
 * Jobs:
 *   1. Morning Check-in  — news + daily goal prompt (HEARTBEAT_MORNING_TIME, default 08:00 IST)
 *   2. Mid-Day Spark     — interesting thought/challenge/insight (HEARTBEAT_SPARK_TIME, default 12:30 IST)
 */

import { Bot } from "grammy";
import { routedChat } from "../lib/router.js";
import { executeSerperNewsSearch } from "../tools/serper_search.js";
import { executeWebSearch } from "../tools/web_search.js";
import { ENV } from "../config.js";
import { getRuntimeConfig } from "../lib/config-sync.js";
import { buildCoreMemoryPrompt } from "../memory/core.js";
import { saveMessage } from "../memory/buffer.js";
import { HeartbeatJob } from "./scheduler.js";

// ─── Minimal Markdown → HTML Converter ──────────────────────────────────────
// Used so LLM-generated messages render correctly in Telegram (HTML parse mode).

function mdToHtml(text: string): string {
  const codeBlocks: string[] = [];
  let r = text.replace(/```[\s\S]*?```/g, (m) => { codeBlocks.push(m.slice(3, -3).trim()); return `\x00CB${codeBlocks.length - 1}\x00`; });
  r = r.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  r = r.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  r = r.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  r = r.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<i>$1</i>");
  r = r.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  r = r.replace(/\x00CB(\d+)\x00/g, (_, i) => `<pre>${codeBlocks[parseInt(i)]}</pre>`);
  return r;
}

/**
 * Morning Check-in — Configurable via HEARTBEAT_MORNING_TIME env var
 * Default: 08:00 IST
 *
 * 1. Fetches today's global news
 * 2. Checks core memory for context (past goals, preferences)
 * 3. Generates a personalized morning message
 * 4. Asks "What is the biggest goal you want to achieve today?"
 */
async function morningCheckin(bot: Bot, chatId: string): Promise<void> {
  console.log("[Heartbeat] Running morning check-in...");

  // 1. Fetch today's global news (via Serper /news endpoint for accuracy)
  let newsContext = "";
  try {
    const todayIST = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    if (ENV.SERPER_API_KEY) {
      // Use /news endpoint — returns fresh, timestamped Google News articles
      newsContext = await executeSerperNewsSearch(
        `breaking world news ${todayIST}`,
      );
    } else {
      // Fallback to Tavily / Serper generic search
      newsContext = await executeWebSearch(
        `top global news headlines today ${todayIST}`,
      );
    }
  } catch (err) {
    console.error("[Heartbeat] News fetch failed:", err);
    newsContext = "Unable to fetch news today.";
  }

  // 2. Load core memory for personalization
  const coreMemory = buildCoreMemoryPrompt();
  const previousGoal = getCoreMemory("last_daily_goal");

  // 3. Generate morning message via LLM (provider-agnostic)
  const prompt = `You are SUNDAY (Superior Universal Neural Digital Assistant Yield), a sharp personal AI assistant. Generate a concise morning check-in message for your user.

${coreMemory ? `## What you know about the user:\n${coreMemory}\n` : ""}
${previousGoal ? `## Their last stated goal:\n${previousGoal}\n` : ""}

## Today's News Articles (from Google News — verified, real sources):
${newsContext}

## Instructions:
1. Start with a brief, energetic greeting (1 line)
2. Summarize 3–5 of the most important news items from the articles above.
   ⚠️ CRITICAL: Only report events that are explicitly mentioned in the articles above.
   Do NOT add, invent, or embellish any news item. If you are unsure, omit it.
   Always name the real headline or source snippet as listed.
3. If they had a previous goal, briefly ask about it
4. End by asking: "What is the biggest goal you want to achieve today?"

Keep it SHORT and punchy. No fluff, no filler. Total message should be under 300 words.`;

  try {
    const response = await routedChat({
      model: getRuntimeConfig().primaryModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const message =
      response.text?.trim() || "Good morning! What's your biggest goal today?";

    await bot.api.sendMessage(chatId, mdToHtml(message), { parse_mode: "HTML" });
    // Save to conversation buffer so bot has context when user replies
    await saveMessage(chatId, "model", message);
    console.log("[Heartbeat] Morning check-in sent successfully.");
  } catch (err) {
    console.error("[Heartbeat] Failed to send morning check-in:", err);

    // Fallback: Send a simple message if AI fails
    try {
      await bot.api.sendMessage(
        chatId,
        "☀️ Good morning! What is the biggest goal you want to achieve today?",
      );
    } catch {
      console.error("[Heartbeat] Even fallback message failed.");
    }
  }
}

/**
 * Parse the HEARTBEAT_MORNING_TIME env var (format: "HH:MM").
 * Falls back to 08:00 if not set or malformed.
 */
function parseMorningTime(): { hour: number; minute: number } {
  const raw = process.env.HEARTBEAT_MORNING_TIME || "08:00";
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    console.warn(`[Heartbeat] Invalid HEARTBEAT_MORNING_TIME="${raw}" — using 08:00`);
    return { hour: 8, minute: 0 };
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.warn(`[Heartbeat] HEARTBEAT_MORNING_TIME out of range — using 08:00`);
    return { hour: 8, minute: 0 };
  }
  return { hour, minute };
}

const morningTime = parseMorningTime();

// ─── Mid-Day Spark Job ───────────────────────────────────────────────────────

/**
 * SPARK_TYPES — the pool of spark categories SUNDAY picks from randomly.
 * Each one is a different flavour of "interesting" to keep things unpredictable.
 */
const SPARK_TYPES = [
  "provocative_question",
  "useful_challenge",
  "contrarian_insight",
  "rabbit_hole",
  "mental_model",
  "build_prompt",
] as const;

type SparkType = (typeof SPARK_TYPES)[number];

const SPARK_INSTRUCTIONS: Record<SparkType, string> = {
  provocative_question:
    "Ask one sharp, uncomfortable, thought-provoking question about their work, goals, or assumptions. " +
    "Make it feel like something a brutally honest mentor would ask. No fluffy questions.",

  useful_challenge:
    "Give them one small, concrete challenge they can complete in 15–30 minutes today. " +
    "Make it directly relevant to their current work or goals. Examples: write one cold email, " +
    "map your biggest bottleneck, research one competitor, sketch one feature, etc. Be specific.",

  contrarian_insight:
    "Share one counterintuitive insight, a pattern that most people get wrong, or a contrarian " +
    "take on something in their domain. Make it something that genuinely makes them stop and think. " +
    "Back it with one real-world example.",

  rabbit_hole:
    "Suggest one fascinating rabbit hole to explore today — a concept, person, tool, paper, " +
    "project, or idea they've probably never heard of but will find genuinely useful or fascinating. " +
    "Explain WHY it's worth exploring in 2 lines.",

  mental_model:
    "Teach one powerful mental model or framework that applies directly to their work. " +
    "Give the model a name, explain it in 2 sentences, then show how it applies to their specific situation.",

  build_prompt:
    "Drop a compelling 'what if you built...' idea that fits their skills and interests. " +
    "Make it specific enough to start today — include the core user pain, the minimum feature, " +
    "and one reason why now is the right time.",
};

/**
 * Mid-Day Spark — Configurable via HEARTBEAT_SPARK_TIME env var
 * Default: 12:30 IST
 *
 * Sends one sharp, profile-aware thought/challenge/insight.
 * Deliberately NOT news — the point is to trigger real thinking.
 */
async function midDaySpark(bot: Bot, chatId: string): Promise<void> {
  console.log("[Heartbeat] Running mid-day spark...");

  // Pick a random spark type — keeps it unpredictable
  const sparkType = SPARK_TYPES[Math.floor(Math.random() * SPARK_TYPES.length)];
  const sparkInstruction = SPARK_INSTRUCTIONS[sparkType];

  const coreMemory = buildCoreMemoryPrompt();

  const prompt = `You are SUNDAY, a sharp no-BS personal AI agent. It's mid-day and time to send ONE engaging spark to your user.

${coreMemory ? `## What you know about the user:\n${coreMemory}\n` : ""}

## Your Spark Type Today: ${sparkType.replace(/_/g, " ").toUpperCase()}

## Instructions:
${sparkInstruction}

## Format Rules:
- Maximum 120 words total
- Start with a relevant emoji (not ☀️, not 📰)
- Be direct and punchy — no padding, no pleasantries
- End with ONE question or one clear call-to-action if natural
- DO NOT explain that you're sending a "mid-day spark" or mention what type this is
- Just send the content naturally, as if you just thought of it

Write the spark now:`;

  try {
    const response = await routedChat({
      model: getRuntimeConfig().primaryModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
    });

    const message = response.text?.trim() || "⚡ What's the one thing you've been putting off that would make the biggest difference if you did it today?";

    await bot.api.sendMessage(chatId, mdToHtml(message), { parse_mode: "HTML" });
    await saveMessage(chatId, "model", message);
    console.log(`[Heartbeat] Mid-day spark sent (type: ${sparkType}).`);
  } catch (err) {
    console.error("[Heartbeat] Failed to send mid-day spark:", err);
  }
}

/**
 * Parse the HEARTBEAT_SPARK_TIME env var (format: "HH:MM").
 * Falls back to 12:30 if not set or malformed.
 */
function parseSparkTime(): { hour: number; minute: number } {
  const raw = process.env.HEARTBEAT_SPARK_TIME || "12:30";
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    console.warn(`[Heartbeat] Invalid HEARTBEAT_SPARK_TIME="${raw}" — using 12:30`);
    return { hour: 12, minute: 30 };
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.warn(`[Heartbeat] HEARTBEAT_SPARK_TIME out of range — using 12:30`);
    return { hour: 12, minute: 30 };
  }
  return { hour, minute };
}

const sparkTime = parseSparkTime();

/**
 * All heartbeat jobs.
 */
export const heartbeatJobs: HeartbeatJob[] = [
  {
    name: "Morning Check-in",
    hour: morningTime.hour,
    minute: morningTime.minute,
    execute: morningCheckin,
  },
  {
    name: "Mid-Day Spark",
    hour: sparkTime.hour,
    minute: sparkTime.minute,
    execute: midDaySpark,
  },
];
