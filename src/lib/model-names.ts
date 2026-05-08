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
  // Gemini 3.1 (dead model IDs kept for display-only, router redirects these)
  "gemini-3.1-pro-latest": "Gemini 3.1 Pro (Latest)",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
  "gemini-3.1-flash-latest": "Gemini 3.1 Flash (Latest)",
  "gemini-3.1-flash-lite-latest": "Gemini 3.1 Flash Lite (Latest)",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image Preview",
  // Gemini 3
  "gemini-3-flash-preview": "Gemini 3 Flash Preview",
  // Gemini 2.5
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  // Gemini 2.0 (deprecated)
  "gemini-2.0-flash": "Gemini 2.0 Flash (deprecated)",
  "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite (deprecated)",
  // Gemini 1.5 (legacy)
  "gemini-1.5-pro": "Gemini 1.5 Pro",
  "gemini-1.5-flash": "Gemini 1.5 Flash",
  "gemini-1.5-flash-8b": "Gemini 1.5 Flash 8B",
  // Groq — free tier (6,000 RPM)
  "groq/llama-3.3-70b-versatile": "Llama 3.3 70B (Groq)",
  "groq/llama3-8b-8192": "Llama 3 8B (Groq)",
  "groq/mixtral-8x7b-32768": "Mixtral 8x7B (Groq)",
  "groq/gemma2-9b-it": "Gemma 2 9B (Groq)",
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
