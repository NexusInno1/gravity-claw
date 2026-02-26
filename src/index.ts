import { config } from "./config.js";
import { log } from "./logger.js";
import { createBot } from "./bot.js";
import { ToolRegistry } from "./tools/registry.js";
import { getCurrentTime } from "./tools/get-current-time.js";
import { webSearch } from "./tools/web-search.js";
import { readUrl } from "./tools/read-url.js";

// ── Main ─────────────────────────────────────────────────

async function main() {
  log.info(
    {
      model: config.llmModel,
      users: config.allowedUserIds,
    },
    "🦅 Gravity Claw — Level 1 (Strict Reactivity)",
  );

  // Register strictly limited tools
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(getCurrentTime);
  toolRegistry.register(webSearch);
  toolRegistry.register(readUrl);

  log.info(
    { count: toolRegistry.getOpenAITools().length },
    "🔧 Tools registered",
  );

  // Create bot (long-polling)
  const bot = createBot(toolRegistry);

  // Graceful shutdown
  const shutdown = async () => {
    log.info("👋 Shutting down Gravity Claw...");
    bot.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Start
  log.info("🚀 Starting Telegram long-polling...");
  await bot.start({
    onStart: () => {
      log.info("✅ Gravity Claw is online. Waiting for messages...");
    },
  });
}

main().catch((error) => {
  log.fatal(error, "💀 Fatal error");
  process.exit(1);
});
