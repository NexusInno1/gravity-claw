/**
 * Slash Command System — Single Source of Truth
 *
 * ALL slash commands are handled here. Channel adapters (Telegram)
 * call handleSlashCommand() and only deal with sending the result.
 *
 * Supported commands:
 *   /start    — alias for /new
 *   /new      — clear conversation history
 *   /reset    — alias for /new
 *   /status   — session uptime, message count, memory stats
 *   /compact  — manually compact buffer into a rolling summary
 *   /model    — show active model, or switch it for this session
 *   /heartbeat     — show heartbeat scheduler status
 *   /heartbeat_set — change morning check-in time
 *   /pin      — save something to permanent core memory
 *   /forget   — remove a core memory entry
 *   /memories — view all pinned core memory entries
 *   /reminders — view pending reminders
 *   /clear_memories — clear session buffer + summary
 *   /help     — list all available commands
 */

import { ENV } from "../config.js";
import { getProviderName } from "../lib/router.js";
import {
  clearChatHistory,
  compactChatHistory,
  getMessageCount,
} from "../memory/buffer.js";
import { setCoreMemory, buildCoreMemoryPrompt, getCoreMemory } from "../memory/core.js";
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
  // ── Gemini 3.x ─────────────────────────────────────────────────────────
  "flash": "gemini-3-flash-preview",
  "flash-3": "gemini-3-flash-preview",
  "flash-3.0": "gemini-3-flash-preview",
  "pro-3.1": "gemini-3.1-pro-preview",
  "flash-lite-3.1": "gemini-3.1-flash-lite-preview",

  // ── Gemini 2.5 ─────────────────────────────────────────────────────────
  "pro": "gemini-2.5-pro",
  "pro-2.5": "gemini-2.5-pro",
  "flash-2.5": "gemini-2.5-flash",
  "flash-lite": "gemini-2.5-flash-lite",
  "flash-lite-2.5": "gemini-2.5-flash-lite",

  // ── Gemini 2.0 ─────────────────────────────────────────────────────────
  "flash-2.0": "gemini-2.0-flash",
  "flash-lite-2.0": "gemini-2.0-flash-lite",

  // ── Gemini 1.5 (legacy) ────────────────────────────────────────────────
  "pro-1.5": "gemini-1.5-pro",
  "flash-1.5": "gemini-1.5-flash",
  "flash-8b": "gemini-1.5-flash-8b",

  // ── OpenRouter Free Tier ───────────────────────────────────────────────
  "llama": "meta-llama/llama-4-maverick:free",
  "llama-maverick": "meta-llama/llama-4-maverick:free",
  "llama-scout": "meta-llama/llama-4-scout:free",
  "deepseek": "deepseek/deepseek-chat-v3-0324:free",
  "deepseek-v3": "deepseek/deepseek-chat-v3-0324:free",
  "deepseek-r1": "deepseek/deepseek-r1-0528:free",
  "deepseek-r1-zero": "deepseek/deepseek-r1-zero:free",
  "qwen": "qwen/qwen3-235b-a22b:free",
  "qwen3": "qwen/qwen3-235b-a22b:free",
  "qwen-coder": "qwen/qwen3-coder-480b-a35b:free",
  "mistral": "mistralai/mistral-small-3.1-24b-instruct:free",
  "mistral-small": "mistralai/mistral-small-3.1-24b-instruct:free",
  "mistral-7b": "mistralai/mistral-7b-instruct:free",
  "phi": "microsoft/phi-4-reasoning-plus:free",
  "nemotron": "nvidia/nemotron-3-super:free",

  // ── OpenRouter Paid — Claude ───────────────────────────────────────────
  "claude": "anthropic/claude-3.7-sonnet",
  "claude-sonnet": "anthropic/claude-3.7-sonnet",
  "claude-opus": "anthropic/claude-3.7-opus",
  "claude-haiku": "anthropic/claude-3.5-haiku",
  "claude-3.5": "anthropic/claude-3.5-sonnet",

  // ── OpenRouter Paid — OpenAI / GPT ────────────────────────────────────
  "gpt": "openai/gpt-4o",
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gpt-5": "openai/gpt-5.4",
  "gpt-5-mini": "openai/gpt-5.4-mini",
  "o3": "openai/o3",
  "o4-mini": "openai/o4-mini",

  // ── OpenRouter Paid — Llama paid ──────────────────────────────────────
  "llama-paid": "meta-llama/llama-4-maverick",
  "llama-3.3": "meta-llama/llama-3.3-70b-instruct",

  // ── OpenRouter Paid — Mistral ──────────────────────────────────────────
  "mistral-large": "mistralai/mistral-large",

  // ── OpenRouter Paid — Qwen ────────────────────────────────────────────
  "qwq": "qwen/qwq-32b",
  "qwen-paid": "qwen/qwen3-235b-a22b",

  // ── OpenRouter Paid — DeepSeek ────────────────────────────────────────
  "deepseek-paid": "deepseek/deepseek-chat-v3-0324",
  "deepseek-r1-paid": "deepseek/deepseek-r1",
};

