/**
 * LLM Router — Smart Provider Dispatcher
 *
 * Routes LLM calls to the correct provider (Gemini or Groq)
 * based on the model name. Handles automatic fallback when Gemini
 * keys are exhausted.
 *
 * Model routing logic:
 *   - Names starting with "gemini-" → Gemini provider
 *   - Names starting with "groq/"   → Groq provider (direct)
 *   - Gemini 429/503/404            → Groq fallback (if GROQ_API_KEY set)
 *
 * Usage:
 *   import { routedChat } from "../lib/router.js";
 *   const response = await routedChat({ model, messages, ... });
 */

import type { LLMCallParams, LLMResponse } from "./llm.js";
import { geminiProvider } from "./gemini.js";
import { groqProvider } from "./groq.js";
import { ENV } from "../config.js";

/**
 * Determine which provider should serve a given model.
 */
export function isGeminiModel(model: string): boolean {
    return model.startsWith("gemini-");
}

export function isGroqModel(model: string): boolean {
    return model.startsWith("groq/");
}

/** HTTP status codes that warrant an automatic Groq fallback.
 *  400 (bad request) is intentionally excluded — it indicates a real bug
 *  in our payload (invalid model config, malformed body, etc.) and should
 *  surface immediately rather than silently retry on a different provider.
 */
const FALLBACK_STATUSES: ReadonlySet<number> = new Set([404, 429, 503]);

/**
 * Route an LLM call to the appropriate provider.
 *
 * - gemini- models    → Gemini provider
 * - groq/ models      → Groq provider directly (prefix stripped before call)
 * - Gemini 429/503/404 → Groq fallback (if GROQ_API_KEY is set)
 * - All other errors (400, 401, 500, etc.) propagate immediately.
 */
export async function routedChat(params: LLMCallParams): Promise<LLMResponse> {
    // ── groq/ model → Groq provider directly ────────────────────────
    if (isGroqModel(params.model)) {
        // Strip the "groq/" prefix — Groq API uses bare model IDs
        const groqModelId = params.model.replace(/^groq\//, "");
        console.log(`[Router] ${params.model} → Groq (native)`);
        return groqProvider.chat({ ...params, model: groqModelId });
    }

    // ── Gemini model ─────────────────────────────────────────────────
    try {
        return await geminiProvider.chat(params);
    } catch (error: unknown) {
        const status = (error as { status?: number }).status;

        // Only fall back on quota/service errors — propagate everything else
        if (!FALLBACK_STATUSES.has(status ?? 0)) {
            throw error;
        }

        const reason = status === 404 ? "model not found" : `HTTP ${status}`;

        // ── Fallback: Groq (6,000 RPM free tier) ─────────────────────
        if (ENV.GROQ_API_KEY) {
            console.log(
                `[Router] Gemini failed (${reason}) — falling back to Groq (${ENV.GROQ_MODEL})...`,
            );
            try {
                return await groqProvider.chat({
                    ...params,
                    model: ENV.GROQ_MODEL,
                });
            } catch (groqError) {
                console.error("[Router] Groq fallback also failed:", groqError);
            }
        }

        // Fallback not configured or failed — throw original Gemini error
        throw error;
    }
}

/**
 * Get the provider name for a model (for display / logging purposes).
 */
export function getProviderName(model: string): "Gemini" | "Groq" {
    if (isGroqModel(model)) return "Groq";
    return "Gemini";
}
