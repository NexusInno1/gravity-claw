/**
 * Model Display Names
 *
 * Maps raw LLM model IDs to human-friendly display names for use in
 * footers, status messages, and UI. Extracted from index.ts so the
 * entry point stays lean and this map can be reused by other modules
 * (e.g. slash-commands, session-stats) without importing the entry point.
 */

// ─── Friendly Name Map ────────────────────────────────────────────

export const FRIENDLY_NAMES: Record<string, string> = {
  // Gemini 3.1
  "gemini-3.1-pro-latest": "Gemini 3.1 Pro (Latest)",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
  "gemini-3.1-flash-latest": "Gemini 3.1 Flash (Latest)",
  "gemini-3.1-flash-lite-latest": "Gemini 3.1 Flash Lite (Latest)",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image (Nano Banana 2)",
  // Gemini 3
  "gemini-3-flash-preview": "Gemini 3 Flash Preview",
  "gemini-3-pro-image-preview": "Gemini 3 Pro Image (Nano Banana Pro)",
  // Gemini 2.5
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  // Gemini 2.0 (deprecated)
  "gemini-2.0-flash": "Gemini 2.0 Flash (deprecated)",
  "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite (deprecated)",
  // Gemini 1.5
  "gemini-1.5-pro-latest": "Gemini 1.5 Pro",
  "gemini-1.5-flash-latest": "Gemini 1.5 Flash",
  "gemini-1.5-flash-8b": "Gemini 1.5 Flash 8B",
  // Legacy exact IDs (keep for backwards compat)
  "gemini-1.5-pro": "Gemini 1.5 Pro",
  "gemini-1.5-flash": "Gemini 1.5 Flash",
  // Claude 4.x (current — live on OpenRouter as of 2026-05-08)
  "anthropic/claude-opus-4.7": "Claude Opus 4.7",
  "anthropic/claude-sonnet-4.6": "Claude Sonnet 4.6",
  "anthropic/claude-haiku-4.5": "Claude Haiku 4.5",
  // Claude 3.x (retiring / retired — kept for display only)
  "anthropic/claude-3.7-sonnet": "Claude 3.7 Sonnet (retiring)",
  "anthropic/claude-3.7-opus": "Claude 3.7 Opus (N/A)",
  "anthropic/claude-3.5-haiku": "Claude 3.5 Haiku (legacy)",
  "anthropic/claude-3.5-sonnet": "Claude 3.5 Sonnet (legacy)",
  // GPT
  "openai/gpt-4o": "GPT-4o",
  "openai/gpt-4o-mini": "GPT-4o Mini",
  "openai/gpt-5.4": "GPT-5",
  "openai/gpt-5.4-mini": "GPT-5 Mini",
  "openai/o3": "o3",
  "openai/o4-mini": "o4 Mini",
  // Llama paid
  "meta-llama/llama-4-maverick": "Llama 4 Maverick",
  "meta-llama/llama-3.3-70b-instruct": "Llama 3.3 70B",
  // DeepSeek paid
  "deepseek/deepseek-chat-v3-0324": "DeepSeek V3",
  "deepseek/deepseek-r1": "DeepSeek R1",
  // Qwen paid
  "qwen/qwq-32b": "QwQ 32B",
  "qwen/qwen3-235b-a22b": "Qwen 3 235B",
  // Mistral
  "mistralai/mistral-large": "Mistral Large",
  // Free tier (only confirmed live free model as of 2026-04-29)
  "openai/gpt-oss-20b:free": "GPT OSS 20B (free)",
};

/**
 * Convert a raw model ID into a human-friendly display name.
 * Falls back to a cleaned-up version of the raw ID if not in the map.
 */
export function prettifyModelName(model: string): string {
  if (FRIENDLY_NAMES[model]) return FRIENDLY_NAMES[model];

  // Fallback: strip provider prefix and clean up
  const name = model.includes("/") ? model.split("/").pop()! : model;
  return name
    .replace(/:free$/, " (free)")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
