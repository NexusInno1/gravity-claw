/**
 * Heartbeat Scheduler
 *
 * A lightweight scheduler that checks every 60 seconds if any
 * heartbeat job is due. Uses IST (Asia/Kolkata) for all scheduling.
 *
 * No external cron dependencies — pure Node.js setInterval.
 */

import { Bot } from "grammy";

export interface HeartbeatJob {
  name: string;
  /** Hour in IST (0-23) */
  hour: number;
  /** Minute in IST (0-59) */
  minute: number;
  /** The function to execute when the job is due */
  execute: (bot: Bot, chatId: string) => Promise<void>;
}

// Track last run date per job to prevent duplicate sends
const lastRunDates = new Map<string, string>();

/**
 * Get the current date and time in IST.
 */
function getISTNow(): { hour: number; minute: number; dateKey: string } {
  const now = new Date();
  const istString = now.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
  const istDate = new Date(istString);

  // Date key to track "already ran today"
  const dateKey = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

  return {
    hour: istDate.getHours(),
    minute: istDate.getMinutes(),
    dateKey,
  };
}

/**
 * Start the heartbeat scheduler.
 * Checks every 60 seconds if any job should fire.
 */
export function startHeartbeat(
  bot: Bot,
  chatId: string,
  jobs: HeartbeatJob[],
): void {
  console.log(`[Heartbeat] Scheduler started with ${jobs.length} job(s).`);
  console.log(`[Heartbeat] Target chat: ${chatId}`);

  for (const job of jobs) {
    const timeStr = `${String(job.hour).padStart(2, "0")}:${String(job.minute).padStart(2, "0")}`;
    console.log(`[Heartbeat]   → "${job.name}" scheduled at ${timeStr} IST`);
  }

  // Check every 60 seconds
  setInterval(() => {
    const { hour, minute, dateKey } = getISTNow();

    for (const job of jobs) {
      // Check if it's within the scheduled minute window
      if (hour === job.hour && minute === job.minute) {
        const runKey = `${job.name}_${dateKey}`;

        // Skip if already ran today
        if (lastRunDates.has(runKey)) continue;

        // Mark as ran
        lastRunDates.set(runKey, dateKey);

        console.log(`[Heartbeat] Firing job: "${job.name}"`);

        job.execute(bot, chatId).catch((err) => {
          console.error(`[Heartbeat] Job "${job.name}" failed:`, err);
        });
      }
    }

    // Clean up old entries (keep only today's)
    const { dateKey: today } = getISTNow();
    for (const [key, date] of lastRunDates) {
      if (date !== today) lastRunDates.delete(key);
    }
  }, 60_000); // Every 60 seconds
}
