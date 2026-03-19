import { Client, GatewayIntentBits, Message, Partials, Events, TextChannel } from "discord.js";
import { ENV } from "../config.js";
import { clearChatHistory, getMessageCount, compactChatHistory } from "../memory/buffer.js";
import {
    getHeartbeatStatus,
    updateHeartbeatTime,
} from "../heartbeat/scheduler.js";
import {
    resetSessionStats,
    formatSessionStatus,
} from "../commands/session-stats.js";
import type { Channel, MessageHandler, IncomingMessage } from "./types.js";

const DISCORD_MAX_LENGTH = 2000;

/**
 * Split a long message into chunks that fit Discord's 2000 char limit.
 */
function chunkMessage(text: string): string[] {
    if (text.length <= DISCORD_MAX_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= DISCORD_MAX_LENGTH) {
            chunks.push(remaining);
            break;
        }

        let splitAt = remaining.lastIndexOf("\n\n", DISCORD_MAX_LENGTH);
        if (splitAt < DISCORD_MAX_LENGTH * 0.3) {
            splitAt = remaining.lastIndexOf("\n", DISCORD_MAX_LENGTH);
        }
        if (splitAt < DISCORD_MAX_LENGTH * 0.3) {
            splitAt = remaining.lastIndexOf(". ", DISCORD_MAX_LENGTH);
            if (splitAt > 0) splitAt += 1;
        }
        if (splitAt < DISCORD_MAX_LENGTH * 0.3) {
            splitAt = DISCORD_MAX_LENGTH;
        }

        chunks.push(remaining.substring(0, splitAt).trimEnd());
        remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
}

