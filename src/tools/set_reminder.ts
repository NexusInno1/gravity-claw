/**
 * set_reminder tool — Schedule a one-time reminder.
 *
 * Uses setTimeout internally. Reminders survive only while the bot
 * process is running (not persisted across restarts).
 */

import { Type, Tool } from "@google/genai";

export const setReminderDefinition: Tool = {
  functionDeclarations: [
    {
      name: "set_reminder",
      description:
        "Set a one-time reminder that will be sent to the user after a specified number of minutes. Use this when the user asks to be reminded about something later. The reminder message will be sent directly to the chat.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          message: {
            type: Type.STRING,
            description:
              "The reminder message to send (e.g. 'Time to drink water!')",
          },
          minutes: {
            type: Type.NUMBER,
            description:
              "Number of minutes from now to send the reminder (e.g. 30)",
          },
        },
        required: ["message", "minutes"],
      },
    },
  ],
};

/**
 * Callback type — the bot handler sets this so reminders can send messages.
 */
type ReminderSendFn = (chatId: string, message: string) => Promise<void>;

let sendCallback: ReminderSendFn | null = null;

/**
 * Register the send callback. Must be called once during bot initialization.
 */
export function initReminderCallback(fn: ReminderSendFn): void {
  sendCallback = fn;
  console.log("[Reminder] Callback registered.");
}

/**
 * Execute the set_reminder tool.
 */
export async function executeSetReminder(
  args: { message: string; minutes: number },
  chatId: string,
): Promise<string> {
  if (!sendCallback) {
    return "Error: Reminder system is not initialized.";
  }

  const { message, minutes } = args;

  if (!message || message.trim().length === 0) {
    return "Error: Reminder message cannot be empty.";
  }

  if (!minutes || minutes <= 0) {
    return "Error: Minutes must be a positive number.";
  }

  if (minutes > 1440) {
    return "Error: Reminders can be set for up to 24 hours (1440 minutes). For longer durations, ask me to set it again later.";
  }

  const delayMs = Math.round(minutes * 60 * 1000);
  const fireAt = new Date(Date.now() + delayMs);
  const fireAtStr = fireAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    timeStyle: "short",
    dateStyle: "short",
  });

  setTimeout(async () => {
    try {
      await sendCallback!(chatId, `⏰ **Reminder:** ${message}`);
      console.log(`[Reminder] Fired: "${message}" → chat ${chatId}`);
    } catch (err) {
      console.error(`[Reminder] Failed to send:`, err);
    }
  }, delayMs);

  console.log(
    `[Reminder] Scheduled "${message}" in ${minutes}min for chat ${chatId}`,
  );
  return `Reminder set! I'll remind you "${message}" at ${fireAtStr} (in ${minutes} minute${minutes === 1 ? "" : "s"}).`;
}
