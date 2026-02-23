// ── Retry with Exponential Backoff ───────────────────────────────────

import { log } from "../logger.js";

export interface RetryOptions {
  /** Max number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms (default: 1000) — doubles each retry */
  baseDelayMs?: number;
  /** Which HTTP status codes should trigger a retry */
  retryableStatuses?: number[];
  /** Label for logging (e.g. "LLM call") */
  label?: string;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  retryableStatuses: [429, 500, 502, 503, 504],
  label: "API call",
};

/**
 * Wraps an async function with exponential backoff retry logic.
 * Only retries on network errors or HTTP status codes in the retryable list.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, retryableStatuses, label } = {
    ...DEFAULT_OPTIONS,
    ...opts,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // Check if this error is retryable
      if (!isRetryable(error, retryableStatuses)) {
        throw error; // non-retryable — fail immediately
      }

      if (attempt === maxRetries) {
        break; // exhausted all retries
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      const statusInfo = getStatusCode(error);
      log.warn(
        {
          label,
          status: statusInfo,
          delayMs,
          attempt: attempt + 1,
          maxRetries,
        },
        "⚠️ Retrying API call",
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

// ── Helpers ──────────────────────────────────────────────

function isRetryable(error: unknown, retryableStatuses: number[]): boolean {
  // Network errors (fetch failures, timeouts)
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.message.includes("ECONNRESET"))
    return true;
  if (error instanceof Error && error.message.includes("ETIMEDOUT"))
    return true;

  // HTTP status-based errors (OpenAI SDK wraps these)
  const status = getStatusCode(error);
  if (status && retryableStatuses.includes(status)) return true;

  return false;
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    // OpenAI SDK errors have a `status` property
    if (
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
    ) {
      return (error as { status: number }).status;
    }
    // Some errors have statusCode
    if (
      "statusCode" in error &&
      typeof (error as { statusCode: unknown }).statusCode === "number"
    ) {
      return (error as { statusCode: number }).statusCode;
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
