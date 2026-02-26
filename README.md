# 🦅 Gravity Claw

A lean, secure, fully-understood personal AI agent on Telegram. Built from scratch with TypeScript.

## Features

### 💬 Core

- **AI Chat** — Powered by Claude via OpenRouter
- **Precision Data** — Focuses specifically on executing web searches and reading URLs accurately.
- **Stateless Execution** — Simple prompt/response architecture for maximum reliability.

### 🔧 Tools

| Tool               | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `web_search`       | Search the web via Tavily (primary) or DuckDuckGo (fallback)       |
| `read_url`         | Fetch any URL and extract readable text for summarization/analysis |
| `get_current_time` | Check the current time in any timezone                             |
| `read_url`         | Fetch any URL and extract readable text for summarization/analysis |
| `translate`        | Translate text between any languages with auto-detection           |
| `get_current_time` | Check the current time in any timezone                             |

### 📎 File & Media Handling

- **📄 PDF Reading** — Send a PDF, bot extracts text and analyzes it
- **🖼️ Image Understanding** — Send a photo, bot describes and reasons about it (multimodal vision)

### 🛡️ Security

- User ID whitelist — only responds to authorized Telegram accounts
- Secrets in `.env` only — never in code or logs

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

| Variable             | Required | Description                                                    |
| -------------------- | -------- | -------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | ✅       | From [@BotFather](https://t.me/BotFather)                      |
| `OPENROUTER_API_KEY` | ✅       | From [openrouter.ai](https://openrouter.ai/)                   |
| `ALLOWED_USER_IDS`   | ✅       | Comma-separated Telegram user IDs                              |
| `TAVILY_API_KEY`     | ❌       | Enables better web search (optional, falls back to DuckDuckGo) |
| `LLM_MODEL`          | ❌       | Default: `anthropic/claude-sonnet-4-20250514`                  |
| `FALLBACK_MODEL`     | ❌       | Backup model if primary fails                                  |

## Architecture

```
Telegram (long-polling)
       │
       ▼
 ┌──────────┐
 │   Bot    │ ← user whitelist + PDF/image handlers
 └────┬─────┘
      │
 ┌────▼─────┐     ┌────────────────┐
 │  Claude  │────▶│  3 Tools       │
 │  (LLM)   │◀────│ search, time,  │
 └──────────┘     │ read_url       │
                  └────────────────┘
```

## Commands

| Command   | Description                    |
| --------- | ------------------------------ |
| `/start`  | Welcome message                |
| `/help`   | List commands and capabilities |
| `/status` | Bot status and tool count      |
| `/model`  | Current LLM model info         |

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
- **Logging**: pino + pino-pretty
- **PDF**: pdf-parse
- **Testing**: vitest
