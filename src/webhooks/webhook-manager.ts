import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { log } from "../logger.js";
import type { Bot } from "grammy";
import { runAgentLoop } from "../agent/loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import { config } from "../config.js";

// ── Webhook Manager ──────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const WEBHOOKS_FILE = join(DATA_DIR, "webhooks.json");

export interface WebhookDef {
  id: string;
  userId: string;
  description: string;
  createdAt: number;
  triggerCount: number;
}

// References set during init
let botRef: Bot | null = null;
let toolRegistryRef: ToolRegistry | null = null;

// ── Persistence ──────────────────────────────────────────

function readWebhooks(): WebhookDef[] {
  if (!existsSync(WEBHOOKS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(WEBHOOKS_FILE, "utf-8")) as WebhookDef[];
  } catch {
    return [];
  }
}

function writeWebhooks(webhooks: WebhookDef[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(WEBHOOKS_FILE, JSON.stringify(webhooks, null, 2), "utf-8");
}

// ── CRUD ─────────────────────────────────────────────────

export function registerWebhook(
  id: string,
  userId: string,
  description: string,
): WebhookDef {
  // Sanitize webhook ID: only lowercase alphanumeric + hyphens, max 50 chars
  const sanitized = id
    .replace(/[^a-z0-9\-]/gi, "")
    .toLowerCase()
    .slice(0, 50);
  if (!sanitized) {
    throw new Error(
      "Invalid webhook ID. Use lowercase letters, numbers, and hyphens only.",
    );
  }

  const webhooks = readWebhooks();

  // Check for duplicate
  if (webhooks.some((w) => w.id === sanitized)) {
    throw new Error(`Webhook "${sanitized}" already exists.`);
  }

  const webhook: WebhookDef = {
    id: sanitized,
    userId,
    description,
    createdAt: Date.now(),
    triggerCount: 0,
  };

  webhooks.push(webhook);
  writeWebhooks(webhooks);

  log.info({ id: sanitized }, "🪝 Webhook created");
  return webhook;
}

export function listWebhooks(userId: string): WebhookDef[] {
  return readWebhooks().filter((w) => w.userId === userId);
}

export function deleteWebhook(id: string): boolean {
  const webhooks = readWebhooks();
  const idx = webhooks.findIndex((w) => w.id === id);
  if (idx === -1) return false;

  webhooks.splice(idx, 1);
  writeWebhooks(webhooks);

  log.info({ id }, "🗑️ Webhook deleted");
  return true;
}

export function getWebhookUrl(id: string): string {
  return `http://localhost:${config.canvasPort}/webhook/${id}`;
}

// ── Webhook Handler ──────────────────────────────────────

/**
 * Handle an incoming webhook POST request.
 * Runs the payload through the agent loop and sends the result to Telegram.
 */
export async function handleWebhookTrigger(
  webhookId: string,
  payload: unknown,
): Promise<{ ok: boolean; message: string }> {
  const webhooks = readWebhooks();
  const webhook = webhooks.find((w) => w.id === webhookId);

  if (!webhook) {
    return { ok: false, message: `Webhook "${webhookId}" not found.` };
  }

  if (!botRef || !toolRegistryRef) {
    return { ok: false, message: "Bot not initialised." };
  }

  // Increment trigger count
  webhook.triggerCount++;
  writeWebhooks(webhooks);

  log.info(
    { id: webhook.id, triggerCount: webhook.triggerCount },
    "🪝 Webhook triggered",
  );

  // Build a prompt from the webhook payload
  const payloadStr =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

  const prompt = `A webhook "${webhook.description}" (ID: ${webhookId}) was just triggered. Here's the incoming payload:\n\n\`\`\`json\n${payloadStr.slice(0, 2000)}\n\`\`\`\n\nProcess this webhook data and provide a relevant summary or take appropriate action.`;

  try {
    const result = await runAgentLoop(prompt, toolRegistryRef, webhook.userId);

    // Send to Telegram
    const userId = parseInt(webhook.userId, 10);
    const message = `🪝 *Webhook: ${webhook.description}*\n\n${result.response}`;
    await botRef.api
      .sendMessage(userId, message, { parse_mode: "Markdown" })
      .catch(() => botRef!.api.sendMessage(userId, message));

    return { ok: true, message: "Webhook processed successfully." };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(err, "❌ Webhook processing failed");
    return { ok: false, message: errMsg };
  }
}

// ── Init ─────────────────────────────────────────────────

export function initWebhookManager(bot: Bot, toolRegistry: ToolRegistry): void {
  botRef = bot;
  toolRegistryRef = toolRegistry;

  const webhooks = readWebhooks();
  if (webhooks.length > 0) {
    log.info({ count: webhooks.length }, "🪝 Webhooks loaded");
  }
}
