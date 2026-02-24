import type { Bot } from "grammy";

// ── Bot Reference Singleton ──────────────────────────────
// Allows tools (send-file, set-reminder) to access the bot
// without circular imports. Set once during startup in index.ts.

let _bot: Bot | null = null;

export function setBotRef(bot: Bot): void {
  _bot = bot;
}

export function getBotRef(): Bot {
  if (!_bot) {
    throw new Error("Bot reference not initialised. Call setBotRef() first.");
  }
  return _bot;
}
