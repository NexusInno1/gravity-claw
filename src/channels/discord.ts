/**
 * Discord Channel Adapter
 *
 * Implements the Channel interface for Discord using discord.js.
 * All Discord-specific logic lives here — the rest of the system
 * is completely platform-agnostic.
 *
 * Commands are NOT handled here — they are centralized in
 * src/commands/slash-commands.ts and routed through the message handler.
 */

import { Client, GatewayIntentBits, Message, Partials, Events, TextChannel } from "discord.js";
import { ENV } from "../config.js";
import { chunkMessage, friendlyError } from "./message-utils.js";
import type { Channel, MessageHandler, IncomingMessage } from "./types.js";

const DISCORD_MAX_LENGTH = 2000;

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

        const chunks = chunkMessage(text, DISCORD_MAX_LENGTH);
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

            // Only allow configured users (string comparison — safe for 64-bit snowflakes)
            const isAllowed = ENV.ALLOWED_USER_IDS.has(userIdString);
            if (!isAllowed) {
                console.log(`[Discord] Blocked unauthorized message from user ${userIdString}`);
                return;
            }

            if (!this.handler) return;

            const chatId = message.channelId;
            const text = message.content;

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

                // All commands are handled centrally in slash-commands.ts
                // via the message handler — no command parsing here.
                const result = await this.handler(incoming);

                clearInterval(typingInterval);
                this.typingIntervals.delete(chatId);

                await this.sendText(chatId, result);
            } catch (error) {
                clearInterval(typingInterval);
                this.typingIntervals.delete(chatId);
                console.error("[Discord] Error processing message:", error);
                await this.sendText(chatId, friendlyError(error, "processing your message"));
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
