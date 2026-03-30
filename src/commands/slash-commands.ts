/**
 * Slash Command System — Single Source of Truth
 *
 * ALL slash commands are handled here. Channel adapters (Telegram, Discord)
 * call handleSlashCommand() and only deal with sending the result.
 * This ensures every command works on every channel without duplication.
 *
 * Supported commands:
 *   /start    — alias for /new
 *   /new      — clear conversation history and reset session stats
 *   /reset    — alias for /new
 *   /status   — session stats: uptime, message count, token usage
 *   /usage    — focused token breakdown
 *   /compact  — manually compact buffer into a rolling summary
 *   /model    — show active model, or switch it for this session
 *   /heartbeat     — show heartbeat scheduler status
 *   /heartbeat_set — change morning check-in time
 *   /agents   — list available sub-agents
 *   /pin      — save something to permanent core memory
 *   /help     — list all available commands
 */

import { ENV } from "../config.js";
import { getProviderName } from "../lib/router.js";
import { PROFILES } from "../agent/profiles.js";
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
import { setCoreMemory } from "../memory/core.js";
import {
  getHeartbeatStatus,
  updateHeartbeatTime,
} from "../heartbeat/scheduler.js";

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
export function clearModelOverride(chatId: string): void {
  sessionModelOverrides.delete(chatId);
}

// ─── Known Model Shortcuts ────────────────────────────────────────

const KNOWN_MODELS: Record<string, string> = {
  // Gemini shortcuts
  "flash": "gemini-2.5-flash",
  "flash-2.5": "gemini-2.5-flash",
  "flash-2.0": "gemini-2.0-flash",
  "pro": "gemini-2.5-pro",
  "pro-2.5": "gemini-2.5-pro",
  "pro-1.5": "gemini-1.5-pro",
  "flash-1.5": "gemini-1.5-flash",
  "flash-lite": "gemini-2.0-flash-lite",

  // OpenRouter shortcuts — popular free/cheap models
  "mistral": "mistralai/mistral-small-3.1-24b-instruct:free",
  "mistral-small": "mistralai/mistral-small-3.1-24b-instruct:free",
  "llama": "meta-llama/llama-4-maverick:free",
  "llama-scout": "meta-llama/llama-4-scout:free",
  "llama-maverick": "meta-llama/llama-4-maverick:free",
  "deepseek": "deepseek/deepseek-chat-v3-0324:free",
  "deepseek-r1": "deepseek/deepseek-r1-0528:free",
  "qwen": "qwen/qwen3-235b-a22b:free",
  "phi": "microsoft/phi-4-reasoning-plus:free",
};

function resolveModel(raw: string): string | null {
  const lower = raw.toLowerCase().trim();

  // Short aliases
  if (KNOWN_MODELS[lower]) return KNOWN_MODELS[lower];

  // Full Gemini model name (e.g. "gemini-2.0-flash")
  if (lower.startsWith("gemini-")) return lower;

  // Full OpenRouter model name (e.g. "anthropic/claude-3-haiku")
  // OpenRouter models always contain a "/" (provider/model format)
  if (lower.includes("/")) return lower;

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
    case "/start":
    case "/new":
    case "/reset":
      return handleNew(chatId);

    case "/status":
      return handleStatus(chatId);

    case "/usage":
      return handleUsage(chatId);

    case "/compact":
      return handleCompact(chatId);

    case "/model":
      return handleModel(chatId, args);

    case "/heartbeat":
      return handleHeartbeat();

    case "/heartbeat_set":
      return handleHeartbeatSet(args);

    case "/agents":
      return handleAgents();

    case "/pin":
      return handlePin(chatId, args);

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
  const provider = getProviderName(currentModel);

  // /model — show current state
  if (args.length === 0) {
    const lines = [
      "🤖 **Model Info**\n",
      `🟢 **Active model:**   \`${currentModel}\``,
      `🔌 **Provider:**        ${provider}`,
      `⚙️  **Config default:**  \`${defaultModel}\``,
    ];

    if (override) {
      lines.push(`🔄 **Session override:** \`${override}\``);
    }

    lines.push(
      "",
      "**Gemini models:**  `/model flash` | `/model pro` | `/model gemini-2.0-flash`",
      "**OpenRouter models:** `/model mistral` | `/model llama` | `/model deepseek`",
      "**Any model:**     `/model provider/model-name` (e.g. `/model anthropic/claude-3-haiku`)",
      "**Reset to default:** `/model reset`",
      "",
      "**Gemini shortcuts:** `flash`, `flash-2.0`, `flash-lite`, `pro`, `pro-1.5`, `flash-1.5`",
      "**OpenRouter shortcuts:** `mistral`, `llama`, `llama-scout`, `deepseek`, `deepseek-r1`, `qwen`, `phi`",
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
        "**Gemini shortcuts:** `flash`, `flash-2.0`, `flash-2.5`, `flash-lite`, `flash-1.5`, `pro`, `pro-1.5`, `pro-2.5`",
        "**OpenRouter shortcuts:** `mistral`, `llama`, `llama-scout`, `deepseek`, `deepseek-r1`, `qwen`, `phi`",
        "**Or use full name:** e.g. `gemini-2.0-flash` or `anthropic/claude-3-haiku`",
      ].join("\n"),
    };
  }

  const resolvedProvider = getProviderName(resolved);
  sessionModelOverrides.set(chatId, resolved);
  return {
    handled: true,
    response: `✅ Model switched to \`${resolved}\` (${resolvedProvider}) for this session.\n\n_Use \`/model reset\` to revert to the config default._`,
  };
}

