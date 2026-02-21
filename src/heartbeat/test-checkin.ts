/**
 * One-shot script to test the daily check-in.
 * Run: npx tsx src/heartbeat/test-checkin.ts
 */
import { generateDailyCheckin } from "./daily-checkin.js";
import { config } from "../config.js";
import { Bot } from "grammy";

async function main() {
  const userId = String(config.allowedUserIds[0]);
  console.log(`💓 Generating test check-in for user ${userId}...\n`);

  const { message, keyboard } = await generateDailyCheckin(userId);
  console.log("📨 Message:\n", message, "\n");
  console.log("🔘 Keyboard buttons included\n");

  // Send it via Telegram with inline buttons
  const bot = new Bot(config.telegramBotToken);
  await bot.api
    .sendMessage(config.allowedUserIds[0]!, message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
    .catch(() =>
      bot.api.sendMessage(config.allowedUserIds[0]!, message, {
        reply_markup: keyboard,
      }),
    );

  console.log("✅ Sent to Telegram with inline buttons!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
