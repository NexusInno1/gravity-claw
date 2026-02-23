import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "../config.js";
import { log } from "../logger.js";

// ── Canvas Server — HTTP + WebSocket ─────────────────────

/** Canvas payload sent to connected clients. */
export interface CanvasPayload {
  id: string;
  type: "chart" | "table" | "html" | "form" | "markdown";
  title: string;
  content: unknown;
  timestamp: number;
}

const clients = new Set<WebSocket>();
let canvasHistory: CanvasPayload[] = [];

// Webhook handler — set by initWebhookRoutes
let webhookHandler:
  | ((
      id: string,
      payload: unknown,
    ) => Promise<{ ok: boolean; message: string }>)
  | null = null;

/** Register the webhook handler for incoming POSTs. */
export function setWebhookHandler(
  handler: (
    id: string,
    payload: unknown,
  ) => Promise<{ ok: boolean; message: string }>,
): void {
  webhookHandler = handler;
}

// ── Load the HTML canvas page ────────────────────────────

const PUBLIC_DIR = join(
  import.meta.dirname ?? process.cwd(),
  "canvas",
  "public",
);

function serveCanvasPage(_req: IncomingMessage, res: ServerResponse): void {
  try {
    const html = readFileSync(join(PUBLIC_DIR, "index.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Canvas page not found");
  }
}

// ── Helper: read POST body ───────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ── HTTP Server ──────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || "/";

  if (url === "/" || url === "/index.html") {
    serveCanvasPage(req, res);
  } else if (url === "/api/history") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(canvasHistory));
  } else if (url === "/api/clear" && req.method === "POST") {
    canvasHistory = [];
    broadcast({ type: "clear" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else if (url.startsWith("/webhook/") && req.method === "POST") {
    // ── Webhook route ──────────────────────────────────
    const webhookId = url.replace("/webhook/", "").split("?")[0]!;

    if (!webhookHandler) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Webhook system not initialised" }));
      return;
    }

    try {
      const body = await readBody(req);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = body; // treat as plain text
      }

      const result = await webhookHandler(webhookId, payload);
      res.writeHead(result.ok ? 200 : 404, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// ── WebSocket Server ─────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  clients.add(ws);
  log.info({ clients: clients.size }, "🖼️  Canvas client connected");

  // Send existing canvas history to new clients
  if (canvasHistory.length > 0) {
    ws.send(JSON.stringify({ type: "history", items: canvasHistory }));
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "form_submit") {
        log.info({ data: msg.data }, "📋 Form submitted from canvas");
        // Could feed this back into the bot/agent loop in the future
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    log.info({ clients: clients.size }, "🖼️  Canvas client disconnected");
  });
});

// ── Broadcast to all clients ─────────────────────────────

function broadcast(payload: unknown): void {
  const json = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(json);
    }
  }
}

/**
 * Push a canvas widget to all connected clients.
 * Called by the push_canvas tool.
 */
export function broadcastCanvas(payload: CanvasPayload): void {
  canvasHistory.push(payload);
  // Keep max 50 items in history
  if (canvasHistory.length > 50) {
    canvasHistory = canvasHistory.slice(-50);
  }
  broadcast({ type: "canvas", item: payload });
}

/** Get the number of connected canvas clients. */
export function getCanvasClientCount(): number {
  return clients.size;
}

// ── Start ────────────────────────────────────────────────

export function startCanvasServer(): void {
  httpServer.listen(config.canvasPort, () => {
    log.info({ port: config.canvasPort }, "🖼️  Live Canvas running");
  });
}
