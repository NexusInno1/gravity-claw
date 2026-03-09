/**
 * Heartbeat Jobs — Define all scheduled proactive messages here.
 *
 * Each job runs at a specific IST time and sends a message
 * to the user's Telegram chat.
 */

import { Bot } from "grammy";
import { getAI, withRetry } from "../lib/gemini.js";
import { executeWebSearch } from "../tools/web_search.js";
import { executeSerperSearch } from "../tools/serper_search.js";
import { ENV } from "../config.js";
import { buildCoreMemoryPrompt, getCoreMemory } from "../memory/core.js";
import { saveMessage } from "../memory/buffer.js";
import { HeartbeatJob } from "./scheduler.js";

/**
 * Morning Check-in — 8:00 AM IST Daily
 *
 * 1. Fetches today's global news
 * 2. Checks core memory for context (past goals, preferences)
 * 3. Generates a personalized morning message
 * 4. Asks "What is the biggest goal you want to achieve today?"
 */
async function morningCheckin(bot: Bot, chatId: string): Promise<void> {
  console.log("[Heartbeat] Running morning check-in...");

  // 1. Fetch global news
  let newsContext = "";
  try {
    // Prefer Serper (Google) for news links, fall back to Tavily
    const searchFn = ENV.SERPER_API_KEY
      ? executeSerperSearch
      : executeWebSearch;
    newsContext = await searchFn(
      "top global news headlines today " +
        new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
    );
  } catch (err) {
    console.error("[Heartbeat] News fetch failed:", err);
    newsContext = "Unable to fetch news today.";
  }

  // 2. Load core memory for personalization
  const coreMemory = buildCoreMemoryPrompt();
  const previousGoal = getCoreMemory("last_daily_goal");

  // 3. Generate morning message via Gemini
  const prompt = `You are Gravity Claw, a sharp personal AI assistant. Generate a concise morning check-in message for your user.

${coreMemory ? `## What you know about the user:\n${coreMemory}\n` : ""}
${previousGoal ? `## Their last stated goal:\n${previousGoal}\n` : ""}

## Today's Global News Summary:
${newsContext}

## Instructions:
1. Start with a brief, energetic greeting (1 line)
2. Give a concise summary of 3-5 most important global news items (bullet points, 1 line each)
3. If they had a previous goal, briefly ask about it
4. End by asking: "What is the biggest goal you want to achieve today?"

Keep it SHORT and punchy. No fluff, no filler. Total message should be under 300 words.`;

  try {
    const heartbeatContents = [
      { role: "user" as const, parts: [{ text: prompt }] },
    ];

    const response = await withRetry(
      () =>
        getAI().models.generateContent({
          model: ENV.GEMINI_MODEL,
          contents: heartbeatContents,
          config: { temperature: 0.7 },
        }),
      {
        contents: heartbeatContents,
        systemInstruction: undefined,
        tools: undefined,
        temperature: 0.7,
      },
    );

    const message =
      response.candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        .map((p) => p.text)
        .join("\n")
        .trim() || "Good morning! What's your biggest goal today?";

    await bot.api.sendMessage(chatId, message);
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
 * All heartbeat jobs.
 */
export const heartbeatJobs: HeartbeatJob[] = [
  {
    name: "Morning Check-in",
    hour: 8,
    minute: 0,
    execute: morningCheckin,
  },
];