function resolveModel(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  if (KNOWN_MODELS[lower]) return KNOWN_MODELS[lower];
  if (lower.startsWith("gemini-")) return lower;
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
 * Plain-text keyword aliases → equivalent slash command.
 */
const PLAIN_TEXT_ALIASES: [RegExp, string][] = [
  [/^show\s+(my\s+)?status$/i, "/status"],
  [/^check\s+(my\s+)?status$/i, "/status"],
  [/^show\s+(my\s+)?model$/i, "/model"],
  [/^current\s+model$/i, "/model"],
  [/^which\s+model$/i, "/model"],
  [/^heartbeat\s*(status|info)?$/i, "/heartbeat"],
  [/^show\s+(my\s+)?memories$/i, "/memories"],
  [/^list\s+(my\s+)?memories$/i, "/memories"],
  [/^core\s+memory$/i, "/memories"],
  [/^show\s+(my\s+)?reminders?$/i, "/reminders"],
  [/^list\s+(my\s+)?reminders?$/i, "/reminders"],
  [/^pending\s+reminders?$/i, "/reminders"],
  [/^start\s+over$/i, "/new"],
  [/^new\s+(session|chat|conversation)$/i, "/new"],
  [/^clear\s+(history|chat|session)$/i, "/new"],
  [/^compact\s+(history|buffer|chat)$/i, "/compact"],
  [/^forget\s+all$/i, "/forget all"],
  [/^clear\s+(my\s+)?memor(y|ies)$/i, "/clear_memories"],
  [/^reset\s+memory$/i, "/clear_memories"],
  [/^show\s+help$/i, "/help"],
  [/^all\s+commands$/i, "/help"],
  // Single-word
  [/^status$/i, "/status"],
  [/^stats$/i, "/status"],
  [/^help$/i, "/help"],
  [/^commands$/i, "/help"],
  [/^compact$/i, "/compact"],
  [/^new$/i, "/new"],
  [/^reset$/i, "/reset"],
  [/^clear$/i, "/new"],
  [/^model$/i, "/model"],
  [/^forget$/i, "/forget"],
  [/^memories$/i, "/memories"],
  [/^reminders?$/i, "/reminders"],
  [/^heartbeat$/i, "/heartbeat"],
  [/^schedule$/i, "/heartbeat"],
];

export async function handleSlashCommand(
  text: string,
  chatId: string,
): Promise<SlashCommandResult> {
  let trimmed = text.trim();

  for (const [pattern, command] of PLAIN_TEXT_ALIASES) {
    if (pattern.test(trimmed)) {
      trimmed = command;
      break;
    }
  }

  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

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

    case "/compact":
      return handleCompact(chatId);

    case "/model":
      return handleModel(chatId, args);

    case "/heartbeat":
      return handleHeartbeat();

    case "/heartbeat_set":
      return handleHeartbeatSet(args);

    case "/pin":
      return handlePin(chatId, args);

    case "/help":
      return handleHelp();

    case "/forget":
      return handleForget(args);

    case "/memories":
      return handleMemories();

    case "/reminders":
      return handleReminders();

    case "/clear_memories":
      return handleClearMemories(chatId);

    default:
      return { handled: false };
  }
}

