/**
 * Heartbeat Jobs — Define all scheduled proactive messages here.
 *
 * Each job runs at a specific IST time and sends a message
 * to the user's Telegram chat.
 *
 * Jobs:
 *   1. Morning Check-in  — news + daily goal prompt (HEARTBEAT_MORNING_TIME, default 08:00 IST)
 *   2. Evening Briefing  — day summary + tomorrow prep  (HEARTBEAT_EVENING_TIME, default 21:00 IST)
 */

import { Bot } from "grammy";
import { routedChat } from "../lib/router.js";
import { executeSerperNewsSearch } from "../tools/serper_search.js";
import { executeWebSearch } from "../tools/web_search.js";
import { ENV } from "../config.js";
import { getRuntimeConfig } from "../lib/config-sync.js";
import { buildCoreMemoryPrompt, getCoreMemory } from "../memory/core.js";
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

// ─── Evening Briefing Job ────────────────────────────────────────────────────

/**
 * Evening Briefing — Sent at HEARTBEAT_EVENING_TIME (default 21:00 IST).
 *
 * Sends a short fixed-template wrap-up that pulls the morning goal from
 * core memory. No LLM call needed — saves tokens and keeps it snappy.
 */
async function eveningBriefing(bot: Bot, chatId: string): Promise<void> {
  console.log("[Heartbeat] Running evening briefing...");

  // Pull this morning's goal (if set) from core memory
  const morningGoal = getCoreMemory("last_daily_goal");

  // Build the message from a fixed template
  let message = "🌙 Evening check-in.\n\n";

  if (morningGoal) {
    message += `This morning you set out to: "${morningGoal}"\n\n`;
    message += "Did you hit it? What's the one thing you want to tackle first tomorrow?";
  } else {
    message += "How did today go? What's the one priority you want to tackle first thing tomorrow?";
  }

  try {
    await bot.api.sendMessage(chatId, mdToHtml(message), { parse_mode: "HTML" });
    await saveMessage(chatId, "model", message);
    console.log("[Heartbeat] Evening briefing sent.");
  } catch (err) {
    console.error("[Heartbeat] Failed to send evening briefing:", err);
  }
}

/**
 * Parse the HEARTBEAT_EVENING_TIME env var (format: "HH:MM").
 * Falls back to 21:00 if not set or malformed.
 */
function parseEveningTime(): { hour: number; minute: number } {
  const raw = process.env.HEARTBEAT_EVENING_TIME || "21:00";
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    console.warn(`[Heartbeat] Invalid HEARTBEAT_EVENING_TIME="${raw}" — using 21:00`);
    return { hour: 21, minute: 0 };
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.warn("[Heartbeat] HEARTBEAT_EVENING_TIME out of range — using 21:00");
    return { hour: 21, minute: 0 };
  }
  return { hour, minute };
}

const eveningTime = parseEveningTime();

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
    name: "Evening Briefing",
    hour: eveningTime.hour,
    minute: eveningTime.minute,
    execute: eveningBriefing,
  },
];
