import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables from .env file
config({ path: resolve(process.cwd(), ".env") });

const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
const discordToken = process.env.DISCORD_BOT_TOKEN || "";

if (!botToken && !discordToken) {
  throw new Error(
    "At least one of TELEGRAM_BOT_TOKEN or DISCORD_BOT_TOKEN must be defined in .env",
  );
}

if (!botToken) {
  console.warn("[Config] TELEGRAM_BOT_TOKEN missing — Telegram channel disabled.");
}
if (!discordToken) {
  console.warn("[Config] DISCORD_BOT_TOKEN missing — Discord channel disabled.");
}

const geminiKeysRaw = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY;
if (!geminiKeysRaw) {
  throw new Error("GEMINI_API_KEYS (or GEMINI_API_KEY) is not defined in .env");
}

// Parse comma-separated API keys
const geminiKeys = geminiKeysRaw
  .split(",")
  .map((k) => k.trim())
  .filter((k) => k.length > 0);

if (geminiKeys.length === 0) {
  throw new Error("No valid Gemini API keys found in .env");
}
console.log(`[Config] Loaded ${geminiKeys.length} Gemini API key(s).`);

// Supabase (optional — graceful degradation if missing)
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "[Config] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — memory tiers disabled.",
  );
}

const allowedUsersRaw = process.env.ALLOWED_USER_IDS;
if (!allowedUsersRaw) {
  throw new Error("ALLOWED_USER_IDS is not defined in .env");
}

// Parse comma-separated IDs into a Set of numbers for fast lookup
const allowedUsers = new Set(
  allowedUsersRaw.split(",").map((id) => {
    const parsed = parseInt(id.trim(), 10);
    if (isNaN(parsed)) {
      throw new Error(`Invalid user ID in ALLOWED_USER_IDS: ${id}`);
    }
    return parsed;
  }),
);

// Tavily Search (optional — used for structured/research queries)
const tavilyApiKey = process.env.TAVILY_API_KEY || "";
if (!tavilyApiKey) {
  console.warn(
    "[Config] TAVILY_API_KEY missing — web_research tool will be unavailable.",
  );
}

// Serper / Google Search (optional — used for direct link queries)
const serperApiKey = process.env.SERPER_API_KEY || "";
if (!serperApiKey) {
  console.warn(
    "[Config] SERPER_API_KEY missing — web_search will fall back to Tavily.",
  );
}

// OpenRouter (optional — used as fallback when Gemini keys are exhausted)
const openrouterApiKey = process.env.OPENROUTER_API_KEY || "";
const openrouterModel =
  process.env.OPENROUTER_MODEL ||
  "mistralai/mistral-small-3.1-24b-instruct:free";
if (!openrouterApiKey) {
  console.warn(
    "[Config] OPENROUTER_API_KEY missing — no LLM fallback available.",
  );
} else {
  console.log(
    `[Config] OpenRouter fallback enabled (model: ${openrouterModel}).`,
  );
}

export const ENV = {
  TELEGRAM_BOT_TOKEN: botToken,
  DISCORD_BOT_TOKEN: discordToken,
  GEMINI_API_KEYS: geminiKeys,
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  ALLOWED_USER_IDS: allowedUsers,
  HEARTBEAT_CHAT_ID: process.env.HEARTBEAT_CHAT_ID || "",
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: supabaseKey,
  TAVILY_API_KEY: tavilyApiKey,
  SERPER_API_KEY: serperApiKey,
  OPENROUTER_API_KEY: openrouterApiKey,
  OPENROUTER_MODEL: openrouterModel,
};
