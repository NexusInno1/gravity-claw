# 🦅 Gravity Claw

A lean, secure, fully-understood personal AI agent on Telegram. Built from scratch with TypeScript.

## Features

### 💬 Core

- **AI Chat** — Powered by Claude via OpenRouter with ReAct agent loop
- **3-Layer Memory** — Session buffer + Pinecone semantic search + long-term compaction
- **Onboarding** — First-time user personality detection
- **Skills System** — Extensible skills loaded from markdown files

### 🔧 Tools

| Tool               | Description                                                                       |
| ------------------ | --------------------------------------------------------------------------------- |
| `web_search`       | Search the web via Tavily (primary) or DuckDuckGo (fallback)                      |
| `browser`          | Automate a real Chromium browser (Playwright) — navigate, click, type, screenshot |
| `push_canvas`      | Push interactive widgets (charts, tables, HTML) to a Live Canvas dashboard        |
| `schedule_task`    | Create recurring cron-based tasks with natural language ("every day at 6pm")      |
| `manage_tasks`     | List, pause, resume, or delete scheduled tasks                                    |
| `manage_webhooks`  | Create webhook endpoints that trigger the agent on HTTP POST                      |
| `send_file`        | Send files (reports, CSVs, code) back to the user as Telegram documents           |
| `set_reminder`     | One-off reminders ("remind me in 2 hours to...") — max 24h delay                  |
| `read_url`         | Fetch any URL and extract readable text for summarization/analysis                |
| `translate`        | Translate text between any languages with auto-detection                          |
| `get_current_time` | Check the current time in any timezone                                            |

### 📎 File & Media Handling

- **📄 PDF Reading** — Send a PDF, bot extracts text and analyzes it
- **🖼️ Image Understanding** — Send a photo, bot describes and reasons about it (multimodal vision)

### ⚡ Automation

- **Daily Heartbeat** — Proactive 8 AM IST accountability check-in with interactive buttons
- **Scheduled Tasks** — Persistent cron jobs that survive restarts
- **Webhooks** — HTTP endpoints that trigger the agent with payloads

### 🛡️ Security

- User ID whitelist — only responds to authorized Telegram accounts
- Secrets in `.env` only — never in code or logs
- Max iteration limit — prevents runaway agent loops
- Per-user concurrency lock — prevents session corruption

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure secrets
cp .env.example .env
# Edit .env with your keys (see below)

# 3. Run
npm run dev
```

## Configuration (.env)

| Variable               | Required | Description                                                    |
| ---------------------- | -------- | -------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`   | ✅       | From [@BotFather](https://t.me/BotFather)                      |
| `OPENROUTER_API_KEY`   | ✅       | From [openrouter.ai](https://openrouter.ai/)                   |
| `ALLOWED_USER_IDS`     | ✅       | Comma-separated Telegram user IDs                              |
| `PINECONE_API_KEY`     | ✅       | From [pinecone.io](https://www.pinecone.io/)                   |
| `PINECONE_INDEX`       | ✅       | Your Pinecone index name                                       |
| `TAVILY_API_KEY`       | ❌       | Enables better web search (optional, falls back to DuckDuckGo) |
| `LLM_MODEL`            | ❌       | Default: `anthropic/claude-sonnet-4-20250514`                  |
| `FALLBACK_MODEL`       | ❌       | Backup model if primary fails                                  |
| `MAX_AGENT_ITERATIONS` | ❌       | Default: `10`                                                  |
| `CANVAS_PORT`          | ❌       | Default: `3100`                                                |

## Architecture

```
Telegram (long-polling)
       │
       ▼
 ┌──────────┐
 │   Bot    │ ← user whitelist + PDF/image handlers
 └────┬─────┘
      │
 ┌────▼─────┐
 │  Agent   │ ← ReAct loop (multimodal)
 │  Loop    │
 └────┬─────┘
      │
 ┌────▼─────┐     ┌────────────────┐     ┌──────────┐
 │  Claude  │────▶│  11 Tools      │────▶│ Memory   │
 │  (LLM)   │◀────│ search, browse │     │ 3 layers │
 └──────────┘     │ file, remind.. │     └──────────┘
                  └────────────────┘
```

## Commands

| Command    | Description                       |
| ---------- | --------------------------------- |
| `/start`   | Welcome message                   |
| `/help`    | List commands and capabilities    |
| `/status`  | Bot status, uptime, tool count    |
| `/new`     | Clear session (memory preserved)  |
| `/model`   | Current LLM model info            |
| `/usage`   | Token usage & cost tracking       |
| `/compact` | Summarize & compress conversation |
| `/tasks`   | List scheduled tasks              |

## Deployment

Deployed on **Railway** with auto-deploy from GitHub.

```bash
git add -A
git commit -m "your message"
git push origin main
# Railway auto-deploys ✨
```

## Tech Stack

- **Runtime**: Node.js + TypeScript (tsx)
- **Telegram**: grammy
- **LLM**: OpenRouter (Claude) — OpenAI-compatible API
- **Memory**: Pinecone vector DB + in-memory session buffer
- **Browser**: Playwright (Chromium)
- **Scheduling**: node-cron
- **Logging**: pino + pino-pretty
- **PDF**: pdf-parse
- **Testing**: vitest
