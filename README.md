# 🦾 Gravity Claw

**A sharp, no-BS personal AI agent that lives in your Telegram.**

Gravity Claw is an agentic AI assistant built with TypeScript that runs on Telegram. Powered by Google's Gemini API with automatic OpenRouter fallback, it features a 3-tier memory system, real-time web search, vision capabilities, scheduled heartbeat check-ins, and a growing toolkit — all deployable via Docker.

---

## ✨ Features

### 🧠 3-Tier Memory System

- **Tier 1 — Core Memory**: Persistent key-value facts (preferences, goals, profile info) stored in Supabase
- **Tier 2 — Conversation Buffer**: Rolling window of recent messages + automatic summarization for long conversations
- **Tier 3 — Semantic Memory**: AI-powered fact extraction from conversations with vector similarity search for relevant recall

### 🛠️ Tool System

| Tool               | Description                                         |
| ------------------ | --------------------------------------------------- |
| `web_search`       | Real-time web search via Tavily API                 |
| `read_url`         | Fetch and extract content from any URL              |
| `get_current_time` | Timezone-aware current time                         |
| `remember_fact`    | Explicitly save important facts to long-term memory |
| `set_reminder`     | Set timed reminders that fire in-chat               |

### 🖼️ Vision Support

Send images directly in Telegram — Gravity Claw can analyze photos, screenshots, documents, and more using Gemini's multimodal capabilities.

### 💓 Heartbeat Scheduler

Configurable proactive daily check-ins with customizable jobs (news briefings, goal tracking, etc.) — the bot reaches out to _you_, not just the other way around.

### 🔄 Dual LLM Provider

- **Primary**: Google Gemini (free tier supported, multiple API key rotation)
- **Fallback**: OpenRouter (auto-switches when Gemini keys are rate-limited)

### 🔒 Access Control

Whitelist-based user authorization — only approved Telegram user IDs can interact with the bot.

---

## 🏗️ Architecture

```
src/
├── index.ts              # Entry point — boot sequence & graceful shutdown
├── config.ts             # Centralized environment config & validation
├── agent/
│   └── loop.ts           # Core agentic loop with tool calling & memory assembly
├── bot/
│   ├── index.ts          # grammY bot setup & middleware
│   └── handlers.ts       # Message handlers (text, photo, catch-all)
├── heartbeat/
│   ├── scheduler.ts      # Cron-like heartbeat scheduler
│   └── jobs.ts           # Heartbeat job definitions
├── lib/
│   ├── gemini.ts         # Gemini client with key rotation & retry logic
│   ├── openrouter.ts     # OpenRouter fallback provider
│   └── supabase.ts       # Supabase client initialization
├── memory/
│   ├── core.ts           # Tier 1 — Core memory (key-value facts)
│   ├── buffer.ts         # Tier 2 — Conversation buffer & summarization
│   └── semantic.ts       # Tier 3 — Semantic search & fact extraction
└── tools/
    ├── get_current_time.ts
    ├── web_search.ts
    ├── read_url.ts
    ├── remember_fact.ts
    └── set_reminder.ts
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- A [Telegram Bot Token](https://core.telegram.org/bots#botfather)
- [Google Gemini API Key(s)](https://aistudio.google.com/apikey)
- [Supabase](https://supabase.com/) project (optional — for persistent memory)
- [Tavily API Key](https://tavily.com/) (optional — for web search)
- [OpenRouter API Key](https://openrouter.ai/) (optional — for LLM fallback)

### 1. Clone the Repository

```bash
git clone https://github.com/NexusInno1/Gravity-Claw.git
cd Gravity-Claw
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Create a `.env` file in the project root:

```env
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEYS=key1,key2,key3
ALLOWED_USER_IDS=123456789,987654321

# Optional — Gemini model (default: gemini-2.5-flash)
GEMINI_MODEL=gemini-2.5-flash

# Optional — Persistent memory
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional — Web search
TAVILY_API_KEY=your_tavily_key

# Optional — LLM fallback
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=mistralai/mistral-small-3.1-24b-instruct:free

# Optional — Proactive heartbeat
HEARTBEAT_CHAT_ID=your_telegram_chat_id
```

### 4. Run

```bash
npm start
```

---

## 🐳 Docker Deployment

```bash
# Build the image
docker build -t gravity-claw .

# Run with your env file
docker run -d --env-file .env --name gravity-claw gravity-claw
```

---

## 🧩 How It Works

1. **User sends a message** → grammY receives it via long-polling
2. **Access check** → Only whitelisted user IDs are allowed
3. **Context assembly** → The agent loop builds a rich prompt:
   - `soul.md` personality + tool usage rules
   - Tier 1 core memories (user preferences, goals)
   - Tier 2 conversation history + rolling summary
   - Tier 3 semantically relevant past memories
4. **LLM call** → Gemini processes the context (falls back to OpenRouter on rate limits)
5. **Tool execution** → If the model requests tools, they're executed and results fed back in a loop (up to 5 iterations)
6. **Response** → Final text is sent back to Telegram
7. **Background tasks** → Facts are extracted and stored asynchronously for future recall

---

## ⚙️ Customization

### Personality

Edit `soul.md` to change the bot's personality, tone, and behavioral rules. The bot loads this file at startup as its core system prompt.

### Heartbeat Jobs

Modify `src/heartbeat/jobs.ts` to customize what the bot proactively sends you each day.

### Adding New Tools

1. Create a new file in `src/tools/` following the existing pattern
2. Export a `definition` (Gemini function declaration) and an `execute` function
3. Register them in `src/agent/loop.ts`

---

## 📝 Tech Stack

| Component    | Technology                                                |
| ------------ | --------------------------------------------------------- |
| Runtime      | Node.js 20 + TypeScript                                   |
| Telegram SDK | [grammY](https://grammy.dev/)                             |
| Primary LLM  | [Google Gemini](https://ai.google.dev/) (`@google/genai`) |
| Fallback LLM | [OpenRouter](https://openrouter.ai/) (Mistral Small 3.1)  |
| Database     | [Supabase](https://supabase.com/) (PostgreSQL + pgvector) |
| Web Search   | [Tavily](https://tavily.com/)                             |
| Deployment   | Docker                                                    |

---

## 📄 License

This project is for personal use. Feel free to fork and adapt it for your own AI assistant.

---

<p align="center">
  Built with 🦾 by <a href="https://github.com/NexusInno1">NexusInno1</a>
</p>
