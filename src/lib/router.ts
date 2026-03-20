/**
 * LLM Router — Smart Provider Dispatcher
 *
 * Routes LLM calls to the correct provider (Gemini or OpenRouter)
 * based on the model name. Handles automatic fallback when Gemini
 * keys are exhausted.
 *
 * Model routing logic:
 *   - Names starting with "gemini-" → Gemini provider
 *   - Everything else → OpenRouter provider
 *   - Gemini 429 fallback → OpenRouter (if configured)
 *
 * Usage:
 *   import { routedChat } from "../lib/router.js";
 *   const response = await routedChat({ model, messages, ... });
 */

import type { LLMCallParams, LLMResponse } from "./llm.js";
import { geminiProvider, areAllKeysExhausted } from "./gemini.js";
import { openRouterProvider } from "./openrouter.js";
import { ENV } from "../config.js";

/**
 * Determine which provider should serve a given model.
 */
function isGeminiModel(model: string): boolean {
    return model.startsWith("gemini-");
}

/**
 * Route an LLM call to the appropriate provider.
 *
 * - Gemini models go to the Gemini provider.
 * - Non-Gemini models go to OpenRouter directly (first-class, not fallback).
 * - If Gemini fails with 429 and all keys are exhausted, automatically
 *   retries with OpenRouter using the configured fallback model.
 */
export async function routedChat(params: LLMCallParams): Promise<LLMResponse> {
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

        // If Gemini threw a non-429 or there's no OpenRouter fallback, propagate
        if (!ENV.OPENROUTER_API_KEY) {
            throw error;
        }

        // Attempt OpenRouter fallback for any error
        console.log(
            `[Router] Gemini failed (${status || "unknown"}) — falling back to OpenRouter (${ENV.OPENROUTER_MODEL})...`,
        );

        try {
            return await openRouterProvider.chat({
                ...params,
                model: ENV.OPENROUTER_MODEL,
            });
        } catch (fallbackError) {
            console.error("[Router] OpenRouter fallback also failed:", fallbackError);
            // Throw the original Gemini error, not the fallback error
            throw error;
        }
    }
}

/**
 * Get the provider name for a model (for display / logging purposes).
 */
export function getProviderName(model: string): string {
    return isGeminiModel(model) ? "Gemini" : "OpenRouter";
}