function handleHeartbeat(): SlashCommandResult {
  const status = getHeartbeatStatus();
  return { handled: true, response: status };
}

function handleHeartbeatSet(args: string[]): SlashCommandResult {
  if (args.length === 0) {
    return {
      handled: true,
      response: "Usage: `/heartbeat_set HH:MM`\nExample: `/heartbeat_set 09:30`",
    };
  }

  const timeMatch = args[0].match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    return {
      handled: true,
      response: "Invalid format. Use HH:MM (24-hour IST).\nExample: `/heartbeat_set 09:30`",
    };
  }

  const hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return {
      handled: true,
      response: "Invalid time. Hour: 0-23, Minute: 0-59.",
    };
  }

  const updated = updateHeartbeatTime("Morning Check-in", hour, minute);
  if (updated) {
    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return {
      handled: true,
      response: `✅ Morning check-in updated to **${timeStr} IST**.`,
    };
  } else {
    return {
      handled: true,
      response: "Could not find the Morning Check-in job. Is the heartbeat scheduler running?",
    };
  }
}

function handleHelp(): SlashCommandResult {
  const response = [
    "⚡ **Slash Commands**\n",
    "`/status`          — Session stats: uptime, token usage, buffer size",
    "`/usage`           — Focused token consumption breakdown",
    "`/new`             — Start fresh: clear history, reset stats & model override",
    "`/compact`         — Compress current buffer into a rolling summary",
    "`/model`           — Show active model or switch it for this session",
    "`/heartbeat`       — Show heartbeat scheduler status",
    "`/heartbeat_set`   — Change morning check-in time (e.g. `/heartbeat_set 09:30`)",
    "`/agents`          — List available sub-agents for delegation",
    "`/pin`             — Save something to permanent core memory",
    "`/help`            — Show this message",
    "",
    "_Commands are processed locally and never sent to the LLM._",
  ].join("\n");

  return { handled: true, response };
}

async function handlePin(chatId: string, args: string[]): Promise<SlashCommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: [
        "📌 **Pin to Memory**\n",
        "Save anything to permanent core memory.\n",
        "**Usage:**",
        "`/pin <key> <value>` — Save with a specific key",
        "`/pin <value>`       — Auto-generate a key (pin_1, pin_2, ...)",
        "",
        "**Examples:**",
        "`/pin api_key My API key is in .env.local`",
        "`/pin Buy groceries on Sunday`",
      ].join("\n"),
    };
  }

  let key: string;
  let value: string;

  // If first arg looks like a key (no spaces, short), use it as the key
  if (args.length >= 2 && !args[0].includes(" ") && args[0].length <= 30) {
    key = `pin_${args[0]}`;
    value = args.slice(1).join(" ");
  } else {
    // Auto-generate key with timestamp
    key = `pin_${Date.now()}`;
    value = args.join(" ");
  }

  try {
    await setCoreMemory(key, value);
    return {
      handled: true,
      response: `📌 **Pinned to core memory.**\n\n🔑 \`${key}\`\n📝 ${value}`,
    };
  } catch (err) {
    return {
      handled: true,
      response: `❌ Failed to pin: ${String(err)}`,
    };
  }
}

function handleAgents(): SlashCommandResult {
  const agentLines: string[] = [];

  for (const profile of Object.values(PROFILES)) {
    // Pull the first meaningful description line from the system prompt
    const description = profile.systemPrompt
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("You are"))
      ?.trim() ?? "";

    const toolInfo = profile.allowedTools
      ? profile.allowedTools.join(", ")
      : profile.deniedTools
        ? `All tools except: ${profile.deniedTools.join(", ")}`
        : "All tools";

    agentLines.push(
      `${profile.icon} **${profile.label}** — \`${profile.name}\``,
      `> ${description}`,
      `> 🛠 ${toolInfo}`,
      `> ⚙️ temp \`${profile.temperature}\` · max \`${profile.maxIterations}\` iterations`,
      "",
    );
  }

  const response = [
    "🤖 **Sub-Agent Directory**\n",
    "Gravity Claw automatically delegates to the right specialist.",
    "You don't need to invoke agents manually — just ask naturally.\n",
    "───────────────────────────",
    "",
    ...agentLines,
    "───────────────────────────",
    "",
    "**When to use each agent:**",
    "🔬 Research  → Deep dives, fact-checking, news, documentation",
    "💻 Code      → Write, review, debug, or explain code",
    "📋 Summary   → Condense articles, docs, or long content",
    "🎨 Creative  → Stories, poems, copy, or any creative writing",
    "📊 Analysis  → Compare options, spot patterns, make recommendations",
    "💼 Jobs      → Find real job listings via Apify (LinkedIn, Indeed, Naukri)",
    "",
    "_Tasks are matched to the best agent automatically._",
  ].join("\n");

  return { handled: true, response };
}
