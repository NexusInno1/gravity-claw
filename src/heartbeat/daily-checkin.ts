import { InlineKeyboard } from "grammy";
import { llm, getSystemPrompt } from "../llm/claude.js";
import { config } from "../config.js";
import { getFacts } from "../memory/facts-store.js";
import { buildMemoryContext } from "../memory/context-builder.js";
import { memoryManager } from "../memory/manager.js";
import { getCheckinHistory, getWeeklySummary } from "./accountability.js";
import { log } from "../logger.js";

// ── Daily Check-in Message Generator ─────────────────────

export interface CheckinResult {
  message: string;
  keyboard: InlineKeyboard;
}

/**
 * Generate a personalised daily accountability check-in message
 * with inline keyboard buttons for quick responses.
 */
export async function generateDailyCheckin(
  userId: string,
): Promise<CheckinResult> {
  const facts = getFacts(userId);
  const memCtx = await memoryManager.getContext(
    userId,
    "daily morning check-in accountability",
  );
  const memoryBlock = buildMemoryContext(memCtx);

  const factsBlock = Object.entries(facts)
    .map(([k, v]) => `• ${k}: ${v}`)
    .join("\n");

  // Include recent accountability data for smarter check-ins
  const recentHistory = getCheckinHistory(userId, 7);
  const summary = getWeeklySummary(userId);

  let accountabilityBlock = "";
  if (recentHistory.length > 0) {
    const historyLines = recentHistory.slice(0, 5).map((e) => {
      const moodEmoji =
        e.mood === "on_track" ? "✅" : e.mood === "struggling" ? "⚠️" : "⏭️";
      const weight = e.weightTracked ? "🏋️" : "";
      return `  ${e.date}: ${moodEmoji} ${weight} ${e.goal ?? "—"}`;
    });

    accountabilityBlock = `
Recent check-in history:
${historyLines.join("\n")}

Stats: ${summary.streak}-day streak, ${Math.round(summary.responseRate * 100)}% response rate, weight tracked ${summary.weightTrackedDays}/7 days`;
  }

  const prompt = `You are doing your daily morning check-in with the user.

${memoryBlock ? `\nMemory context:\n${memoryBlock}\n` : ""}
${factsBlock ? `\nKnown facts about the user:\n${factsBlock}\n` : ""}
${accountabilityBlock ? `\nAccountability data:\n${accountabilityBlock}\n` : ""}

Generate a SHORT, punchy morning accountability message for the user. Follow these rules:
- Address them by name if you know it
- Ask if they've tracked their weight today
- Ask what's the ONE biggest goal they want to achieve today
- Reference their streak or patterns from accountability data if available
- If they've been struggling, acknowledge it and adjust tone
- If they have a strong streak, celebrate it briefly
- Keep the tone casual, direct, and motivating — no corporate fluff
- Keep it under 200 words
- Use Telegram Markdown formatting
- End with something that makes them want to reply
- DO NOT include buttons or action items — those will be added automatically as inline buttons

Remember: you're their accountability partner, not a motivational poster.`;

  const keyboard = buildCheckinKeyboard();

  try {
    const response = await llm.chat.completions.create({
      model: config.llmModel,
      max_tokens: 512,
      messages: [
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: prompt },
      ],
    });

    const message =
      response.choices[0]?.message?.content?.trim() ??
      "🦅 Morning! Did you track your weight? What's your #1 goal today?";

    return { message, keyboard };
  } catch (err) {
    log.error(err, "❌ Daily check-in generation failed");
    return {
      message:
        "🦅 Morning! Did you track your weight? What's your #1 goal today?",
      keyboard,
    };
  }
}

/**
 * Generate a weekly digest/summary message.
 */
export async function generateWeeklyDigest(userId: string): Promise<string> {
  const facts = getFacts(userId);
  const summary = getWeeklySummary(userId);
  const history = getCheckinHistory(userId, 7);

  const factsBlock = Object.entries(facts)
    .map(([k, v]) => `• ${k}: ${v}`)
    .join("\n");

  const historyBlock = history
    .map((e) => {
      const mood =
        e.mood === "on_track"
          ? "✅ On Track"
          : e.mood === "struggling"
            ? "⚠️ Struggling"
            : "—";
      return `  ${e.date}: ${mood} | Weight: ${e.weightTracked ? "Yes" : "No"} | Goal: ${e.goal ?? "—"}`;
    })
    .join("\n");

  const prompt = `Generate a weekly accountability digest for the user.

${factsBlock ? `Known facts:\n${factsBlock}\n` : ""}

This week's data:
${historyBlock || "  No check-in data this week."}

Stats:
- Response rate: ${Math.round(summary.responseRate * 100)}%
- Current streak: ${summary.streak} days
- Weight tracked: ${summary.weightTrackedDays}/7 days
- Mood breakdown: ${JSON.stringify(summary.moodBreakdown)}

Write a concise weekly review (under 250 words):
- Highlight patterns (good and bad)
- Call out wins worth celebrating
- Identify one area to improve next week
- Set a challenge for next week
- Use Telegram Markdown formatting
- Keep the tone honest and motivating — not preachy`;

  try {
    const response = await llm.chat.completions.create({
      model: config.llmModel,
      max_tokens: 512,
      messages: [
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: prompt },
      ],
    });

    return (
      response.choices[0]?.message?.content?.trim() ??
      "📊 Weekly digest unavailable. Keep showing up!"
    );
  } catch (err) {
    log.error(err, "❌ Weekly digest generation failed");
    return "📊 Weekly digest unavailable. Keep showing up!";
  }
}

// ── Inline Keyboard Builder ──────────────────────────────

function buildCheckinKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ On Track", "checkin:on_track")
    .text("⚠️ Struggling", "checkin:struggling")
    .row()
    .text("🏋️ Weight Tracked", "checkin:weight_yes")
    .text("⏭️ Skip Today", "checkin:skip")
    .row()
    .text("📝 Update Goals", "checkin:update_goals");
}
