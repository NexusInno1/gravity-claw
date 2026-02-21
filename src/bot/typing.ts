import type { Context } from "grammy";

// ── Typing Indicator — "Thinking..." UX ──────────────────

/**
 * Manages a visible "🧠 Thinking..." placeholder message that gets
 * edited into the final response. Also sends Telegram typing action
 * every 3 seconds so the "typing..." bubble stays visible.
 */
export class TypingIndicator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private placeholderMessageId: number | null = null;
  private chatId: number | null = null;

  /**
   * Start the typing indicator: sends a placeholder message and
   * begins repeating the "typing" chat action.
   */
  async start(ctx: Context): Promise<void> {
    this.chatId = ctx.chat?.id ?? null;

    // Send visible placeholder
    try {
      const msg = await ctx.reply("🧠 *Thinking...*", {
        parse_mode: "Markdown",
      });
      this.placeholderMessageId = msg.message_id;
    } catch {
      // Fallback — just send typing action
      this.placeholderMessageId = null;
    }

    // Start repeating typing action (Telegram clears it after ~5s)
    await ctx.replyWithChatAction("typing").catch(() => {});
    this.intervalId = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 3000);
  }

  /**
   * Update the placeholder text to show current step.
   * Use this during tool calls to show progress.
   */
  async update(ctx: Context, status: string): Promise<void> {
    if (!this.placeholderMessageId || !this.chatId) return;

    try {
      await ctx.api.editMessageText(
        this.chatId,
        this.placeholderMessageId,
        status,
        { parse_mode: "Markdown" },
      );
    } catch {
      // Edit can fail if text is identical — safe to ignore
    }
  }

  /**
   * Stop the typing indicator and deliver the final response.
   *
   * - For short responses: edits the placeholder message in-place
   * - For long responses (>4096 chars): deletes placeholder, sends chunks
   *
   * Returns the sent message IDs.
   */
  async stop(ctx: Context, finalText: string): Promise<void> {
    // Clear typing interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const chunks = splitMessage(finalText, 4096);

    if (chunks.length === 1 && this.placeholderMessageId && this.chatId) {
      // Single-chunk: edit placeholder in-place for seamless UX
      try {
        await ctx.api.editMessageText(
          this.chatId,
          this.placeholderMessageId,
          chunks[0]!,
          { parse_mode: "Markdown" },
        );
        return;
      } catch {
        // If edit fails (e.g. markdown issues), fall through to send new
      }

      // Try again without markdown
      try {
        await ctx.api.editMessageText(
          this.chatId,
          this.placeholderMessageId,
          chunks[0]!,
        );
        return;
      } catch {
        // Fall through to delete + send
      }
    }

    // Multi-chunk or edit failed: delete placeholder and send fresh
    await this.deletePlaceholder(ctx);

    for (const chunk of chunks) {
      await ctx
        .reply(chunk, { parse_mode: "Markdown" })
        .catch(() => ctx.reply(chunk));
    }
  }

  /**
   * Stop the typing indicator on error. Deletes the placeholder
   * and sends the error message.
   */
  async stopWithError(ctx: Context, errorMessage: string): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    await this.deletePlaceholder(ctx);
    await ctx.reply(errorMessage);
  }

  private async deletePlaceholder(ctx: Context): Promise<void> {
    if (this.placeholderMessageId && this.chatId) {
      try {
        await ctx.api.deleteMessage(this.chatId, this.placeholderMessageId);
      } catch {
        // Message already deleted or too old — safe to ignore
      }
      this.placeholderMessageId = null;
    }
  }
}

// ── Helper ───────────────────────────────────────────────

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength / 2) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength / 2) {
      splitAt = maxLength;
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}
