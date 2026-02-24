import type { ToolDefinition } from "./registry.js";
import { llm } from "../llm/claude.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import { withRetry } from "../llm/retry.js";

// ── Translate Tool ───────────────────────────────────────

export const translate: ToolDefinition = {
  name: "translate",
  description:
    "Translate text from one language to another. Auto-detects the source language if not specified. Supports all major languages.",

  parameters: {
    type: "object" as const,
    properties: {
      text: {
        type: "string",
        description: "The text to translate.",
      },
      target_language: {
        type: "string",
        description:
          "The language to translate into, e.g. 'Hindi', 'Spanish', 'French', 'Japanese', 'Arabic'.",
      },
      source_language: {
        type: "string",
        description:
          "Optional. The source language. If omitted, it will be auto-detected.",
      },
    },
    required: ["text", "target_language"],
  },

  execute: async (input: Record<string, unknown>) => {
    const text = input.text as string;
    const targetLang = input.target_language as string;
    const sourceLang = (input.source_language as string) || "auto-detect";

    if (!text?.trim() || !targetLang?.trim()) {
      return { error: "text and target_language are required." };
    }

    log.info(
      { from: sourceLang, to: targetLang, textLen: text.length },
      "🌐 Translating",
    );

    try {
      const prompt =
        sourceLang === "auto-detect"
          ? `Translate the following text to ${targetLang}. Return ONLY the translated text, nothing else. No explanations, no notes, no quotes around the translation.\n\nText: ${text}`
          : `Translate the following text from ${sourceLang} to ${targetLang}. Return ONLY the translated text, nothing else. No explanations, no notes, no quotes around the translation.\n\nText: ${text}`;

      const response = await withRetry(
        () =>
          llm.chat.completions.create({
            model: config.llmModel,
            max_tokens: 2048,
            messages: [
              {
                role: "system",
                content:
                  "You are a professional translator. Translate accurately and naturally. Return ONLY the translation.",
              },
              { role: "user", content: prompt },
            ],
          }),
        { label: "Translation", maxRetries: 2 },
      );

      const translated = response.choices[0]?.message?.content?.trim() ?? "";

      if (!translated) {
        return { error: "Translation returned empty result." };
      }

      return {
        original: text,
        translated,
        source_language: sourceLang,
        target_language: targetLang,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Translation failed: ${msg}` };
    }
  },
};
