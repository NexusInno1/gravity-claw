/**
 * Session Statistics Tracker
 *
 * Tracks per-chat token consumption and cost in memory.
 * Resets when the bot restarts or when a user runs /new.
 *
 * Per-call records capture:
 *   - Model used
 *   - Prompt / completion / total token counts
 *   - Estimated cost in USD
 *   - Wall-clock latency in ms
 *   - Timestamp
 *
 * This is intentionally kept in-memory (no DB) because the data
 * is session-scoped and ephemeral.
 */

// ─── Pricing Table ────────────────────────────────────────────────
// Prices in USD per 1 000 000 tokens (as of March 2025).
// Prompt / Completion prices listed separately.
//
// Source: https://ai.google.dev/pricing

interface ModelPricing {
    /** USD per 1M prompt tokens */
    promptPer1M: number;
    /** USD per 1M completion tokens */
    completionPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
    // Gemini 2.5
    "gemini-2.5-pro": { promptPer1M: 1.25, completionPer1M: 10.00 },
    "gemini-2.5-flash": { promptPer1M: 0.075, completionPer1M: 0.30 },
    // Gemini 2.0
    "gemini-2.0-flash": { promptPer1M: 0.075, completionPer1M: 0.30 },
    "gemini-2.0-flash-lite": { promptPer1M: 0.075, completionPer1M: 0.30 },
    // Gemini 1.5
    "gemini-1.5-pro": { promptPer1M: 1.25, completionPer1M: 5.00 },
    "gemini-1.5-flash": { promptPer1M: 0.075, completionPer1M: 0.30 },
    "gemini-1.5-flash-8b": { promptPer1M: 0.0375, completionPer1M: 0.15 },
};

/** Fallback pricing for unknown models. */
const DEFAULT_PRICING: ModelPricing = { promptPer1M: 0.075, completionPer1M: 0.30 };

function getPricing(model: string): ModelPricing {
    // Exact match
    if (PRICING[model]) return PRICING[model];
    // Prefix match (handles versioned suffixes like -preview, -exp, etc.)
    for (const [key, price] of Object.entries(PRICING)) {
        if (model.startsWith(key)) return price;
    }
    return DEFAULT_PRICING;
}

export function estimateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
): number {
    const p = getPricing(model);
    return (promptTokens / 1_000_000) * p.promptPer1M +
        (completionTokens / 1_000_000) * p.completionPer1M;
}

// ─── Types ────────────────────────────────────────────────────────

/** One logged LLM API call. */
export interface CallRecord {
    /** ISO timestamp of when the call completed */
    timestamp: string;
    /** The Gemini model used */
    model: string;
    /** Prompt tokens sent */
    promptTokens: number;
    /** Completion tokens received */
    completionTokens: number;
    /** Total tokens (prompt + completion) */
    totalTokens: number;
    /** Estimated USD cost for this call */
    estimatedCostUsd: number;
    /** Wall-clock latency in ms */
    latencyMs: number;
}

/** Aggregated session-level stats. */
export interface SessionStats {
    /** Cumulative prompt tokens sent to the model */
    promptTokens: number;
    /** Cumulative completion tokens received from the model */
    completionTokens: number;
    /** Cumulative total tokens (prompt + completion) */
    totalTokens: number;
    /** Cumulative estimated cost in USD */
    estimatedCostUsd: number;
    /** Number of LLM requests made in this session */
    requestCount: number;
    /** Total latency across all calls (ms) */
    totalLatencyMs: number;
    /** When this session was started or last reset */
    sessionStartedAt: Date;
    /** Rolling log of individual calls (last MAX_CALL_LOG entries) */
    callLog: CallRecord[];
}

// ─── Storage ──────────────────────────────────────────────────────

const MAX_CALL_LOG = 20;
const sessions = new Map<string, SessionStats>();

function emptyStats(): SessionStats {
    return {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        requestCount: 0,
        totalLatencyMs: 0,
        sessionStartedAt: new Date(),
        callLog: [],
    };
}

function ensureSession(chatId: string): SessionStats {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, emptyStats());
    }
    return sessions.get(chatId)!;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Record token usage, cost and latency from a single LLM API response.
 *
 * @param chatId           Chat to attribute the call to
 * @param model            The model that served the request
 * @param promptTokens     Tokens in the prompt
 * @param completionTokens Tokens in the completion
 * @param totalTokens      Total tokens (as reported by the API)
 * @param latencyMs        Wall-clock time from request start to response
 */
export function recordTokenUsage(
    chatId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    latencyMs: number,
): void {
    const stats = ensureSession(chatId);
    const costUsd = estimateCost(model, promptTokens, completionTokens);

    // Update aggregates
    stats.promptTokens += promptTokens;
    stats.completionTokens += completionTokens;
    stats.totalTokens += totalTokens;
    stats.estimatedCostUsd += costUsd;
    stats.requestCount += 1;
    stats.totalLatencyMs += latencyMs;

    // Append to call log (ring buffer)
    const record: CallRecord = {
        timestamp: new Date().toISOString(),
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd: costUsd,
        latencyMs,
    };

    stats.callLog.push(record);
    if (stats.callLog.length > MAX_CALL_LOG) {
        stats.callLog.shift(); // drop oldest
    }

    console.log(
        `[Usage] model=${model} prompt=${promptTokens} compl=${completionTokens}` +
        ` total=${totalTokens} cost=$${costUsd.toFixed(6)} latency=${latencyMs}ms`,
    );
}

