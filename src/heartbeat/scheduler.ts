import cron from "node-cron";
import type { Bot } from "grammy";
import { config } from "../config.js";
import { generateDailyCheckin, generateWeeklyDigest } from "./daily-checkin.js";
import { logCheckin } from "./accountability.js";

// ── Heartbeat Scheduler ──────────────────────────────────

/**
 * Start the daily heartbeat + weekly digest cron jobs.
 *
 * Daily check-in:  Every day at 9:00 AM IST
 * Weekly digest:   Sunday at 8:00 PM IST
 */
export function startHeartbeat(bot: Bot): void {
  // ── Daily check-in (9:00 AM IST) ────────────────────────
  const dailyTask = cron.schedule(
    "0 9 * * *",
    async () => {
      console.log("💓 Heartbeat triggered — sending daily check-ins...");

      for (const userId of config.allowedUserIds) {
        try {
          const { message, keyboard } = await generateDailyCheckin(
            String(userId),
          );

          // Log that a check-in was sent (responded = false until user replies)
          logCheckin(String(userId), { responded: false });

          // Send with inline keyboard buttons
          await bot.api
            .sendMessage(userId, message, {
              parse_mode: "Markdown",
              reply_markup: keyboard,
            })
            .catch(() =>
              bot.api.sendMessage(userId, message, {
                reply_markup: keyboard,
              }),
            );

          console.log(`  ✅ Check-in sent to ${userId}`);
        } catch (err) {
          console.error(`  ❌ Check-in failed for ${userId}:`, err);
        }
      }
    },
    {
      timezone: "Asia/Kolkata",
    },
  );

  dailyTask.start();
  console.log("💓 Daily heartbeat scheduled — 9:00 AM IST");

  // ── Weekly digest (Sunday 8:00 PM IST) ──────────────────
  const weeklyTask = cron.schedule(
    "0 20 * * 0",
    async () => {
      console.log("📊 Weekly digest triggered...");

      for (const userId of config.allowedUserIds) {
        try {
          const digest = await generateWeeklyDigest(String(userId));

          await bot.api
            .sendMessage(userId, digest, { parse_mode: "Markdown" })
            .catch(() => bot.api.sendMessage(userId, digest));

          console.log(`  ✅ Weekly digest sent to ${userId}`);
        } catch (err) {
          console.error(`  ❌ Weekly digest failed for ${userId}:`, err);
        }
      }
    },
    {
      timezone: "Asia/Kolkata",
    },
  );

  weeklyTask.start();
  console.log("📊 Weekly digest scheduled — Sunday 8:00 PM IST");
}
