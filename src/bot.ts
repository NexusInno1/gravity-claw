import { Bot } from "grammy";
import { log } from "./logger.js";
import { config } from "./config.js";
import { llm, getSystemPrompt } from "./llm/claude.js";
import { TOOL_NAMES } from "./llm/claude.js";
import type { ToolRegistry } from "./tools/registry.js";

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
        "/model — Current model info\n" +
        "/help — This message\n\n" +
        "📎 *File Support*\n" +
        "• Send a PDF — I'll read and analyze it\n" +
        "• Send a photo — I'll describe what I see",
      { parse_mode: "Markdown" },
    );
  });

  // ── /status ─────────────────────────────────────────
  bot.command("status", async (ctx) => {
    const tools = toolRegistry.getOpenAITools();
    const toolNames = tools.map((t) => t.function.name).join(", ");

    await ctx.reply(
      "🦅 *Bot Status*\n" +
        "────────────────────\n" +
        `🤖 Model: \`${config.llmModel}\`\n` +
        `🔧 Tools: ${tools.length} (${toolNames || "none"})\n` +
        `👤 Allowed users: ${config.allowedUserIds.length}`,
      { parse_mode: "Markdown" },
    );
  });

  // ── /model ──────────────────────────────────────────
  bot.command("model", async (ctx) => {
    await ctx.reply(
      "🤖 *Current Model*\n" +
        "────────────────────\n" +
        `Model: \`${config.llmModel}\`\n` +
        `Provider: OpenRouter\n\n` +
        "_Change model in .env and restart._",
      { parse_mode: "Markdown" },
    );
  });

  // ── Helper: run agent direct call ───────────────────────
  async function handleAgentMessage(
    ctx: any,
    userMessage: string,
    imageUrl?: string,
  ): Promise<void> {
    // Start typing indicator
    await ctx.api.sendChatAction(ctx.chat.id, "typing");

    try {
      const messages: any[] = [{ role: "system", content: getSystemPrompt() }];

      if (imageUrl) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: userMessage },
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
          ],
        });
      } else {
        messages.push({ role: "user", content: userMessage });
      }

      const openAiTools = toolRegistry.getOpenAITools();

      // Call LLM
      const response = await llm.chat.completions.create({
        model: config.llmModel,
        messages: messages,
        tools: openAiTools.length > 0 ? openAiTools : undefined,
        temperature: config.llmTemperature,
      });

      const message = response.choices[0]?.message;

      if (!message) {
        await ctx.reply("⚠️ No response from the model.");
        return;
      }

      // Handle tool calls if any
      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push(message); // Add assistant's tool call message

        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const rawArgs = toolCall.function.arguments;
          log.info({ tool: toolName, args: rawArgs }, "🔧 Executing tool");

          const tool = toolRegistry.get(toolName);
          if (!tool) {
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: `Tool ${toolName} not found` }),
            });
            continue;
          }

          try {
            const args = JSON.parse(rawArgs);
            const result = await tool.execute(args);
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content:
                typeof result === "string" ? result : JSON.stringify(result),
            });
          } catch (err: any) {
            log.error({ err, tool: toolName }, "❌ Tool execution failed");
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: err.message || String(err) }),
            });
          }
        }

        // Get final response after tools
        const finalResponse = await llm.chat.completions.create({
          model: config.llmModel,
          messages: messages,
          temperature: config.llmTemperature,
        });

        const finalContent = finalResponse.choices[0]?.message?.content;
        if (finalContent) {
          await ctx.reply(sanitizeResponse(finalContent));
        } else {
          await ctx.reply(
            "⚠️ Could not generate a final response after using tools.",
          );
        }
      } else if (message.content) {
        // Direct answer
        await ctx.reply(sanitizeResponse(message.content));
      }
    } catch (error) {
      log.error(error, "❌ Agent error");
      await ctx.reply("⚠️ Something went wrong. Check the logs.");
    }
  }

  // ── Document messages (PDF reading) ───────────────────────
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;

    if (!doc) return;

    const mimeType = doc.mime_type || "";
    const fileName = doc.file_name || "document";

    if (mimeType !== "application/pdf") {
      await ctx.reply(
        "📄 I can only read *PDF files* for now\\. Please send a \\.pdf document\\.",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    if (doc.file_size && doc.file_size > 10 * 1024 * 1024) {
      await ctx.reply("⚠️ PDF is too large (max 10MB). Try a smaller file.");
      return;
    }

    try {
      const file = await ctx.api.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

      const response = await fetch(fileUrl, {
        signal: AbortSignal.timeout(30000),
      });
      const buffer = Buffer.from(await response.arrayBuffer());

      const pdfParse = (await import("pdf-parse")).default;
      const pdfData = await pdfParse(buffer);
      const pdfText = pdfData.text?.trim();

      if (!pdfText) {
        await ctx.reply("⚠️ Could not extract text from this PDF.");
        return;
      }

      const maxChars = 12000;
      const truncated = pdfText.length > maxChars;
      const text = truncated ? pdfText.slice(0, maxChars) : pdfText;

      const caption = ctx.message.caption || "";
      const userMessage = caption
        ? `${caption}\n\n--- PDF Content (${fileName}, ${pdfData.numpages} pages) ---\n${text}${truncated ? "\n\n[... truncated ...]" : ""}`
        : `The user sent a PDF file: "${fileName}" (${pdfData.numpages} pages). Here is the extracted text:\n\n${text}${truncated ? "\n\n[... truncated ...]" : ""}\n\nPlease read and summarize the key points of this document.`;

      await handleAgentMessage(ctx, userMessage);
    } catch (err) {
      log.error(err, "❌ PDF processing error");
      await ctx.reply("⚠️ Failed to read the PDF.");
    }
  });

  // ── Photo messages (image understanding) ──────────────────
  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) return;

    try {
      const bestPhoto = photos[photos.length - 1]!;
      const file = await ctx.api.getFile(bestPhoto.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

      const response = await fetch(fileUrl, {
        signal: AbortSignal.timeout(30000),
      });
      const buffer = Buffer.from(await response.arrayBuffer());

      const base64 = buffer.toString("base64");
      const imageUrl = `data:image/jpeg;base64,${base64}`;

      const caption =
        ctx.message.caption || "What's in this image? Describe what you see.";

      await handleAgentMessage(ctx, caption, imageUrl);
    } catch (err) {
      log.error(err, "❌ Photo processing error");
      await ctx.reply("⚠️ Failed to process the image. Please try again.");
    }
  });

  // ── Text messages → agent loop ────────────────────────────
  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    await handleAgentMessage(ctx, userMessage);
  });

  return bot;
}

/** Escape special chars for Telegram MarkdownV2 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/** Sanitize tool names leaking into response text */
function sanitizeResponse(text: string): string {
  let cleaned = text;
  // Strip out markdown code blocks that are just tool names
  const toolNameRegex = new RegExp(
    `^\`\`\`(?:json)?\\n?\\s*(?:${TOOL_NAMES.join("|")})\\s*\\n?\`\`\`$`,
    "gm",
  );
  cleaned = cleaned.replace(toolNameRegex, "");

  // Strip out bare tool names on their own line
  const fallbackRegex = new RegExp(
    `^(?:\\/)?(?:${TOOL_NAMES.join("|")})\\s*$`,
    "gm",
  );
  cleaned = cleaned.replace(fallbackRegex, "");

  return (
    cleaned.trim() ||
    "Hmm, I couldn't formulate a text response. Please try again."
  );
}
