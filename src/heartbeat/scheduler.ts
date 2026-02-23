import cron from "node-cron";
import type { Bot } from "grammy";
import { config } from "../config.js";
import { generateDailyCheckin, generateWeeklyDigest } from "./daily-checkin.js";
import { logCheckin, wasCheckinSentToday } from "./accountability.js";
import { log } from "../logger.js";

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
      log.info("💓 Heartbeat triggered — sending daily check-ins...");

      for (const userId of config.allowedUserIds) {
        try {
          // Skip if already sent today (e.g. after a mid-day restart)
          if (wasCheckinSentToday(String(userId))) {
            log.info({ userId }, "  ⏭️ Check-in already sent today");
            continue;
          }

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

          log.info({ userId }, "  📨 Daily check-in sent");
        } catch (err) {
          log.error(err, "❌ Failed to send check-in");
        }
      }
    },
    {
      timezone: "Asia/Kolkata",
    },
  );

  dailyTask.start();
  // ── Weekly digest (Sunday 8:00 PM IST) ──────────────────
  const weeklyTask = cron.schedule(
    "0 20 * * 0",
    async () => {
      log.info("📊 Weekly digest triggered...");

      for (const userId of config.allowedUserIds) {
        try {
          const digest = await generateWeeklyDigest(String(userId));

          await bot.api
            .sendMessage(userId, digest, { parse_mode: "Markdown" })
            .catch(() => bot.api.sendMessage(userId, digest));

          log.info({ userId }, "  📨 Weekly digest sent");
        } catch (err) {
          log.error(err, "❌ Failed to send weekly digest");
        }
      }
    },
    {
      timezone: "Asia/Kolkata",
    },
  );

  weeklyTask.start();
  log.info("⏰ Heartbeat scheduled: daily 9 AM IST + weekly Sunday 8 PM IST");
}
