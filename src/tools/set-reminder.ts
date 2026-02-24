import type { ToolDefinition } from "./registry.js";
import { getBotRef } from "../bot/bot-ref.js";
import { log } from "../logger.js";

// ── Set Reminder Tool ────────────────────────────────────

// Track active reminders so we know how many are pending
const activeReminders = new Map<string, NodeJS.Timeout>();

/**
 * Parse delay from natural language or minutes.
 * Returns delay in milliseconds, or null if unparseable.
 */
function parseDelay(input: string): number | null {
  const trimmed = input.trim().toLowerCase();

  // Direct minutes: "5", "30"
  const directNum = parseFloat(trimmed);
  if (!isNaN(directNum) && directNum > 0) {
    return directNum * 60 * 1000;
  }

  // "in X minutes/hours/seconds"
  const match = trimmed.match(
    /(?:in\s+)?(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)/i,
  );
  if (match) {
    const value = parseFloat(match[1]!);
    const unit = match[2]!.toLowerCase();

    if (unit.startsWith("s")) return value * 1000;
    if (unit.startsWith("m") && !unit.startsWith("mo"))
      return value * 60 * 1000;
    if (unit.startsWith("h")) return value * 60 * 60 * 1000;
    if (unit.startsWith("d")) return value * 24 * 60 * 60 * 1000;
  }

  return null;
}

export const setReminder: ToolDefinition = {
  name: "set_reminder",
  description: `Set a one-off reminder that sends a message after a specified delay. Unlike scheduled tasks (which are recurring), reminders fire once and are then forgotten.

Supports natural language delays:
- "5" or "5 minutes" → 5 minutes
- "in 2 hours" → 2 hours  
- "30 seconds" → 30 seconds
- "1 day" → 24 hours

Maximum delay: 24 hours. For recurring reminders, use schedule_task instead.`,

  parameters: {
    type: "object" as const,
    properties: {
      delay: {
        type: "string",
        description:
          'When to send the reminder. Natural language like "5 minutes", "in 2 hours", "30 seconds", or just a number (treated as minutes).',
      },
      message: {
        type: "string",
        description: "The reminder message to send.",
      },
      user_id: {
        type: "string",
        description: "The user's Telegram ID.",
      },
    },
    required: ["delay", "message", "user_id"],
  },

  execute: async (input: Record<string, unknown>) => {
    const delayInput = input.delay as string;
    const message = input.message as string;
    const userId = input.user_id as string;

    if (!delayInput || !message || !userId) {
      return { error: "delay, message, and user_id are all required." };
    }

    const delayMs = parseDelay(delayInput);
    if (!delayMs) {
      return {
        error: `Could not parse delay: "${delayInput}". Try "5 minutes", "in 2 hours", or just a number (minutes).`,
      };
    }

    // Cap at 24 hours
    const maxDelay = 24 * 60 * 60 * 1000;
    if (delayMs > maxDelay) {
      return {
        error:
          "Maximum reminder delay is 24 hours. For longer delays, use schedule_task instead.",
      };
    }

    const reminderId = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const delayMinutes = Math.round(delayMs / 60000);

    // Set the timer
    const timer = setTimeout(async () => {
      try {
        const bot = getBotRef();
        const chatId = parseInt(userId, 10);
        await bot.api
          .sendMessage(chatId, `⏰ *Reminder*\n\n${message}`, {
            parse_mode: "Markdown",
          })
          .catch(() =>
            bot.api.sendMessage(chatId, `⏰ Reminder\n\n${message}`),
          );

        log.info({ reminderId, userId }, "⏰ Reminder delivered");
      } catch (err) {
        log.error(err, "❌ Failed to deliver reminder");
      } finally {
        activeReminders.delete(reminderId);
      }
    }, delayMs);

    activeReminders.set(reminderId, timer);

    log.info({ reminderId, userId, delayMs, delayMinutes }, "⏰ Reminder set");

    return {
      success: true,
      reminderId,
      delayMinutes: delayMinutes || `${Math.round(delayMs / 1000)} seconds`,
      message: `Reminder set! I'll send "${message}" in ${delayMinutes > 0 ? `${delayMinutes} minute(s)` : `${Math.round(delayMs / 1000)} seconds`}.`,
    };
  },
};
