/**
 * Session Statistics Tracker
 *
 * Tracks per-chat token consumption in memory.
 * Resets when the bot restarts or when a user runs /new or /reset.
 *
 * This is intentionally kept in-memory (no DB) because the data
 * is session-scoped and ephemeral.
 */

export interface SessionStats {
    /** Cumulative prompt tokens sent to the model */
    promptTokens: number;
    /** Cumulative completion tokens received from the model */
    completionTokens: number;
    /** Cumulative total tokens (prompt + completion) */
    totalTokens: number;
    /** Number of LLM requests made in this session */
    requestCount: number;
    /** When this session was started or last reset */
    sessionStartedAt: Date;
}

const sessions = new Map<string, SessionStats>();

/**
 * Get or create a session stats entry for a chat.
 */
function ensureSession(chatId: string): SessionStats {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            requestCount: 0,
            sessionStartedAt: new Date(),
        });
    }
    return sessions.get(chatId)!;
}

/**
 * Record token usage from a single LLM API response.
 */
export function recordTokenUsage(
    chatId: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
): void {
    const stats = ensureSession(chatId);
    stats.promptTokens += promptTokens;
    stats.completionTokens += completionTokens;
    stats.totalTokens += totalTokens;
    stats.requestCount += 1;
}

/**
 * Get the current session stats for a chat.
 */
export function getSessionStats(chatId: string): SessionStats {
    return ensureSession(chatId);
}

/**
 * Reset session stats (called on /new, /reset, /start).
 */
export function resetSessionStats(chatId: string): void {
    sessions.set(chatId, {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        sessionStartedAt: new Date(),
    });
}

/**
 * Format session stats into a user-friendly status message.
 */
export function formatSessionStatus(chatId: string, messageCount: number): string {
    const stats = getSessionStats(chatId);
    const uptime = formatDuration(Date.now() - stats.sessionStartedAt.getTime());

    const lines = [
        "📊 **Session Status**\n",
        `⏱️ **Session Duration:** ${uptime}`,
        `💬 **Messages in Buffer:** ${messageCount}`,
        `🔢 **LLM Requests:** ${stats.requestCount}`,
        "",
        "📈 **Token Consumption:**",
        `   → Prompt tokens:      ${stats.promptTokens.toLocaleString()}`,
        `   → Completion tokens:  ${stats.completionTokens.toLocaleString()}`,
        `   → **Total tokens:**   ${stats.totalTokens.toLocaleString()}`,
    ];

    return lines.join("\n");
}

/**
 * Format a duration in ms into a human-readable string.
 */
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}
