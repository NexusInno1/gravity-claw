import { Bot } from "grammy";
import { log } from "./logger.js";
import { config } from "./config.js";
import { runAgentLoop } from "./agent/loop.js";
import type { ToolRegistry } from "./tools/registry.js";
import { usageTracker } from "./usage/tracker.js";
import { memoryManager } from "./memory/manager.js";
import {
  needsOnboarding,
  startOnboarding,
  isOnboarding,
  processOnboardingAnswer,
} from "./memory/onboarding.js";
import { logCheckin } from "./heartbeat/accountability.js";
import { TypingIndicator } from "./bot/typing.js";
import { listTasks } from "./scheduler/task-scheduler.js";

// ── Bot Factory ──────────────────────────────────────────

export function createBot(toolRegistry: ToolRegistry): Bot {
  const bot = new Bot(config.telegramBotToken);

  // ── Security: user ID whitelist ──────────────────────
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !config.allowedUserIds.includes(userId)) {
      return; // silent ignore
    }
    await next();
  });

  // ── /start ──────────────────────────────────────────
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "🦅 *Gravity Claw is online\\.*\n\n" +
        "I'm your personal AI assistant\\. Send me a message and I'll help\\.\n\n" +
        "*Level 2* — Memory Active 🧠\n" +
        `• Model: \`${escapeMarkdownV2(config.llmModel)}\`\n` +
        `• Tools: ${toolRegistry.getOpenAITools().length}\n\n` +
        "Type /help for available commands\\.",
      { parse_mode: "MarkdownV2" },
    );
  });

  // ── /help ───────────────────────────────────────────
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "🦅 *Commands*\n" +
        "────────────────────\n" +
        "/start — Welcome message\n" +
        "/status — Bot status & info\n" +
        "/new — Clear session context (long-term memory kept)\n" +
        "/model — Current model info\n" +
        "/usage — Token usage & costs\n" +
        "/compact — Summarise & compress conversation\n" +
        "/help — This message",
      { parse_mode: "Markdown" },
    );
  });

  // ── /status ─────────────────────────────────────────
  bot.command("status", async (ctx) => {
    const tools = toolRegistry.getOpenAITools();
    const toolNames = tools.map((t) => t.function.name).join(", ");
    const userId = String(ctx.from!.id);
    const bufferSize = memoryManager.getBuffer(userId).length;

    await ctx.reply(
      "🦅 *Bot Status*\n" +
        "────────────────────\n" +
        `⏱ Uptime: ${usageTracker.getUptime()}\n` +
        `🤖 Model: \`${config.llmModel}\`\n` +
        `🔧 Tools: ${tools.length} (${toolNames || "none"})\n` +
        `📞 Calls: ${usageTracker.getCallCount()}\n` +
        `🧠 Memory buffer: ${bufferSize} messages\n` +
        `👤 Allowed users: ${config.allowedUserIds.length}\n` +
        `🔄 Max iterations: ${config.maxAgentIterations}`,
      { parse_mode: "Markdown" },
    );
  });

  // ── /new ────────────────────────────────────────────
  bot.command("new", async (ctx) => {
    const userId = String(ctx.from!.id);
    memoryManager.clearSession(userId);
    await ctx.reply(
      "🆕 *New conversation started\\!*\n\n" +
        "Session context cleared\\. Long\\-term memory is preserved \\— I still remember you\\!\n" +
        "Send me a fresh message\\.",
      { parse_mode: "MarkdownV2" },
    );
  });

  // ── /model ──────────────────────────────────────────
  bot.command("model", async (ctx) => {
    await ctx.reply(
      "🤖 *Current Model*\n" +
        "────────────────────\n" +
        `Model: \`${config.llmModel}\`\n` +
        `Provider: OpenRouter\n` +
        `Max iterations: ${config.maxAgentIterations}\n\n` +
        "_Change model in .env and restart._",
      { parse_mode: "Markdown" },
    );
  });

  // ── /usage ──────────────────────────────────────────
  bot.command("usage", async (ctx) => {
    const summary = usageTracker.getSummary();
    await ctx
      .reply(summary, { parse_mode: "Markdown" })
      .catch(() => ctx.reply(summary));
  });

  // ── /compact ────────────────────────────────────────
  bot.command("compact", async (ctx) => {
    const userId = String(ctx.from!.id);
    const buf = memoryManager.getBuffer(userId);

    if (buf.length === 0) {
      await ctx.reply(
        "📦 *Compact*\n\nNothing to compact — session buffer is empty\\.",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    await ctx.reply("📦 Compacting conversation…", { parse_mode: "Markdown" });

    try {
      await memoryManager.compactSession(userId);
      await ctx.reply(
        "✅ *Compacted\\!*\n\n" +
          "Conversation summarised and saved to long\\-term memory\\. " +
          "Session buffer cleared\\.",
        { parse_mode: "MarkdownV2" },
      );
    } catch {
      await ctx.reply("⚠️ Compaction failed. Check logs.");
    }
  });

  // ── /tasks ───────────────────────────────────────────
  bot.command("tasks", async (ctx) => {
    const userId = String(ctx.from!.id);
    const tasks = listTasks(userId);

    if (tasks.length === 0) {
      await ctx.reply("⏰ *Scheduled Tasks*\n\nNo tasks scheduled\\.", {
        parse_mode: "MarkdownV2",
      });
      return;
    }

    const lines = tasks.map(
      (t, i) =>
        `${i + 1}. ${t.paused ? "⏸️" : "▶️"} *${t.label}*\n` +
        `   Schedule: \`${t.cronExpression}\`\n` +
        `   ID: \`${t.id}\``,
    );

    await ctx
      .reply(
        `⏰ *Scheduled Tasks* (${tasks.length})\n\n${lines.join("\n\n")}`,
        {
          parse_mode: "Markdown",
        },
      )
      .catch(() => ctx.reply(lines.join("\n\n")));
  });

  // ── Inline button callbacks (heartbeat buttons) ──────────
  bot.on("callback_query:data", async (ctx) => {
    const userId = String(ctx.from.id);
    const data = ctx.callbackQuery.data;

    log.info({ userId, button: data }, "🔘 Button pressed");

    try {
      if (data === "checkin:on_track") {
        logCheckin(userId, { responded: true, mood: "on_track" });
        await ctx.answerCallbackQuery({ text: "✅ Logged: On Track!" });
        await ctx.reply(
          "💪 On track — love it. What's your *#1 goal* for today?",
          { parse_mode: "Markdown" },
        );
      } else if (data === "checkin:struggling") {
        logCheckin(userId, { responded: true, mood: "struggling" });
        await ctx.answerCallbackQuery({ text: "⚠️ Logged. Let's talk." });
        await ctx.reply(
          "No shame in that. What's the *biggest blocker* right now? Let's break it down.",
          { parse_mode: "Markdown" },
        );
      } else if (data === "checkin:weight_yes") {
        logCheckin(userId, { responded: true, weightTracked: true });
        await ctx.answerCallbackQuery({ text: "🏋️ Weight tracked!" });
        await ctx.reply(
          "🏋️ Weight logged. What's the number today? (I'll remember it)",
        );
      } else if (data === "checkin:skip") {
        logCheckin(userId, { responded: true, mood: "neutral" });
        await ctx.answerCallbackQuery({ text: "⏭️ Skipped today" });
        await ctx.reply("No worries. See you tomorrow. 🦅");
      } else if (data === "checkin:update_goals") {
        logCheckin(userId, { responded: true });
        await ctx.answerCallbackQuery({ text: "📝 Tell me your goals" });
        await ctx.reply(
          "📝 What's your updated *#1 goal*? Give me the new target and I'll track it.",
          { parse_mode: "Markdown" },
        );
      } else {
        await ctx.answerCallbackQuery();
      }
    } catch (err) {
      log.error(err, "❌ Callback handling error");
      await ctx.answerCallbackQuery({ text: "Something went wrong" });
    }
  });

  // ── Per-user concurrency lock ─────────────────────────────
  // Prevents two simultaneous agent loops from corrupting the session buffer
  const userLocks = new Map<string, Promise<void>>();

  async function withUserLock(
    userId: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    const prev = userLocks.get(userId) ?? Promise.resolve();
    const current = prev.then(fn, fn).finally(() => {
      // Clean up if this is still the latest promise
      if (userLocks.get(userId) === current) {
        userLocks.delete(userId);
      }
    });
    userLocks.set(userId, current);
    await current;
  }

  // ── Text messages → onboarding or agent loop ─────────────
  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const userId = String(ctx.from.id);

    log.info(
      { userId, preview: userMessage.substring(0, 80) },
      "📩 Message received",
    );

    // ── Onboarding: first-time user detection ───────────
    if (needsOnboarding(userId)) {
      const welcome = startOnboarding(userId);
      await ctx
        .reply(welcome, { parse_mode: "MarkdownV2" })
        .catch(() => ctx.reply(welcome));
      return;
    }

    // ── Onboarding: mid-flow question answering ─────────
    if (isOnboarding(userId)) {
      const { message, done } = processOnboardingAnswer(userId, userMessage);
      if (message) {
        await ctx
          .reply(message, { parse_mode: "MarkdownV2" })
          .catch(() => ctx.reply(message));
      }
      if (done) {
        log.info({ userId }, "🌟 Onboarding complete");
      }
      return;
    }

    // ── Agent loop (locked per user) ──────────────────────
    await withUserLock(userId, async () => {
      const typing = new TypingIndicator();
      await typing.start(ctx);

      try {
        const result = await runAgentLoop(userMessage, toolRegistry, userId);

        // Log usage
        usageTracker.log(
          config.llmModel,
          result.inputTokens,
          result.outputTokens,
          result.latencyMs,
        );

        log.info(
          {
            iterations: result.iterations,
            toolCalls: result.toolCalls,
            tokens: result.inputTokens + result.outputTokens,
            latencyMs: result.latencyMs,
          },
          "🤖 Agent loop complete",
        );

        // Edit placeholder into final response (handles chunking internally)
        await typing.stop(ctx, result.response);
      } catch (error) {
        log.error(error, "❌ Agent error");
        await typing.stopWithError(
          ctx,
          "⚠️ Something went wrong. Check the logs.",
        );
      }
    });
  });

  return bot;
}

/** Escape special chars for Telegram MarkdownV2 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}
