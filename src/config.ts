import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables from .env file
config({ path: resolve(process.cwd(), ".env") });

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined in .env");
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

// Tavily Search (optional — graceful degradation if missing)
const tavilyApiKey = process.env.TAVILY_API_KEY || "";
if (!tavilyApiKey) {
  console.warn(
    "[Config] TAVILY_API_KEY missing — web search will be unavailable.",
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
  GEMINI_API_KEYS: geminiKeys,
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  ALLOWED_USER_IDS: allowedUsers,
  HEARTBEAT_CHAT_ID: process.env.HEARTBEAT_CHAT_ID || "",
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: supabaseKey,
  TAVILY_API_KEY: tavilyApiKey,
  OPENROUTER_API_KEY: openrouterApiKey,
  OPENROUTER_MODEL: openrouterModel,
};
