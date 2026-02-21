# 🦅 Gravity Claw

A lean, secure, fully-understood personal AI agent. Inspired by [OpenClaw](https://github.com/openclaw/openclaw), built from scratch.

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

| Variable               | Required | Description                                                               |
| ---------------------- | -------- | ------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`   | ✅       | From [@BotFather](https://t.me/BotFather)                                 |
| `ANTHROPIC_API_KEY`    | ✅       | From [console.anthropic.com](https://console.anthropic.com/)              |
| `ALLOWED_USER_IDS`     | ✅       | Your Telegram user ID (get from [@userinfobot](https://t.me/userinfobot)) |
| `CLAUDE_MODEL`         | ❌       | Default: `claude-sonnet-4-20250514`                                       |
| `MAX_AGENT_ITERATIONS` | ❌       | Default: `10`                                                             |

## Architecture

```
Telegram (long-polling, no web server)
          │
          ▼
    ┌──────────┐
    │   Bot    │  ← user ID whitelist (silent drop)
    └────┬─────┘
         │
    ┌────▼─────┐
    │  Agent   │  ← ReAct loop (max iterations)
    │  Loop    │
    └────┬─────┘
         │
    ┌────▼─────┐     ┌──────────────┐
    │  Claude  │────▶│    Tools      │
    │  (LLM)   │◀────│ get_time ... │
    └──────────┘     └──────────────┘
```

## Security

- ✅ User ID whitelist — only responds to your Telegram account
- ✅ No web server — Telegram long-polling only, no exposed ports
- ✅ Secrets in `.env` only — never in code or logs
- ✅ Max iteration limit — prevents runaway agent loops
- ✅ No third-party skills — integrations via MCP only (future)

## Build Levels

- **Level 1** ✅ Foundation — Telegram + Claude + agent loop
- **Level 2** ⬜ Memory — SQLite + FTS5 + memory tools
- **Level 3** ⬜ Voice — Whisper + ElevenLabs
- **Level 4** ⬜ Tools + MCP — shell, files, external services
- **Level 5** ⬜ Heartbeat — proactive check-ins