// ─── Handlers ─────────────────────────────────────────────────────

async function handleStatus(chatId: string): Promise<SlashCommandResult> {
  const messageCount = await getMessageCount(chatId);
  const { getPendingReminderCount } = await import("../tools/set_reminder.js");
  const { getCoreMemoryCount } = await import("../memory/core.js");
  const reminderCount = getPendingReminderCount();
  const memoryCount = getCoreMemoryCount();

  const uptime = formatDuration(Math.round(process.uptime() * 1000));

  const response = [
    "📊 **Session Status**\n",
    `🤖 **Bot Uptime:**         ${uptime}`,
    `💬 **Messages in Buffer:** ${messageCount}`,
    `🧠 **Core Memories:**      ${memoryCount}`,
    `⏰ **Pending Reminders:**  ${reminderCount}`,
    "",
    `🔧 **Active Model:**       \`${getEffectiveModel(chatId)}\``,
  ].join("\n");

  return { handled: true, response };
}

async function handleNew(chatId: string): Promise<SlashCommandResult> {
  await clearChatHistory(chatId);
  clearModelOverride(chatId);

  const response = [
    "🆕 **New session started.**\n",
    "✅ Conversation history cleared",
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
      "**Gemini 3.x:**    `/model flash` | `/model pro-3.1` | `/model flash-lite-3.1`",
      "**Gemini 2.5:**    `/model pro` | `/model flash-2.5` | `/model flash-lite`",
      "**Gemini 2.0:**    `/model flash-2.0` | `/model flash-lite-2.0`",
      "**Gemini 1.5:**    `/model pro-1.5` | `/model flash-1.5` | `/model flash-8b`",
      "",
      "**Free — Llama:**     `llama` | `llama-scout`",
      "**Free — DeepSeek:**  `deepseek` | `deepseek-r1` | `deepseek-r1-zero`",
      "**Free — Qwen:**      `qwen` | `qwen-coder`",
      "**Free — Mistral:**   `mistral` | `mistral-7b`",
      "**Free — Other:**     `phi` | `nemotron`",
      "",
      "**Paid — Claude:**    `claude` | `claude-opus` | `claude-haiku` | `claude-3.5`",
      "**Paid — GPT:**       `gpt` | `gpt-4o-mini` | `gpt-5` | `gpt-5-mini` | `o3` | `o4-mini`",
      "**Paid — Other:**     `mistral-large` | `qwq` | `deepseek-paid` | `deepseek-r1-paid`",
      "",
      "**Any model:**        `/model provider/model-name`",
      "**Reset to default:** `/model reset`",
    );

    return { handled: true, response: lines.join("\n") };
  }

  if (args[0].toLowerCase() === "reset") {
    clearModelOverride(chatId);
    return {
      handled: true,
      response: `✅ Model reset to default: \`${defaultModel}\``,
    };
  }

  const resolved = resolveModel(args[0]);
  if (!resolved) {
    return {
      handled: true,
      response: [
        `❌ Unknown model: \`${args[0]}\`\n`,
        "**Gemini:**    `flash`, `flash-2.5`, `flash-2.0`, `flash-lite`, `pro`, `pro-3.1`, `pro-1.5`",
        "**Free OR:**   `llama`, `deepseek`, `deepseek-r1`, `qwen`, `mistral`, `phi`, `nemotron`",
        "**Paid OR:**   `claude`, `claude-opus`, `gpt`, `gpt-5`, `o3`, `mistral-large`, `qwq`",
        "**Full name:** e.g. `gemini-2.5-flash` or `anthropic/claude-3.7-sonnet`",
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
      response: [
        "**Usage:** `/heartbeat_set HH:MM`",
        "Sets the morning check-in time (IST, 24-hour format).",
        "",
        "Example: `/heartbeat_set 09:00`",
      ].join("\n"),
    };
  }

  const timeArg = args[0];
  const timeMatch = timeArg.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    return {
      handled: true,
      response: "Invalid format. Use HH:MM (24-hour IST). Example: `/heartbeat_set 09:00`",
    };
  }

  const hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return {
      handled: true,
      response: "Invalid time. Hour: 0–23, Minute: 0–59.",
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
    "⚡ **SUNDAY Commands**\n",
    "**Memory**",
    "`/pin <text>`       — Save something to permanent core memory",
    "`/forget <key>`     — Remove a core memory entry (`/forget all` clears all)",
    "`/memories`         — View all pinned core memory entries",
    "`/clear_memories`   — Clear session buffer + summary (core stays)",
    "",
    "**Session**",
    "`/status`           — Uptime, message count, memory stats",
    "`/new`              — Start fresh (clear history, reset model override)",
    "`/compact`          — Compress buffer into a rolling summary",
    "`/model [name]`     — Show or switch model for this session",
    "",
    "**Heartbeat & Reminders**",
    "`/heartbeat`        — Show scheduler status",
    "`/heartbeat_set`    — Change morning check-in time: `/heartbeat_set 09:00`",
    "`/reminders`        — View pending reminders",
    "",
    "_Commands are handled locally and never sent to the LLM._",
  ].join("\n");

  return { handled: true, response };
}

