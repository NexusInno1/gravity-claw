import type { ToolDefinition } from "./registry.js";
import { getBotRef } from "../bot/bot-ref.js";
import { log } from "../logger.js";
import { getPineconeIndex } from "../memory/pinecone.js";

// ── Set Reminder Tool ────────────────────────────────────

/** Embedding dimension must match the index (multilingual-e5-large = 1024) */
const ZERO_VECTOR = new Array(1024).fill(0);

// Track active reminders so we know how many are pending
const activeReminders = new Map<string, NodeJS.Timeout>();

interface ReminderDef {
  id: string;
  userId: string;
  message: string;
  fireAt: number; // Unix ms
}

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

// ── Pinecone Persistence ─────────────────────────────────

function reminderRecordId(reminderId: string): string {
  return `reminder-${reminderId}`;
}

async function saveReminderToPinecone(reminder: ReminderDef): Promise<void> {
  try {
    const index = getPineconeIndex();
    await index.upsert({
      records: [
        {
          id: reminderRecordId(reminder.id),
          values: ZERO_VECTOR,
          metadata: {
            _type: "reminder",
            reminderId: reminder.id,
            userId: reminder.userId,
            message: reminder.message.slice(0, 1000),
            fireAt: reminder.fireAt,
          },
        },
      ],
    });
  } catch (err) {
    log.warn(err, "⚠️ Failed to save reminder to Pinecone");
  }
}

async function deleteReminderFromPinecone(reminderId: string): Promise<void> {
  try {
    const index = getPineconeIndex();
    await index.deleteOne({ id: reminderRecordId(reminderId) });
  } catch (err) {
    log.warn(err, "⚠️ Failed to delete reminder from Pinecone");
  }
}

async function loadRemindersFromPinecone(): Promise<ReminderDef[]> {
  try {
    const index = getPineconeIndex();
    const result = await index.query({
      vector: ZERO_VECTOR,
      topK: 50,
      filter: { _type: { $eq: "reminder" } },
      includeMetadata: true,
    });

    return (result.matches ?? [])
      .filter((m) => m.metadata)
      .map((m) => ({
        id: String(m.metadata!["reminderId"] ?? ""),
        userId: String(m.metadata!["userId"] ?? ""),
        message: String(m.metadata!["message"] ?? ""),
        fireAt: Number(m.metadata!["fireAt"] ?? 0),
      }))
      .filter((r) => r.id && r.fireAt > 0);
  } catch (err) {
    log.warn(err, "⚠️ Failed to load reminders from Pinecone");
    return [];
  }
}

// ── Timer Management ─────────────────────────────────────

function scheduleReminderTimer(reminder: ReminderDef): void {
  const now = Date.now();
  const delayMs = reminder.fireAt - now;

  if (delayMs <= 0) {
    // Already past — fire immediately
    void fireReminder(reminder);
    return;
  }

  // Cap setTimeout at 24 hours (Node.js can handle this fine)
  const timer = setTimeout(() => void fireReminder(reminder), delayMs);
  activeReminders.set(reminder.id, timer);
}

async function fireReminder(reminder: ReminderDef): Promise<void> {
  try {
    const bot = getBotRef();
    const chatId = parseInt(reminder.userId, 10);
    await bot.api
      .sendMessage(chatId, `⏰ *Reminder*\n\n${reminder.message}`, {
        parse_mode: "Markdown",
      })
      .catch(() =>
        bot.api.sendMessage(chatId, `⏰ Reminder\n\n${reminder.message}`),
      );

    log.info(
      { reminderId: reminder.id, userId: reminder.userId },
      "⏰ Reminder delivered",
    );
  } catch (err) {
    log.error(err, "❌ Failed to deliver reminder");
  } finally {
    activeReminders.delete(reminder.id);
    void deleteReminderFromPinecone(reminder.id);
  }
}

// ── Init — restore reminders from Pinecone ───────────────

export async function initReminders(): Promise<void> {
  const reminders = await loadRemindersFromPinecone();
  const now = Date.now();
  let restored = 0;

  for (const reminder of reminders) {
    if (reminder.fireAt > now) {
      scheduleReminderTimer(reminder);
      restored++;
    } else {
      // Expired while bot was down — fire now
      void fireReminder(reminder);
      restored++;
    }
  }

  if (reminders.length > 0) {
    log.info(
      { restored, total: reminders.length },
      "⏰ Reminders restored from Pinecone",
    );
  }
}

// ── Tool Definition ──────────────────────────────────────

export const setReminder: ToolDefinition = {
  name: "set_reminder",
  description: `Set a one-off reminder that sends a message after a specified delay. Reminders survive bot restarts.

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
    const fireAt = Date.now() + delayMs;
    const delayMinutes = Math.round(delayMs / 60000);

    const reminder: ReminderDef = { id: reminderId, userId, message, fireAt };

    // Save to Pinecone first (so it survives restarts)
    await saveReminderToPinecone(reminder);

    // Then set the in-memory timer
    scheduleReminderTimer(reminder);

    log.info({ reminderId, userId, delayMs, delayMinutes }, "⏰ Reminder set");

    return {
      success: true,
      reminderId,
      delayMinutes: delayMinutes || `${Math.round(delayMs / 1000)} seconds`,
      message: `Reminder set! I'll send "${message}" in ${delayMinutes > 0 ? `${delayMinutes} minute(s)` : `${Math.round(delayMs / 1000)} seconds`}.`,
    };
  },
};