/**
 * Get the current session stats for a chat.
 */
export function getSessionStats(chatId: string): SessionStats {
    return ensureSession(chatId);
}

/**
 * Get the call log for a chat (most recent first).
 */
export function getCallLog(chatId: string): CallRecord[] {
    return [...ensureSession(chatId).callLog].reverse();
}

/**
 * Reset session stats (called on /new).
 */
export function resetSessionStats(chatId: string): void {
    sessions.set(chatId, emptyStats());
}

// ─── Formatters ───────────────────────────────────────────────────

/**
 * Format a cost value to a sensible number of decimal places.
 * Shows 4 decimal places for small values to avoid showing "$0.0000".
 */
function formatCost(usd: number): string {
    if (usd === 0) return "$0.00";
    if (usd < 0.0001) return `$${usd.toFixed(8)}`;
    if (usd < 0.01) return `$${usd.toFixed(5)}`;
    return `$${usd.toFixed(4)}`;
}

/**
 * Format a duration in ms into a human-readable string.
 */
export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

/**
 * Format the quick session status block shown by /status.
 */
export function formatSessionStatus(chatId: string, messageCount: number): string {
    const stats = getSessionStats(chatId);
    const uptime = formatDuration(Date.now() - stats.sessionStartedAt.getTime());
    const avgLatency = stats.requestCount > 0
        ? `${Math.round(stats.totalLatencyMs / stats.requestCount).toLocaleString()} ms`
        : "—";

    const lines = [
        "📊 **Session Status**\n",
        `⏱️ **Session Duration:**   ${uptime}`,
        `💬 **Messages in Buffer:** ${messageCount}`,
        `🔢 **LLM Requests:**       ${stats.requestCount}`,
        `⚡ **Avg Latency:**         ${avgLatency}`,
        "",
        "📈 **Token Consumption:**",
        `   → Prompt tokens:       ${stats.promptTokens.toLocaleString()}`,
        `   → Completion tokens:   ${stats.completionTokens.toLocaleString()}`,
        `   → **Total tokens:**    ${stats.totalTokens.toLocaleString()}`,
        "",
        `💰 **Estimated Cost:**     ${formatCost(stats.estimatedCostUsd)}`,
    ];

    return lines.join("\n");
}

/**
 * Format the full /usage report: summary block + per-call breakdown table.
 */
export function formatUsageReport(chatId: string): string {
    const stats = getSessionStats(chatId);

    if (stats.requestCount === 0) {
        return "📈 **Usage** — No LLM calls recorded yet this session.";
    }

    const avgTokens = Math.round(stats.totalTokens / stats.requestCount);
    const avgLatency = Math.round(stats.totalLatencyMs / stats.requestCount);

    // ── Header summary ──────────────────────────────────────────────
    const lines: string[] = [
        "📈 **Usage Report** (this session)\n",
        `🔢 **LLM Requests:**       ${stats.requestCount}`,
        `📥 **Prompt tokens:**      ${stats.promptTokens.toLocaleString()}`,
        `📤 **Completion tokens:**  ${stats.completionTokens.toLocaleString()}`,
        `⚡ **Total tokens:**       ${stats.totalTokens.toLocaleString()}`,
        `📊 **Avg tokens/request:** ${avgTokens.toLocaleString()}`,
        `🕐 **Avg latency:**        ${avgLatency.toLocaleString()} ms`,
        `💰 **Total est. cost:**    ${formatCost(stats.estimatedCostUsd)}`,
    ];

    // ── Per-model breakdown ─────────────────────────────────────────
    const byModel = new Map<string, { count: number; tokens: number; cost: number }>();
    for (const r of stats.callLog) {
        const existing = byModel.get(r.model) ?? { count: 0, tokens: 0, cost: 0 };
        existing.count += 1;
        existing.tokens += r.totalTokens;
        existing.cost += r.estimatedCostUsd;
        byModel.set(r.model, existing);
    }

    if (byModel.size > 0) {
        lines.push("", "**By model:**");
        for (const [model, agg] of byModel.entries()) {
            lines.push(
                `  \`${model}\`  ×${agg.count}  —  ${agg.tokens.toLocaleString()} tok  ${formatCost(agg.cost)}`
            );
        }
    }

    // ── Per-call log (last MAX_CALL_LOG, most recent first) ─────────
    const log = getCallLog(chatId);
    if (log.length > 0) {
        lines.push("", `**Last ${log.length} call${log.length === 1 ? "" : "s"}:**`);

        for (let i = 0; i < log.length; i++) {
            const r = log[i];
            const time = new Date(r.timestamp).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            });

            lines.push(
                `  **#${i + 1}** \`${time}\`  \`${r.model}\`` +
                `  in=${r.promptTokens.toLocaleString()} out=${r.completionTokens.toLocaleString()}` +
                `  ${formatCost(r.estimatedCostUsd)}  ${r.latencyMs.toLocaleString()}ms`
            );
        }
    }

    return lines.join("\n");
}
