import dotenv from "dotenv";

dotenv.config();

// ── Helpers ──────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error(`   Copy .env.example to .env and fill in your values.`);
    process.exit(1);
  }
  return value;
}

// ── Config ───────────────────────────────────────────────

export const config = {
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  openRouterApiKey: requireEnv("OPENROUTER_API_KEY"),
  tavilyApiKey: process.env.TAVILY_API_KEY || "", // Optional, enables better search

  allowedUserIds: requireEnv("ALLOWED_USER_IDS")
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id)),

  llmModel: process.env.LLM_MODEL || "google/gemini-2.5-flash:free",
  fallbackModel: process.env.FALLBACK_MODEL || "",
  llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
} as const;

// ── Validation ───────────────────────────────────────────

if (config.allowedUserIds.length === 0) {
  console.error(
    "❌ ALLOWED_USER_IDS must contain at least one valid Telegram user ID.",
  );
  process.exit(1);
}
