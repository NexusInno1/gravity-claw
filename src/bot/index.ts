import { Bot } from "grammy";
import { ENV } from "../config.js";
import { whitelistMiddleware } from "./middleware/whitelist.js";
import { runAgentLoop } from "../agent/loop.js";
import { clearChatHistory } from "../memory/buffer.js";

export const bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Split a long message into chunks that fit Telegram's 4096 char limit.
 * Splits at paragraph boundaries first, then sentence boundaries.
 */
function chunkMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point: paragraph break > sentence end > space
    let splitAt = remaining.lastIndexOf("\n\n", TELEGRAM_MAX_LENGTH);
    if (splitAt < TELEGRAM_MAX_LENGTH * 0.3) {
      splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
    }
    if (splitAt < TELEGRAM_MAX_LENGTH * 0.3) {
      splitAt = remaining.lastIndexOf(". ", TELEGRAM_MAX_LENGTH);
      if (splitAt > 0) splitAt += 1; // include the period
    }
    if (splitAt < TELEGRAM_MAX_LENGTH * 0.3) {
      splitAt = TELEGRAM_MAX_LENGTH;
    }

    chunks.push(remaining.substring(0, splitAt).trimEnd());
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Send a message with Markdown parsing, falling back to plain text if it fails.
 */
async function sendMessage(ctx: { reply: Function }, text: string) {
  const chunks = chunkMessage(text);
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    } catch {
      // Markdown parsing failed (unbalanced formatting etc.) — send plain
      await ctx.reply(chunk);
    }
  }
}

// Apply security whitelist middleware first
bot.use(whitelistMiddleware);

// /start command — clears conversation history and starts fresh
bot.command("start", async (ctx) => {
  const chatId = String(ctx.chat.id);
  console.log(`[Bot] /start command from ${ctx.from?.id} — clearing history.`);

  await ctx.replyWithChatAction("typing");

  try {
    await clearChatHistory(chatId);
    await sendMessage(
      ctx,
      "🔄 History cleared. Fresh session started.\n\nHow can I help you today?",
    );
  } catch (error) {
    console.error("[Bot] /start error:", error);
    await ctx.reply("System error while clearing history. Check logs.");
  }
});

bot.on("message:text", async (ctx) => {
  const userMessage = ctx.message.text;
  const chatId = String(ctx.chat.id);

  console.log(`[Bot] Received message from ${ctx.from.id}: ${userMessage}`);

  // Start a typing indicator loop — pulses every 4s so the user sees activity
  await ctx.replyWithChatAction("typing");
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);

  try {
    const response = await runAgentLoop(userMessage, chatId);
    clearInterval(typingInterval);
    await sendMessage(ctx, response);
  } catch (error) {
    clearInterval(typingInterval);
    console.error("[Bot Error]", error);
    await ctx.reply("System error occurred. Check logs.");
  }
});

// Catch-all for non-text messages (images, voice, stickers, etc.)
bot.on("message", async (ctx) => {
  await ctx.reply(
    "I can only handle text messages right now. Send me text and I'll get to work.",
  );
});
