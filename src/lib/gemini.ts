/**
 * Centralized Gemini Client — with Proactive Round-Robin Key Rotation
 * + Automatic OpenRouter Fallback
 *
 * Strategy to maximize uptime:
 *   1. Round-robin: rotate key on EVERY call, not just on failure
 *   2. On 429: wait the retry delay from the API, then retry with next key
 *   3. Track exhausted keys and reset after the quota window
 *   4. If ALL keys exhausted: fall back to OpenRouter automatically
 *
 * Usage:
 *   import { getAI, withRetry } from "../lib/gemini.js";
 *   const result = await withRetry(
 *     () => getAI().models.generateContent({...}),
 *     { contents, config: { systemInstruction, tools, temperature } }
 *   );
 */

import { GoogleGenAI } from "@google/genai";
import type { Content, Tool } from "@google/genai";
import { ENV } from "../config.js";
import { callOpenRouter } from "./openrouter.js";

let currentKeyIndex = 0;
const exhaustedKeys = new Set<number>();
let lastResetTime = Date.now();

// Free-tier quotas reset per minute (RPM) and per day (RPD).
// Reset exhausted tracking every 60 seconds for RPM recovery.
const RESET_INTERVAL_MS = 60 * 1000;

/**
 * Get a GoogleGenAI instance using the currently active API key.
 * Proactively rotates to the next key on each call to spread load evenly.
 */
export function getAI(): GoogleGenAI {
  // Reset exhausted keys periodically (RPM quotas refresh every minute)
  if (Date.now() - lastResetTime > RESET_INTERVAL_MS) {
    if (exhaustedKeys.size > 0) {
      console.log(
        `[Gemini] Resetting ${exhaustedKeys.size} exhausted key(s) after cooldown.`,
      );
    }
    exhaustedKeys.clear();
    lastResetTime = Date.now();
  }

  const keys = ENV.GEMINI_API_KEYS;
  const key = keys[currentKeyIndex];

  // Proactive round-robin: advance to next key for the next call
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  return new GoogleGenAI({ apiKey: key });
}

/**
 * Rotate to the next non-exhausted API key.
 * Returns true if a new key was found, false if all keys are exhausted.
 */
function rotateKey(): boolean {
  const keys = ENV.GEMINI_API_KEYS;
  exhaustedKeys.add(currentKeyIndex);

  console.log(
    `[Gemini] Key ${currentKeyIndex + 1}/${keys.length} hit rate limit. Rotating...`,
  );

  // Find next non-exhausted key
  for (let i = 0; i < keys.length; i++) {
    const nextIndex = (currentKeyIndex + 1 + i) % keys.length;
    if (!exhaustedKeys.has(nextIndex)) {
      currentKeyIndex = nextIndex;
      console.log(
        `[Gemini] Switched to key ${currentKeyIndex + 1}/${keys.length}.`,
      );
      return true;
    }
  }

  return false;
}

/**
 * Extract retry delay from a 429 error response.
 * Falls back to 5 seconds if not parseable.
 */
function getRetryDelay(error: unknown): number {
  try {
    const message = String((error as Error).message || "");
    const match = message.match(/retry in (\d+(?:\.\d+)?)/i);
    if (match) {
      return Math.min(Math.ceil(parseFloat(match[1])) * 1000, 60000);
    }
  } catch {}
  return 5000; // Default 5 second wait
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fallback params — enough info to replay the call on OpenRouter.
 * Pass these when calling withRetry so fallback can kick in.
 */
export interface FallbackParams {
  contents: Content[];
  systemInstruction?: string;
  tools?: Tool[];
  temperature?: number;
}

/**
 * Execute a Gemini API call with:
 *   - Automatic key rotation on 429 errors
 *   - Wait-based retry using the API's suggested delay
 *   - Up to (keys × 2) attempts to account for wait+retry cycles
 *   - Automatic OpenRouter fallback when all Gemini keys are exhausted
 *
 * @param fn - A function that performs the Gemini API call using getAI()
 * @param fallbackParams - Optional params to replay the call on OpenRouter if Gemini fails
 * @returns The result of the API call
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  fallbackParams?: FallbackParams,
): Promise<T> {
  const keys = ENV.GEMINI_API_KEYS;
  const maxAttempts = keys.length * 2; // Allow wait+retry cycles
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const status = (error as { status?: number }).status;

      if (status === 429) {
        const rotated = rotateKey();

        if (!rotated) {
          // All keys exhausted — try OpenRouter fallback FIRST
          if (fallbackParams && ENV.OPENROUTER_API_KEY) {
            console.log(
              "[Gemini] All keys exhausted — falling back to OpenRouter...",
            );
            try {
              const fallbackResponse = await callOpenRouter({
                contents: fallbackParams.contents,
                systemInstruction: fallbackParams.systemInstruction,
                tools: fallbackParams.tools,
                temperature: fallbackParams.temperature,
              });
              return fallbackResponse as T;
            } catch (fallbackError) {
              console.error(
                "[OpenRouter] Fallback also failed:",
                fallbackError,
              );
              // Fall through to Gemini retry wait
            }
          }

          // No fallback available or fallback failed — wait for Gemini quota reset
          const delay = getRetryDelay(error);
          console.log(`[Gemini] Waiting ${delay / 1000}s for quota reset...`);
          await sleep(delay);
          exhaustedKeys.clear();
          lastResetTime = Date.now();
          continue;
        }

        // Small delay between rotations to avoid hammering the API
        await sleep(500);
        continue;
      }

      if (status === 404) {
        // Model not found — try next key (might be regional)
        rotateKey();
        continue;
      }

      // For any other error, try OpenRouter fallback if available
      if (fallbackParams && ENV.OPENROUTER_API_KEY) {
        console.log(
          `[Gemini] Error (${status || "unknown"}) — trying OpenRouter fallback...`,
        );
        try {
          const fallbackResponse = await callOpenRouter({
            contents: fallbackParams.contents,
            systemInstruction: fallbackParams.systemInstruction,
            tools: fallbackParams.tools,
            temperature: fallbackParams.temperature,
          });
          return fallbackResponse as T;
        } catch (fallbackError) {
          console.error("[OpenRouter] Fallback also failed:", fallbackError);
        }
      }

      // Non-retryable error — throw immediately
      throw error;
    }
  }

  // All retries exhausted — one final OpenRouter attempt
  if (fallbackParams && ENV.OPENROUTER_API_KEY) {
    console.log(
      "[Gemini] All retries exhausted — final OpenRouter fallback attempt...",
    );
    try {
      const fallbackResponse = await callOpenRouter({
        contents: fallbackParams.contents,
        systemInstruction: fallbackParams.systemInstruction,
        tools: fallbackParams.tools,
        temperature: fallbackParams.temperature,
      });
      return fallbackResponse as T;
    } catch (fallbackError) {
      console.error("[OpenRouter] Final fallback failed:", fallbackError);
    }
  }

  throw lastError || new Error("All LLM providers exhausted after retries.");
}