export class DiscordChannel implements Channel {
    readonly name = "Discord";
    private client: Client;
    private handler: MessageHandler | null = null;
    private typingIntervals: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
            ],
            partials: [Partials.Channel],
        });
    }

    onMessage(handler: MessageHandler): void {
        this.handler = handler;
    }

    async sendText(chatId: string, text: string): Promise<void> {
        const channel = await this.client.channels.fetch(chatId);
        if (!channel || !channel.isTextBased() || !('send' in channel)) return;

        const chunks = chunkMessage(text);
        for (const chunk of chunks) {
            await (channel as unknown as TextChannel).send(chunk);
        }
    }

    async sendTyping(chatId: string): Promise<void> {
        const channel = await this.client.channels.fetch(chatId);
        if (channel?.isTextBased() && 'sendTyping' in channel) {
            await (channel as TextChannel).sendTyping();
        }
    }

    async start(): Promise<void> {
        if (!ENV.DISCORD_BOT_TOKEN) {
            throw new Error("DISCORD_BOT_TOKEN is not defined");
        }

        this.client.once(Events.ClientReady, (readyClient) => {
            console.log(`[Channel/Discord] Connected as ${readyClient.user.tag}`);
        });

        this.client.on(Events.MessageCreate, async (message: Message) => {
            if (message.author.bot) return;

            const userIdString = message.author.id;

            // Only allow configured users
            const isAllowed = Array.from(ENV.ALLOWED_USER_IDS).some(id => id.toString() === userIdString);
            if (!isAllowed) {
                console.log(`[Discord] Blocked unauthorized message from user ${userIdString}`);
                return;
            }

            if (!this.handler) return;

            const chatId = message.channelId;
            const text = message.content;

            // ── Commands ─────────────────────────────────────────────

            // /start — clear conversation history and start fresh
            if (text.trim() === "/start") {
                console.log(`[Discord] /start command from ${userIdString} — clearing history.`);
                await this.sendTyping(chatId);
                try {
                    await clearChatHistory(chatId);
                    resetSessionStats(chatId);
                    await this.sendText(chatId, "🔄 History cleared. Fresh session started.\n\nHow can I help you today?");
                } catch (error) {
                    console.error("[Discord] /start error:", error);
                    await this.sendText(chatId, "System error while clearing history. Check logs.");
                }
                return;
            }

            // /new or /reset — clear conversation history and reset stats
            if (text.trim() === "/new" || text.trim() === "/reset") {
                console.log(`[Discord] /reset command from ${userIdString} — clearing history.`);
                await this.sendTyping(chatId);
                try {
                    await clearChatHistory(chatId);
                    resetSessionStats(chatId);
                    await this.sendText(chatId, "🔄 History cleared and session reset.\n\nHow can I help you today?");
                } catch (error) {
                    console.error("[Discord] /reset error:", error);
                    await this.sendText(chatId, "System error while clearing history. Check logs.");
                }
                return;
            }

            // /status — display session token consumption and stats
            if (text.trim() === "/status") {
                console.log(`[Discord] /status command from ${userIdString}`);
                await this.sendTyping(chatId);
                try {
                    const messageCount = await getMessageCount(chatId);
                    const statusText = formatSessionStatus(chatId, messageCount);
                    await this.sendText(chatId, statusText);
                } catch (error) {
                    console.error("[Discord] /status error:", error);
                    await this.sendText(chatId, "System error while fetching status. Check logs.");
                }
                return;
            }

            // /compact — summarize conversation history to reduce tokens
            if (text.trim() === "/compact") {
                console.log(`[Discord] /compact command from ${userIdString} — compacting history.`);
                await this.sendTyping(chatId);
                try {
                    const result = await compactChatHistory(chatId);
                    await this.sendText(chatId, result);
                } catch (error) {
                    console.error("[Discord] /compact error:", error);
                    await this.sendText(chatId, "System error during compaction. Check logs.");
                }
                return;
            }

            // /heartbeat — show current heartbeat status
            if (text.trim() === "/heartbeat") {
                const status = getHeartbeatStatus();
                await this.sendText(chatId, status);
                return;
            }

            // /personas — list all available personas
            if (text.trim() === "/personas") {
                try {
                    // @ts-ignore — persona module is optional and may not exist yet
                    const { getAllPersonas, getActivePersonaId } = await import("../persona/manager.js");
                    const personas = getAllPersonas();
                    const activeId = getActivePersonaId();

                    const lines = ["**🎭 Available Personas**\n"];
                    for (const p of personas) {
                        const check = p.id === activeId ? "✅" : "▫️";
                        lines.push(`${check} **${p.id}** — _${p.description || "No description"}_`);
                    }
                    lines.push("\nUse `/persona <id>` to switch.");
                    await this.sendText(chatId, lines.join("\n"));
                } catch {
                    await this.sendText(chatId, "Persona system is not available.");
                }
                return;
            }

            // /persona <id> — switch active persona
            const personaSetMatch = text.trim().match(/^\/persona\s+(.+)$/);
            if (text.startsWith("/persona ") || text.trim() === "/persona") {
                if (!personaSetMatch) {
                    await this.sendText(chatId, "Usage: `/persona <id>`\nSee `/personas` for a list.");
                    return;
                }
                try {
                    // @ts-ignore — persona module is optional and may not exist yet
                    const { setActivePersona } = await import("../persona/manager.js");
                    setActivePersona(personaSetMatch[1].trim());
                    await this.sendText(chatId, `🎭 Persona switched to **${personaSetMatch[1].trim()}**.`);
                } catch (err) {
                    await this.sendText(chatId, `❌ ${String(err)}`);
                }
                return;
            }

            // /heartbeat_set HH:MM — change the morning check-in time
            const hbSetMatch = text.trim().match(/^\/heartbeat_set\s+(\d{1,2}):(\d{2})$/);
            if (text.startsWith("/heartbeat_set")) {
                if (!hbSetMatch) {
                    await this.sendText(chatId, "Invalid format. Use HH:MM (24-hour IST).\nExample: /heartbeat_set 09:30");
                    return;
                }
                const hour = parseInt(hbSetMatch[1], 10);
                const minute = parseInt(hbSetMatch[2], 10);
                if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
                    await this.sendText(chatId, "Invalid time. Hour: 0-23, Minute: 0-59.");
                    return;
                }

                const updated = updateHeartbeatTime("Morning Check-in", hour, minute);
                if (updated) {
                    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
                    await this.sendText(chatId, `✅ Morning check-in updated to **${timeStr} IST**.`);
                } else {
                    await this.sendText(chatId, "Could not find the Morning Check-in job.");
                }
                return;
            }

            // ── Regular message → agent loop ──────────────────────────

            console.log(`[Discord] Received message from ${userIdString}: ${text}`);

            // Setup typing indicator loop
            await this.sendTyping(chatId);
            const typingInterval = setInterval(() => {
                this.sendTyping(chatId).catch(() => { });
            }, 9000);
            this.typingIntervals.set(chatId, typingInterval);

            try {
                let imageBase64: string | undefined;
                let imageMimeType: string | undefined;

                // Check for image attachments
                const attachment = message.attachments.find(a => a.contentType?.startsWith('image/'));
                if (attachment) {
                    const response = await fetch(attachment.url);
                    if (response.ok) {
                        const buffer = Buffer.from(await response.arrayBuffer());
                        imageBase64 = buffer.toString("base64");
                        imageMimeType = attachment.contentType || "image/jpeg";
                    }
                }

                const incoming: IncomingMessage = {
                    chatId,
                    userId: userIdString,
                    text: text,
                    imageBase64,
                    imageMimeType,
                };

                const result = await this.handler(incoming);

                clearInterval(typingInterval);
                this.typingIntervals.delete(chatId);

                await this.sendText(chatId, result);
            } catch (error) {
                clearInterval(typingInterval);
                this.typingIntervals.delete(chatId);
                console.error("[Discord] Error processing message:", error);
                await this.sendText(chatId, "System error occurred. Check logs.");
            }
        });

        await this.client.login(ENV.DISCORD_BOT_TOKEN);
    }

    stop(): void {
        for (const interval of this.typingIntervals.values()) {
            clearInterval(interval);
        }
        this.typingIntervals.clear();
        this.client.destroy();
        console.log("[Channel/Discord] Stopped.");
    }
}
