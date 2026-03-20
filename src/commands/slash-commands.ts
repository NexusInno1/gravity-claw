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
import { getProviderName } from "../lib/router.js";
import { PROFILES } from "../agents/profiles.js";
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

    case "/agents":
      return handleAgents();

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

function handleHelp(): SlashCommandResult {
  const response = [
    "⚡ **Slash Commands**\n",
    "`/status`   — Session stats: uptime, token usage, buffer size",
    "`/usage`    — Focused token consumption breakdown",
    "`/new`      — Start fresh: clear history, reset stats & model override",
    "`/compact`  — Compress current buffer into a rolling summary",
    "`/model`    — Show active model or switch it for this session",
    "`/agents`   — List available sub-agents for delegation",
    "`/help`     — Show this message",
    "",
    "_Commands are processed locally and never sent to the LLM._",
  ].join("\n");

  return { handled: true, response };
}

function handleAgents(): SlashCommandResult {
  const lines = [
    "🤖 **Available Sub-Agents**\n",
    "The main agent can delegate complex tasks to specialized sub-agents.",
    "Just ask naturally — Gravity Claw decides when to delegate.\n",
  ];

  for (const profile of Object.values(PROFILES)) {
    lines.push(
      `${profile.icon} **${profile.label}** (\`${profile.name}\`)`,
    );
    // Extract first sentence of system prompt as description
    const firstLine = profile.systemPrompt
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("You are"));
    if (firstLine) {
      lines.push(`   ${firstLine.trim()}`);
    }
    const toolInfo = profile.allowedTools
      ? `Tools: ${profile.allowedTools.join(", ")}`
      : profile.deniedTools
        ? `All tools except: ${profile.deniedTools.join(", ")}`
        : "All tools";
    lines.push(
      `   _${toolInfo} · temp=${profile.temperature} · max ${profile.maxIterations} iterations_`,
    );
    lines.push("");
  }

  lines.push(
    "**Examples:**",
    '  _"Research the latest React 19 features in depth"_ → 🔬 Research Agent',
    '  _"Write a Python script to parse CSV files"_ → 💻 Code Agent',
    '  _"Summarize this article: [url]"_ → 📋 Summary Agent',
    '  _"Write a poem about space exploration"_ → 🎨 Creative Agent',
    '  _"Compare AWS vs GCP for a startup"_ → 📊 Analysis Agent',
  );

  return { handled: true, response: lines.join("\n") };
}
