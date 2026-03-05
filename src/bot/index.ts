import { Bot } from "grammy";
import { ENV } from "../config.js";
import { whitelistMiddleware } from "./middleware/whitelist.js";
import { runAgentLoop, runAgentLoopWithImage } from "../agent/loop.js";
import { clearChatHistory } from "../memory/buffer.js";
import { initReminderCallback } from "../tools/set_reminder.js";
import {
  getHeartbeatStatus,
  updateHeartbeatTime,
} from "../heartbeat/scheduler.js";

export const bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

const TELEGRAM_MAX_LENGTH = 4096;

// Initialize reminder callback so the set_reminder tool can send messages
initReminderCallback(async (chatId: string, message: string) => {
  await bot.api.sendMessage(chatId, message);
});

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

// /heartbeat command — show current heartbeat status
bot.command("heartbeat", async (ctx) => {
  const status = getHeartbeatStatus();
  await sendMessage(ctx, status);
});

// /heartbeat_set command — change the morning check-in time
// Usage: /heartbeat_set 09:30
bot.command("heartbeat_set", async (ctx) => {
  const args = ctx.match?.trim();

  if (!args) {
    await ctx.reply(
      "Usage: /heartbeat\\_set HH:MM\nExample: /heartbeat\\_set 09:30",
    );
    return;
  }

  const timeMatch = args.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    await ctx.reply(
      "Invalid format. Use HH:MM (24-hour IST).\nExample: /heartbeat\\_set 09:30",
    );
    return;
  }

  const hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    await ctx.reply("Invalid time. Hour: 0-23, Minute: 0-59.");
    return;
  }

  const updated = updateHeartbeatTime("Morning Check-in", hour, minute);
  if (updated) {
    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    await sendMessage(
      ctx,
      `✅ Morning check-in updated to **${timeStr} IST**.`,
    );
  } else {
    await ctx.reply(
      "Could not find the Morning Check-in job. Is the heartbeat scheduler running?",
    );
  }
});

// Handle photo messages — vision/image support
bot.on("message:photo", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const caption =
    ctx.message.caption || "What's in this image? Describe and analyze it.";

  console.log(`[Bot] Received photo from ${ctx.from.id}`);

  // Start typing indicator loop
  await ctx.replyWithChatAction("typing");
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);

  try {
    // Get the highest resolution photo (last in array)
    const photos = ctx.message.photo;
    const bestPhoto = photos[photos.length - 1];

    // Get the file info from Telegram
    const file = await ctx.api.getFile(bestPhoto.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${ENV.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    // Download the image
    const response = await fetch(fileUrl);
    if (!response.ok) {
      clearInterval(typingInterval);
      await ctx.reply("Failed to download the image from Telegram.");
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString("base64");

    // Determine MIME type from file extension
    const ext = file.file_path?.split(".").pop()?.toLowerCase() || "jpg";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
    };
    const mimeType = mimeMap[ext] || "image/jpeg";

    // Run the vision agent loop
    const result = await runAgentLoopWithImage(
      caption,
      chatId,
      base64,
      mimeType,
    );

    clearInterval(typingInterval);
    await sendMessage(ctx, result);
  } catch (error) {
    clearInterval(typingInterval);
    console.error("[Bot] Photo handling error:", error);
    await ctx.reply("Error processing the image. Check logs.");
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

// Catch-all for non-text messages (voice, stickers, documents, etc.)
bot.on("message", async (ctx) => {
  await ctx.reply(
    "I can only handle text messages and photos right now. Send me text or a photo and I'll get to work.",
  );
});
