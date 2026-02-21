# 🦞 OpenClaw — Research Summary

> **Purpose**: Familiarization with the OpenClaw project to inform the design of **Gravity Claw**.

## What is OpenClaw?

OpenClaw (formerly ClawdBot → Moltbot) is an **open-source, local-first personal AI assistant** created by Peter Steinberger. It runs on your own machine and connects to messaging apps you already use, turning an LLM into an autonomous agent that can _act_ on your behalf — not just chat.

- **License**: MIT
- **Tech Stack**: Node.js / TypeScript
- **100K+ GitHub stars** within a week of launch (Jan 2026)
- **Tagline**: _"EXFOLIATE! EXFOLIATE!"_ 🦞

---

## Architecture at a Glance

```
WhatsApp / Telegram / Slack / Discord / Signal / iMessage / Teams / WebChat
                             │
                             ▼
              ┌───────────────────────────────┐
              │           Gateway              │
              │       (control plane)          │
              │    ws://127.0.0.1:18789        │
              └──────────────┬────────────────┘
                             │
                 ├─ Pi agent (RPC)      ← LLM-powered reasoning core
                 ├─ CLI (openclaw …)    ← terminal interface
                 ├─ WebChat UI          ← browser dashboard
                 ├─ macOS app           ← menu bar companion
                 └─ iOS / Android nodes ← mobile extensions
```

### Core Concepts

| Concept      | Description                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| **Gateway**  | Local WebSocket control plane — routes messages, manages sessions, hosts tools & events                        |
| **Channels** | Adapters for each messaging platform (WhatsApp via Baileys, Telegram via grammY, Discord via discord.js, etc.) |
| **Pi Agent** | The LLM reasoning core running in RPC mode with tool streaming                                                 |
| **Sessions** | Isolated per-chat contexts — `main` for direct chats, separate for groups                                      |
| **Tools**    | Capabilities the agent can invoke: `bash`, `browser`, `read`, `write`, `edit`, `cron`, etc.                    |
| **Skills**   | Markdown-defined instruction sets that teach the agent how to combine tools for specific tasks                 |
| **Nodes**    | Companion device extensions (iOS, Android, macOS) providing camera, screen, location, voice                    |

---

## Key Subsystems

### 1. Multi-Channel Gateway

- Single WebSocket control plane for all messaging channels
- Channel adapters standardize input/output across platforms
- Multi-agent routing: route different channels/senders to isolated agent workspaces
- DM pairing security: unknown senders must be approved

### 2. Heartbeat Scheduler (Autonomous Behavior)

- Configurable cron-like wakeups (e.g., every 30 minutes)
- Reads a `HEARTBEAT.md` checklist of proactive tasks
- Two-tier approach: cheap checks first, LLM engagement only when needed
- Enables: daily briefings, website monitoring, calendar conflict detection

### 3. Memory System

- **File-based**: conversations, long-term facts, and preferences stored in local Markdown/YAML
- **SQLite vector store**: for semantic search across memory
- Two-layer: file logs + vector embeddings
- Fully inspectable and backup-friendly

### 4. Workspace & Skills

- Workspace root: `~/.openclaw/workspace`
- Injected prompt files: `AGENTS.md`, `SOUL.md`, `TOOLS.md`
- Skills live at: `~/.openclaw/workspace/skills/<skill>/SKILL.md`
- **ClawHub**: public registry of community-built skills (thousands available)
- Skills can be created conversationally: _"store this as a skill"_

### 5. Tool Layer

- **Shell execution** (`exec`/`bash`)
- **Browser control** — dedicated Chrome/Chromium with CDP
- **File operations** — read, write, edit
- **Canvas** — agent-driven visual workspace (A2UI)
- **Cron + webhooks** — scheduled and event-driven automation
- **Gmail Pub/Sub** — email event hooks

### 6. Voice & Media

- **Voice Wake** + **Talk Mode** — always-on speech (macOS/iOS/Android) via ElevenLabs
- **Media pipeline** — images, audio, video with transcription hooks

---

## Configuration

Minimal config (`~/.openclaw/openclaw.json`):

```json
{
  "agent": {
    "model": "anthropic/claude-opus-4-6"
  }
}
```

- Model-agnostic: Anthropic, OpenAI, Google, Ollama, LM Studio
- Model failover & auth profile rotation supported
- Security sandbox modes for non-main sessions (Docker-based)

---

## Design Principles Worth Adopting for Gravity Claw

1. **Local-first** — data stays on the user's machine, fully inspectable
2. **Channel-agnostic** — one core agent, many frontends
3. **File-based memory** — Markdown/YAML for transparency, easy backup
4. **Skill extensibility** — portable Markdown instruction format
5. **Autonomous heartbeat** — proactive behavior, not just reactive chat
6. **ReAct loop** — reason → act → observe → repeat
7. **Security by default** — DM pairing, sandbox modes, tool allowlists
8. **Conversation-first** — configure via natural language, not config files

---

## What Makes Gravity Claw Different?

This is where we'll define **our own identity**. Gravity Claw will be _inspired by_ OpenClaw but tailored to your specific needs and priorities. Key decisions to make:

- Which **channels** to support first?
- Which **LLM provider(s)** to target?
- What **skills/automations** are most important to you?
- Should we prioritize **voice**, **browser automation**, **code assistance**, or something else?
- What **personality/soul** should Gravity Claw have?

> [!NOTE]
> This research document captures the OpenClaw project as of Feb 2026. The project is moving to an open-source foundation as its creator joins OpenAI.
