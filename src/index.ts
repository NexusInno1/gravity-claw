import { TelegramChannel } from "./channels/telegram.js";
import { DiscordChannel } from "./channels/discord.js";
import { ENV } from "./config.js";
import { loadCoreMemories } from "./memory/core.js";
import { isSupabaseReady } from "./lib/supabase.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat/scheduler.js";
import { heartbeatJobs } from "./heartbeat/jobs.js";
import type { IncomingMessage, Channel } from "./channels/types.js";
import { runAgentLoop, runAgentLoopWithImage } from "./agent/loop.js";
import { mcpManager } from "./mcp/mcp-manager.js";
import { handleSlashCommand } from "./commands/slash-commands.js";

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

  // Shared message handler for all channels
  const messageHandler = async (msg: IncomingMessage): Promise<string> => {
    // ── Slash command interception (zero token cost) ──────────────
    if (msg.text) {
      const slashResult = await handleSlashCommand(msg.text, msg.chatId);
      if (slashResult.handled) {
        return slashResult.response ?? "";
      }
    }

    if (msg.imageBase64 && msg.imageMimeType) {
      return runAgentLoopWithImage(
        msg.text || "What's in this image? Describe and analyze it.",
        msg.chatId,
        msg.imageBase64,
        msg.imageMimeType,
      );
    }
    return runAgentLoop(msg.text || "", msg.chatId);
  };

  // Track active channels for shutdown
  const activeChannels: Channel[] = [];

  // ── Telegram Channel ───────────────────────────────────────────
  if (ENV.TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramChannel();
    telegram.onMessage(messageHandler);
    await telegram.start();
    activeChannels.push(telegram);

    // Start heartbeat scheduler after Telegram is connected
    if (ENV.HEARTBEAT_CHAT_ID) {
      startHeartbeat(telegram.getBot(), ENV.HEARTBEAT_CHAT_ID, heartbeatJobs);
    } else {
      console.warn(
        "[Heartbeat] No HEARTBEAT_CHAT_ID set — scheduler disabled.",
      );
    }
  }

  // ── Discord Channel ────────────────────────────────────────────
  if (ENV.DISCORD_BOT_TOKEN) {
    const discord = new DiscordChannel();
    discord.onMessage(messageHandler);
    await discord.start();
    activeChannels.push(discord);
  }

  if (activeChannels.length === 0) {
    throw new Error("No channels started — check your .env for bot tokens.");
  }

  console.log(
    `[Channels] Active: ${activeChannels.map((c) => c.name).join(", ")}`,
  );
  console.log("==========================================");

  // Graceful shutdown handlers
  const shutdown = () => {
    console.log("🔴 Gravity Claw shutdown signal received — cleaning up...");
    stopHeartbeat();
    mcpManager.shutdown().catch(() => { });
    for (const channel of activeChannels) {
      channel.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  console.error("[Fatal] Failed to start:", err);
  process.exit(1);
});
