/**
 * Telegram Channel Adapter
 *
 * Implements the Channel interface for Telegram using Grammy.
 * All Telegram-specific logic lives here — the rest of the system
 * is completely platform-agnostic.
 */

import { Bot } from "grammy";
import { ENV } from "../config.js";
import { whitelistMiddleware } from "./whitelist.js";
import { clearChatHistory, getMessageCount, compactChatHistory } from "../memory/buffer.js";
import { initReminderCallback } from "../tools/set_reminder.js";
import {
  resetSessionStats,
  formatSessionStatus,
} from "../commands/session-stats.js";
import {
  getHeartbeatStatus,
  updateHeartbeatTime,
} from "../heartbeat/scheduler.js";
import type { Channel, MessageHandler, IncomingMessage } from "./types.js";

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

export class TelegramChannel implements Channel {
  readonly name = "Telegram";
  private bot: Bot;
  private handler: MessageHandler | null = null;

  constructor() {
    this.bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

    // Initialize reminder callback so set_reminder tool can send messages
    initReminderCallback(async (chatId: string, message: string) => {
      await this.bot.api.sendMessage(chatId, message);
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * Send a message with Markdown parsing, falling back to plain text if it fails.
   */
  private async sendReply(chatId: string | number, text: string): Promise<void> {
    const chunks = chunkMessage(text);
    for (const chunk of chunks) {
      try {
        await this.bot.api.sendMessage(chatId, chunk, {
          parse_mode: "Markdown",
        });
      } catch {
        // Markdown parsing failed — send plain
        await this.bot.api.sendMessage(chatId, chunk);
      }
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.sendReply(chatId, text);
  }

  async sendTyping(chatId: string): Promise<void> {
    await this.bot.api.sendChatAction(chatId, "typing");
  }

  async start(): Promise<void> {
    // Apply security whitelist middleware first
    this.bot.use(whitelistMiddleware);

    // ── Commands ────────────────────────────────────────────────

    // /start — clear conversation history and start fresh
    this.bot.command("start", async (ctx) => {
      const chatId = String(ctx.chat.id);
      console.log(
        `[Telegram] /start command from ${ctx.from?.id} — clearing history.`,
      );

      await ctx.replyWithChatAction("typing");

      try {
        await clearChatHistory(chatId);
        resetSessionStats(chatId);
        await this.sendReply(
          ctx.chat.id,
          "🔄 History cleared. Fresh session started.\n\nHow can I help you today?",
        );
      } catch (error) {
        console.error("[Telegram] /start error:", error);
        await ctx.reply("System error while clearing history. Check logs.");
      }
    });

    // /new or /reset — clear conversation history and reset session stats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleReset = async (ctx: any) => {
      const chatId = String(ctx.chat.id);
      console.log(
        `[Telegram] /reset command from ${ctx.from?.id} — clearing history.`,
      );

      await ctx.replyWithChatAction("typing");

      try {
        await clearChatHistory(chatId);
        resetSessionStats(chatId);
        await this.sendReply(
          ctx.chat.id,
          "🔄 History cleared and session reset.\n\nHow can I help you today?",
        );
      } catch (error) {
        console.error("[Telegram] /reset error:", error);
        await ctx.reply("System error while clearing history. Check logs.");
      }
    };

    this.bot.command("new", handleReset);
    this.bot.command("reset", handleReset);

    // /status — display session token consumption and stats
    this.bot.command("status", async (ctx) => {
      const chatId = String(ctx.chat.id);
      console.log(`[Telegram] /status command from ${ctx.from?.id}`);

      await ctx.replyWithChatAction("typing");

      try {
        const messageCount = await getMessageCount(chatId);
        const statusText = formatSessionStatus(chatId, messageCount);
        await this.sendReply(ctx.chat.id, statusText);
      } catch (error) {
        console.error("[Telegram] /status error:", error);
        await ctx.reply("System error while fetching status. Check logs.");
      }
    });

    // /compact — summarize conversation history to reduce tokens
    this.bot.command("compact", async (ctx) => {
      const chatId = String(ctx.chat.id);
      console.log(
        `[Telegram] /compact command from ${ctx.from?.id} — compacting history.`,
      );

      await ctx.replyWithChatAction("typing");

      try {
        const result = await compactChatHistory(chatId);
        await this.sendReply(ctx.chat.id, result);
      } catch (error) {
        console.error("[Telegram] /compact error:", error);
        await ctx.reply("System error during compaction. Check logs.");
      }
    });

    // /heartbeat — show current heartbeat status
    this.bot.command("heartbeat", async (ctx) => {
      const status = getHeartbeatStatus();
      await this.sendReply(ctx.chat.id, status);
    });

    // /heartbeat_set — change the morning check-in time
    this.bot.command("heartbeat_set", async (ctx) => {
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
        await this.sendReply(
          ctx.chat.id,
          `✅ Morning check-in updated to **${timeStr} IST**.`,
        );
      } else {
        await ctx.reply(
          "Could not find the Morning Check-in job. Is the heartbeat scheduler running?",
        );
      }
    });

    // ── Photo messages (vision) ─────────────────────────────────

    this.bot.on("message:photo", async (ctx) => {
      if (!this.handler) return;

      const chatId = String(ctx.chat.id);
      const userId = String(ctx.from.id);
      const caption =
        ctx.message.caption || "What's in this image? Describe and analyze it.";

      console.log(`[Telegram] Received photo from ${ctx.from.id}`);

      // Start typing indicator loop
      await ctx.replyWithChatAction("typing");
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => { });
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

        const incoming: IncomingMessage = {
          chatId,
          userId,
          text: caption,
          imageBase64: base64,
          imageMimeType: mimeType,
        };

        const result = await this.handler(incoming);
        clearInterval(typingInterval);
        await this.sendReply(ctx.chat.id, result);
      } catch (error) {
        clearInterval(typingInterval);
        console.error("[Telegram] Photo handling error:", error);
        await ctx.reply("Error processing the image. Check logs.");
      }
    });

    // ── Text messages ───────────────────────────────────────────

    this.bot.on("message:text", async (ctx) => {
      if (!this.handler) return;

      const chatId = String(ctx.chat.id);
      const userId = String(ctx.from.id);
      const userMessage = ctx.message.text;

      console.log(`[Telegram] Received message from ${ctx.from.id}: ${userMessage}`);

      // Start a typing indicator loop — pulses every 4s
      await ctx.replyWithChatAction("typing");
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => { });
      }, 4000);

      try {
        const incoming: IncomingMessage = {
          chatId,
          userId,
          text: userMessage,
        };

        const result = await this.handler(incoming);
        clearInterval(typingInterval);
        await this.sendReply(ctx.chat.id, result);
      } catch (error) {
        clearInterval(typingInterval);
        console.error("[Telegram] Error:", error);
        await ctx.reply("System error occurred. Check logs.");
      }
    });

    // ── Catch-all for unsupported message types ─────────────────

    this.bot.on("message", async (ctx) => {
      await ctx.reply(
        "I can only handle text messages and photos right now. Send me text or a photo and I'll get to work.",
      );
    });

    // ── Start long-polling ──────────────────────────────────────

    return new Promise<void>((resolve) => {
      this.bot.start({
        onStart: (botInfo) => {
          console.log(
            `[Channel/Telegram] Connected as @${botInfo.username}`,
          );
          resolve();
        },
      });
    });
  }

  stop(): void {
    this.bot.stop();
    console.log("[Channel/Telegram] Stopped.");
  }

  /** Expose the bot instance for heartbeat scheduler integration */
  getBot(): Bot {
    return this.bot;
  }
}
