import type { ToolDefinition } from "./registry.js";
import { getBotRef } from "../bot/bot-ref.js";
import { log } from "../logger.js";
import { InputFile } from "grammy";

// ── Send File Tool ───────────────────────────────────────

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

    try {
      // Create file from in-memory buffer — no filesystem writes needed
      const buffer = Buffer.from(content, "utf-8");
      const inputFile = new InputFile(buffer, filename);

      const bot = getBotRef();
      const chatId = parseInt(userId, 10);

      await bot.api.sendDocument(chatId, inputFile, { caption });

      log.info(
        { filename, userId, size: buffer.length },
        "📎 File sent to user",
      );

      return {
        success: true,
        message: `File "${filename}" sent to the user.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Failed to send file: ${msg}` };
    }
  },
};
