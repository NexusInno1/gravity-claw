import { TelegramChannel } from "./channels/telegram.js";
import { ENV } from "./config.js";
import { loadCoreMemories } from "./memory/core.js";
import { isSupabaseReady } from "./lib/supabase.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat/scheduler.js";
import { heartbeatJobs } from "./heartbeat/jobs.js";
import type { IncomingMessage } from "./channels/types.js";
import { runAgentLoop, runAgentLoopWithImage } from "./agent/loop.js";
import { mcpManager } from "./mcp/mcp-manager.js";

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

  // Initialize MCP servers (loads mcp.json)
  await mcpManager.init();

  // Create the Telegram channel adapter
  const channel = new TelegramChannel();

  // Wire the agent loop as the message handler
  channel.onMessage(async (msg: IncomingMessage): Promise<string> => {
    if (msg.imageBase64 && msg.imageMimeType) {
      return runAgentLoopWithImage(
        msg.text || "What's in this image? Describe and analyze it.",
        msg.chatId,
        msg.imageBase64,
        msg.imageMimeType,
      );
    }
    return runAgentLoop(msg.text || "", msg.chatId);
  });

  // Start the channel
  await channel.start();

  // Start heartbeat scheduler after channel is connected
  if (ENV.HEARTBEAT_CHAT_ID) {
    startHeartbeat(channel.getBot(), ENV.HEARTBEAT_CHAT_ID, heartbeatJobs);
  } else {
    console.warn(
      "[Heartbeat] No HEARTBEAT_CHAT_ID set — scheduler disabled.",
    );
  }

  console.log("==========================================");

  // Graceful shutdown handlers
  const shutdown = () => {
    console.log("🔴 Gravity Claw shutdown signal received — cleaning up...");
    stopHeartbeat();
    mcpManager.shutdown().catch(() => {});
    channel.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  console.error("[Fatal] Failed to start:", err);
  process.exit(1);
});
