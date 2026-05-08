/**
 * LLM Router — Smart Provider Dispatcher
 *
 * Routes LLM calls to the correct provider (Gemini or OpenRouter/Groq)
 * based on the model name. Handles automatic fallback when Gemini
 * keys are exhausted.
 *
 * Model routing logic:
 *   - Names starting with "gemini-" → Gemini provider
 *   - Everything else → OpenRouter provider (direct, not fallback)
 *   - Gemini 429/503/404 fallback chain: Groq → OpenRouter
 *
 * Fallback priority:
 *   1. Groq  (primary fallback — 6,000 RPM free, fast, reliable)
 *   2. OpenRouter (secondary fallback — if Groq not configured)
 *
 * Usage:
 *   import { routedChat } from "../lib/router.js";
 *   const response = await routedChat({ model, messages, ... });
 */

import type { LLMCallParams, LLMResponse } from "./llm.js";
import { geminiProvider } from "./gemini.js";
import { groqProvider } from "./groq.js";
import { openRouterProvider } from "./openrouter.js";
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

/** HTTP status codes that warrant an automatic fallback.
 *  400 (bad request) is intentionally excluded — it indicates a real bug
 *  in our payload (invalid model config, malformed body, etc.) and should
 *  surface immediately rather than silently retry on a different provider.
 */
const FALLBACK_STATUSES: ReadonlySet<number> = new Set([404, 429, 503]);

/**
 * Route an LLM call to the appropriate provider.
 *
 * - Gemini models go to the Gemini provider.
 * - groq/ models go to the Groq provider directly.
 * - Everything else goes to OpenRouter directly (first-class, not fallback).
 * - If Gemini fails with 404/429/503, fallback chain activates:
 *     1. Groq  (if GROQ_API_KEY is set) — 6,000 RPM free tier
 *     2. OpenRouter (if OPENROUTER_API_KEY is set) — secondary safety net
 * - All other errors (400, 401, 500, etc.) propagate immediately.
 */
export async function routedChat(params: LLMCallParams): Promise<LLMResponse> {
    // ── Groq model → Groq provider directly ─────────────────────────
    if (isGroqModel(params.model)) {
        // Strip the "groq/" prefix — Groq API uses bare model IDs
        const groqModelId = params.model.replace(/^groq\//, "");
        console.log(`[Router] ${params.model} → Groq (native)`);
        return groqProvider.chat({ ...params, model: groqModelId });
    }

    // ── Non-Gemini model → OpenRouter directly ──────────────────────
    if (!isGeminiModel(params.model)) {
        console.log(`[Router] ${params.model} → OpenRouter (native)`);
        return openRouterProvider.chat(params);
    }

    // ── Gemini model ────────────────────────────────────────────────
    try {
        return await geminiProvider.chat(params);
    } catch (error: unknown) {
        const status = (error as { status?: number }).status;

        // Only fall back on quota/service errors — propagate everything else
        if (!FALLBACK_STATUSES.has(status ?? 0)) {
            throw error;
        }

        const reason = status === 404 ? "model not found" : `HTTP ${status}`;

        // ── Fallback 1: Groq (primary — 6,000 RPM free) ─────────────
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
                // Fall through to OpenRouter
            }
        }

        // ── Fallback 2: OpenRouter (secondary safety net) ────────────
        if (ENV.OPENROUTER_API_KEY) {
            console.log(
                `[Router] Falling back to OpenRouter (${ENV.OPENROUTER_MODEL})...`,
            );
            try {
                return await openRouterProvider.chat({
                    ...params,
                    model: ENV.OPENROUTER_MODEL,
                });
            } catch (fallbackError) {
                console.error("[Router] OpenRouter fallback also failed:", fallbackError);
            }
        }

        // Both fallbacks failed (or not configured) — throw original error
        throw error;
    }
}

/**
 * Get the provider name for a model (for display / logging purposes).
 */
export function getProviderName(model: string): "Gemini" | "OpenRouter" | "Groq" {
    if (isGroqModel(model)) return "Groq";
    return isGeminiModel(model) ? "Gemini" : "OpenRouter";
}
