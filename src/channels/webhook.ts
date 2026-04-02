/**
 * Webhook Trigger — HTTP endpoint for external event notifications.
 *
 * Starts a lightweight Express-free HTTP server that receives POST
 * requests and forwards the payload as a Telegram message.
 *
 * Usage:
 *   POST http://your-server:PORT/webhook
 *   Headers: Authorization: Bearer YOUR_WEBHOOK_SECRET
 *   Body: { "message": "Deployment complete ✅" }
 *
 * This lets Gravity Claw act as a notification hub for:
 *   - CI/CD events (GitHub Actions, Vercel deployments)
 *   - Server monitoring alerts
 *   - Home automation triggers
 *   - Cron job completions
 *   - Anything that can make an HTTP request
 *
 * Security:
 *   - Auth via Authorization header (not query string — avoids logging leaks)
 *   - Body size capped at 64 KB to prevent DoS
 *   - No external dependencies — uses Node's built-in http module
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { Bot } from "grammy";

// ─── Types ────────────────────────────────────────────────────────

interface WebhookPayload {
    /** The message to send to Telegram */
    message: string;
    /** Optional title/source label */
    source?: string;
}

interface WebhookConfig {
    /** Port to listen on */
    port: number;
    /** Secret token for authentication */
    token: string;
    /** Telegram chat ID to send notifications to */
    chatId: string;
    /** Grammy bot instance for sending messages */
    bot: Bot;
}

// ─── Server ───────────────────────────────────────────────────────

const MAX_BODY_BYTES = 64 * 1024; // 64 KB

let server: ReturnType<typeof createServer> | null = null;

/**
 * Start the webhook HTTP server.
 * Call this after Telegram is connected.
 */
export function startWebhookServer(config: WebhookConfig): void {
    const { port, token, chatId, bot } = config;

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // Only accept POST /webhook
        const url = new URL(req.url || "/", `http://localhost:${port}`);

        if (url.pathname !== "/webhook" || req.method !== "POST") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found. Use POST /webhook" }));
            return;
        }

        // Validate token via Authorization header (secure — not in URL/logs)
        // Supports both "Bearer TOKEN" and plain "TOKEN" formats
        const authHeader = req.headers["authorization"] || "";
        const reqToken = authHeader.replace(/^Bearer\s+/i, "").trim();

        // Also accept legacy query string token for backwards compatibility
        const queryToken = url.searchParams.get("token") || "";

        if (reqToken !== token && queryToken !== token) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid or missing token. Use Authorization: Bearer <token> header." }));
            return;
        }

        // Parse body with size limit
        try {
            const body = await readBody(req, MAX_BODY_BYTES);
            const payload: WebhookPayload = JSON.parse(body);

            if (!payload.message) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Missing 'message' in body" }));
                return;
            }

            // Build notification
            const source = payload.source ? `<b>${payload.source}</b>` : "<b>Webhook</b>";
            const notification = `🔔 ${source}\n\n${payload.message}`;

            // Send to Telegram with HTML parsing
            try {
                await bot.api.sendMessage(chatId, notification, { parse_mode: "HTML" });
            } catch {
                // HTML parsing failed — send plain text
                const plain = notification.replace(/<[^>]+>/g, "");
                await bot.api.sendMessage(chatId, plain);
            }

            console.log(
                `[Webhook] Received from ${payload.source || "unknown"}: ${payload.message.substring(0, 80)}`,
            );

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, sent: true }));
        } catch (err) {
            if ((err as Error).message === "Body too large") {
                res.writeHead(413, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Payload too large (max 64 KB)" }));
                return;
            }

            console.error("[Webhook] Error processing request:", err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
        }
    });

    server.listen(port, () => {
        console.log(`[Webhook] Listening on port ${port} — POST /webhook (Authorization: Bearer ****)`);
    });
}

/**
 * Stop the webhook server gracefully.
 */
export function stopWebhookServer(): void {
    if (server) {
        server.close();
        server = null;
        console.log("[Webhook] Server stopped.");
    }
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Read the request body with a byte size limit to prevent DoS.
 * Rejects with "Body too large" if the limit is exceeded.
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
                req.destroy();
                reject(new Error("Body too large"));
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}
