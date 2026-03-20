/**
 * Slash Command System
 *
 * Parses incoming messages for slash commands and handles them
 * locally — before the message ever reaches the LLM. This keeps
 * latency close to zero and avoids burning tokens on housekeeping.
 *
 * Supported commands:
 *   /status   — session stats: uptime, message count, token usage
 *   /new      — clear conversation history and reset session stats
 *   /compact  — manually compact buffer into a rolling summary
 *   /model    — show active model, or switch it for this session
 *   /usage    — focused token breakdown (alias of /status)
 *   /help     — list all available commands
 */

import { ENV } from "../config.js";
import {
  getSessionStats,
  resetSessionStats,
  formatSessionStatus,
  formatUsageReport,
} from "./session-stats.js";
import {
  clearChatHistory,
  compactChatHistory,
  getMessageCount,
} from "../memory/buffer.js";

// ─── Per-session Model Override ───────────────────────────────────

/**
 * In-memory map of chatId → model override.
 * When set, this model is used instead of ENV.GEMINI_MODEL for that chat.
 * Resets when the bot restarts or the user runs /new.
 */
const sessionModelOverrides = new Map<string, string>();

/**
 * Get the effective model for a given chat (override takes precedence).
 */
export function getEffectiveModel(chatId: string): string {
  return sessionModelOverrides.get(chatId) ?? ENV.GEMINI_MODEL;
}

/**
 * Clear any model override for a chat (called on /new).
 */
function clearModelOverride(chatId: string): void {
  sessionModelOverrides.delete(chatId);
}

// ─── Known Gemini Models ──────────────────────────────────────────

const KNOWN_MODELS: Record<string, string> = {
  "flash": "gemini-2.5-flash",
  "flash-2.5": "gemini-2.5-flash",
  "flash-2.0": "gemini-2.0-flash",
  "pro": "gemini-2.5-pro",
  "pro-2.5": "gemini-2.5-pro",
  "pro-1.5": "gemini-1.5-pro",
  "flash-1.5": "gemini-1.5-flash",
  "flash-lite": "gemini-2.0-flash-lite",
};

function resolveModel(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  // Allow short aliases
  if (KNOWN_MODELS[lower]) return KNOWN_MODELS[lower];
  // Allow full model names starting with "gemini-"
  if (lower.startsWith("gemini-")) return lower;
  return null;
}

// ─── Command Definitions ──────────────────────────────────────────

export interface SlashCommandResult {
  /** True if the input was a slash command and was handled. */
  handled: boolean;
  /** The response to send back to the user (if handled). */
  response?: string;
}

/**
 * Attempt to parse and execute a slash command.
 *
 * @param text   Raw input from the user
 * @param chatId The chat ID for scoping session data
 * @returns SlashCommandResult — if handled is false, route to the LLM as normal
 */
export async function handleSlashCommand(
  text: string,
  chatId: string,
): Promise<SlashCommandResult> {
  const trimmed = text.trim();

  // Slash commands must start with '/'
  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  // Split on whitespace: ["/command", ...args]
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case "/status":
      return handleStatus(chatId);

    case "/usage":
      return handleUsage(chatId);

    case "/new":
      return handleNew(chatId);

    case "/compact":
      return handleCompact(chatId);

    case "/model":
      return handleModel(chatId, args);

    case "/help":
      return handleHelp();

    default:
      // Unknown slash command — let the LLM handle it naturally
      return { handled: false };
  }
}

// ─── Handlers ─────────────────────────────────────────────────────

async function handleStatus(chatId: string): Promise<SlashCommandResult> {
  const messageCount = await getMessageCount(chatId);
  const response = formatSessionStatus(chatId, messageCount);
  return { handled: true, response };
}

async function handleUsage(chatId: string): Promise<SlashCommandResult> {
  const response = formatUsageReport(chatId);
  return { handled: true, response };
}

async function handleNew(chatId: string): Promise<SlashCommandResult> {
  // Clear DB history + rolling summary
  await clearChatHistory(chatId);

  // Reset in-memory session stats
  resetSessionStats(chatId);

  // Reset model override
  clearModelOverride(chatId);

  const response = [
    "🆕 **New session started.**\n",
    "✅ Conversation history cleared",
    "✅ Session stats reset",
    "✅ Model override cleared",
    "",
    `Active model: \`${getEffectiveModel(chatId)}\``,
  ].join("\n");

  return { handled: true, response };
}

async function handleCompact(chatId: string): Promise<SlashCommandResult> {
  const response = await compactChatHistory(chatId);
  return { handled: true, response };
}

function handleModel(chatId: string, args: string[]): SlashCommandResult {
  const currentModel = getEffectiveModel(chatId);
  const defaultModel = ENV.GEMINI_MODEL;
  const override = sessionModelOverrides.get(chatId);

  // /model — show current state
  if (args.length === 0) {
    const lines = [
      "🤖 **Model Info**\n",
      `🟢 **Active model:**   \`${currentModel}\``,
      `⚙️  **Config default:**  \`${defaultModel}\``,
    ];

    if (override) {
      lines.push(`🔄 **Session override:** \`${override}\``);
    }

    lines.push(
      "",
      "**Switch model:**  `/model flash` | `/model pro` | `/model gemini-2.0-flash`",
      "**Reset to default:** `/model reset`",
      "",
      "**Shortcuts:** `flash`, `flash-2.0`, `flash-lite`, `pro`, `pro-1.5`, `flash-1.5`",
    );

    return { handled: true, response: lines.join("\n") };
  }

  // /model reset — remove override
  if (args[0].toLowerCase() === "reset") {
    clearModelOverride(chatId);
    return {
      handled: true,
      response: `✅ Model reset to default: \`${defaultModel}\``,
    };
  }

  // /model <name> — set override
  const resolved = resolveModel(args[0]);
  if (!resolved) {
    return {
      handled: true,
      response: [
        `❌ Unknown model: \`${args[0]}\`\n`,
        "**Valid shortcuts:** `flash`, `flash-2.0`, `flash-2.5`, `flash-lite`, `flash-1.5`, `pro`, `pro-1.5`, `pro-2.5`",
        "**Or use full name:** e.g. \`gemini-2.0-flash\`",
      ].join("\n"),
    };
  }

  sessionModelOverrides.set(chatId, resolved);
  return {
    handled: true,
    response: `✅ Model switched to \`${resolved}\` for this session.\n\n_Use \`/model reset\` to revert to the config default._`,
  };
}

function handleHelp(): SlashCommandResult {
  const response = [
    "⚡ **Slash Commands**\n",
    "`/status`   — Session stats: uptime, token usage, buffer size",
    "`/usage`    — Focused token consumption breakdown",
    "`/new`      — Start fresh: clear history, reset stats & model override",
    "`/compact`  — Compress current buffer into a rolling summary",
    "`/model`    — Show active model or switch it for this session",
    "`/help`     — Show this message",
    "",
    "_Commands are processed locally and never sent to the LLM._",
  ].join("\n");

  return { handled: true, response };
}