async function handlePin(chatId: string, args: string[]): Promise<SlashCommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: [
        "📌 **Pin to Memory**\n",
        "**Usage:**",
        "`/pin <key> <value>` — Save with a specific key",
        "`/pin <value>`       — Auto-generate a key\n",
        "**Examples:**",
        "`/pin my_goal Build a profitable SaaS by June`",
        "`/pin Buy groceries on Sunday`",
      ].join("\n"),
    };
  }

  let key: string;
  let value: string;

  if (args.length >= 2 && !args[0].includes(" ") && args[0].length <= 30) {
    key = `pin_${args[0]}`;
    value = args.slice(1).join(" ");
  } else {
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

async function handleForget(args: string[]): Promise<SlashCommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: [
        "🗑 **Forget Memory**\n",
        "**Usage:**",
        "`/forget <key>`   — Remove one memory entry",
        "`/forget all`     — Wipe ALL core memories\n",
        "Use `/memories` to see your current keys.",
      ].join("\n"),
    };
  }

  const { deleteCoreMemory, clearAllCoreMemories } = await import("../memory/core.js");

  if (args[0].toLowerCase() === "all") {
    await clearAllCoreMemories();
    return { handled: true, response: "🗑 All core memories cleared." };
  }

  const key = args.join(" ");
  if (!getCoreMemory(key)) {
    const memoriesStr = buildCoreMemoryPrompt();
    const keyHint = memoriesStr
      ? `\n\n**Available keys:**\n${memoriesStr.replace("## Core Memory (Always Active)\n", "")}`
      : "\n\nYour core memory is empty.";
    return { handled: true, response: `❌ No memory found with the key \`${key}\`.${keyHint}` };
  }

  await deleteCoreMemory(key);
  return { handled: true, response: `✅ Forgot memory: \`${key}\`` };
}

async function handleMemories(): Promise<SlashCommandResult> {
  const memoriesStr = buildCoreMemoryPrompt();

  if (!memoriesStr) {
    return {
      handled: true,
      response: "📭 Your core memory is completely empty.\n\nUse `/pin <key> <value>` to pin long-term traits, preferences, or goals.",
    };
  }

  return {
    handled: true,
    response: `🧠 **Your Core Memory**\n\n${memoriesStr.replace("## Core Memory (Always Active)\n", "")}\n\n_Use \`/forget <key>\` to remove an item._`,
  };
}

async function handleReminders(): Promise<SlashCommandResult> {
  const { listPendingReminders } = await import("../tools/set_reminder.js");
  const response = listPendingReminders();
  return { handled: true, response };
}

async function handleClearMemories(chatId: string): Promise<SlashCommandResult> {
  const countBefore = await getMessageCount(chatId);
  await clearChatHistory(chatId);

  return {
    handled: true,
    response: [
      "🧹 **Session Memory Cleared**\n",
      `Removed **${countBefore}** buffered messages and rolling summary.`,
      "",
      "✅ Core memories are **untouched** (use `/forget` to manage those).",
      "",
      "_I'll start fresh context from your next message._",
    ].join("\n"),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
