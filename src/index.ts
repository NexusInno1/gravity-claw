import { config } from "./config.js";
import { createBot } from "./bot.js";
import { ToolRegistry } from "./tools/registry.js";
import { getCurrentTime } from "./tools/get-current-time.js";
import { webSearch } from "./tools/web-search.js";
import { pushCanvas } from "./tools/push-canvas.js";
import { browserTool } from "./tools/browser.js";
import { scheduleTask } from "./tools/schedule-task.js";
import { manageTasks } from "./tools/manage-tasks.js";
import { webhookTool } from "./tools/webhook-tool.js";
import { startHeartbeat } from "./heartbeat/scheduler.js";
import { startCanvasServer, setWebhookHandler } from "./canvas/server.js";
import { initTaskScheduler } from "./scheduler/task-scheduler.js";
import {
  initWebhookManager,
  handleWebhookTrigger,
} from "./webhooks/webhook-manager.js";
import { closeBrowser } from "./tools/browser-manager.js";

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("🦅 Gravity Claw — Level 3 (Tools & Automation)");
  console.log("────────────────────────────────────────");
  console.log(`   Model:      ${config.llmModel}`);
  console.log(`   Users:      [${config.allowedUserIds.join(", ")}]`);
  console.log(`   Max iters:  ${config.maxAgentIterations}`);
  console.log("────────────────────────────────────────");
  console.log("");

  // Register tools
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(getCurrentTime);
  toolRegistry.register(webSearch);
  toolRegistry.register(pushCanvas);
  toolRegistry.register(browserTool);
  toolRegistry.register(scheduleTask);
  toolRegistry.register(manageTasks);
  toolRegistry.register(webhookTool);
  console.log(`🔧 Registered ${toolRegistry.getOpenAITools().length} tool(s)`);

  // Start Live Canvas server (HTTP + WebSocket + Webhooks)
  startCanvasServer();

  // Create bot (long-polling)
  const bot = createBot(toolRegistry);

  // Start daily heartbeat (9:00 AM IST)
  startHeartbeat(bot);

  // Init scheduled task engine (restores saved tasks)
  initTaskScheduler(bot, toolRegistry);

  // Init webhook manager + wire route handler into canvas server
  initWebhookManager(bot, toolRegistry);
  setWebhookHandler(handleWebhookTrigger);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n👋 Shutting down Gravity Claw...");
    await closeBrowser();
    bot.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Start
  console.log("🚀 Starting Telegram long-polling...\n");
  await bot.start({
    onStart: () => {
      console.log("✅ Gravity Claw is online. Waiting for messages...\n");
    },
  });
}

main().catch((error) => {
  console.error("💀 Fatal error:", error);
  process.exit(1);
});
