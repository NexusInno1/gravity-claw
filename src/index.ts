import { bot } from "./bot/index.js";
import { ENV } from "./config.js";
import { loadCoreMemories } from "./memory/core.js";
import { isSupabaseReady } from "./lib/supabase.js";
import { startHeartbeat } from "./heartbeat/scheduler.js";
import { heartbeatJobs } from "./heartbeat/jobs.js";

console.log("============== Gravity Claw ==============");
console.log("Initializing secure local environment...");
console.log(`Allowed Users: ${Array.from(ENV.ALLOWED_USER_IDS).join(", ")}`);

// Initialize memory system before starting the bot
async function start() {
  // Check Supabase connection
  const supabaseOk = await isSupabaseReady();
  if (supabaseOk) {
    console.log("[Memory] Supabase connected — all 3 memory tiers active.");
    await loadCoreMemories();
  } else {
    console.warn(
      "[Memory] Supabase unavailable — running without persistent memory.",
    );
  }

  // Start long-polling
  bot.start({
    onStart: (botInfo) => {
      console.log(
        `[Bot] Successfully connected and running as @${botInfo.username}`,
      );

      // Start heartbeat scheduler after bot is connected
      if (ENV.HEARTBEAT_CHAT_ID) {
        startHeartbeat(bot, ENV.HEARTBEAT_CHAT_ID, heartbeatJobs);
      } else {
        console.warn(
          "[Heartbeat] No HEARTBEAT_CHAT_ID set — scheduler disabled.",
        );
      }

      console.log("==========================================");
    },
  });
}

start().catch((err) => {
  console.error("[Fatal] Failed to start:", err);
  process.exit(1);
});

// Graceful shutdown handlers
process.on("SIGINT", () => {
  console.log("🔴 Gravity Claw shutdown signal received — cleaning up...");
  bot.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("🔴 Gravity Claw shutdown signal received — cleaning up...");
  bot.stop();
  process.exit(0);
});
