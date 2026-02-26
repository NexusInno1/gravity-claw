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

  llmModel: process.env.LLM_MODEL || "anthropic/claude-sonnet-4-20250514",
  fallbackModel: process.env.FALLBACK_MODEL || "",
  llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
  maxAgentIterations: parseInt(process.env.MAX_AGENT_ITERATIONS || "10", 10),

  // ── Memory (Level 2) ──────────────────────────────────
  pineconeApiKey: requireEnv("PINECONE_API_KEY"),
  pineconeIndex: requireEnv("PINECONE_INDEX"),
  memoryContextMessages: parseInt(
    process.env.MEMORY_CONTEXT_MESSAGES || "20",
    10,
  ),
  memorySemanticMatches: parseInt(
    process.env.MEMORY_SEMANTIC_MATCHES || "5",
    10,
  ),

  // ── Live Canvas (A2UI) ──────────────────────────────────
  canvasPort: parseInt(process.env.CANVAS_PORT || "3100", 10),
} as const;

// ── Validation ───────────────────────────────────────────

if (config.allowedUserIds.length === 0) {
  console.error(
    "❌ ALLOWED_USER_IDS must contain at least one valid Telegram user ID.",
  );
  process.exit(1);
}
