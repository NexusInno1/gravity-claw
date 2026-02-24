import type { ToolDefinition } from "./registry.js";
import { getBotRef } from "../bot/bot-ref.js";
import { log } from "../logger.js";
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "fs";
import { join } from "path";
import { InputFile } from "grammy";

// ── Send File Tool ───────────────────────────────────────

const TMP_DIR = join(process.cwd(), "data", "tmp");

export const sendFile: ToolDefinition = {
  name: "send_file",
  description:
    "Send a text file to the user via Telegram. Use this when the user asks for a document, report, export, code file, or any content that would be better as a downloadable file rather than a chat message.",

  parameters: {
    type: "object" as const,
    properties: {
      filename: {
        type: "string",
        description:
          "The filename including extension, e.g. 'report.txt', 'summary.md', 'data.csv', 'code.py'.",
      },
      content: {
        type: "string",
        description: "The text content to write into the file.",
      },
      user_id: {
        type: "string",
        description: "The user's Telegram ID.",
      },
      caption: {
        type: "string",
        description: "Optional caption to show with the file.",
      },
    },
    required: ["filename", "content", "user_id"],
  },

  execute: async (input: Record<string, unknown>) => {
    const filename = input.filename as string;
    const content = input.content as string;
    const userId = input.user_id as string;
    const caption = (input.caption as string) || undefined;

    if (!filename || !content || !userId) {
      return { error: "filename, content, and user_id are all required." };
    }

    // Ensure tmp dir exists
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

    const filePath = join(TMP_DIR, `${Date.now()}_${filename}`);

    try {
      // Write file
      writeFileSync(filePath, content, "utf-8");

      // Send via Telegram using grammy InputFile
      const bot = getBotRef();
      const chatId = parseInt(userId, 10);

      const fileBuffer = readFileSync(filePath);
      const inputFile = new InputFile(fileBuffer, filename);

      await bot.api.sendDocument(chatId, inputFile, {
        caption,
      });

      log.info({ filename, userId }, "📎 File sent to user");

      // Clean up temp file
      try {
        unlinkSync(filePath);
      } catch {
        /* ignore cleanup errors */
      }

      return {
        success: true,
        message: `File "${filename}" sent to the user.`,
      };
    } catch (err) {
      // Clean up on error too
      try {
        unlinkSync(filePath);
      } catch {
        /* ignore */
      }

      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Failed to send file: ${msg}` };
    }
  },
};
