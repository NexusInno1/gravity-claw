import type { StoredMessage, MemoryContext } from "./types.js";
import { embed } from "./embedder.js";
import { saveMessage, searchMessages } from "./store.js";
import { getFacts, upsertFact } from "./facts-store.js";
import { llm } from "../llm/claude.js";
import { config } from "../config.js";
import { log } from "../logger.js";

// ── MemoryManager — 3-Layer Orchestrator ─────────────────

/** Max messages to keep in session buffer before auto-trimming */
const MAX_BUFFER_SIZE = 50;

/** Per-user in-process message buffer (Layer 1) */
const sessionBuffers = new Map<string, StoredMessage[]>();

export const memoryManager = {
  // ── Layer 1: session buffer ────────────────────────────

  getBuffer(userId: string): StoredMessage[] {
    if (!sessionBuffers.has(userId)) sessionBuffers.set(userId, []);
    return sessionBuffers.get(userId)!;
  },

  clearSession(userId: string): void {
    sessionBuffers.set(userId, []);
  },

  // ── Main: build context before calling the LLM ─────────

  async getContext(
    userId: string,
    newUserMessage: string,
  ): Promise<MemoryContext> {
    const recentMessages = this.getBuffer(userId).slice(
      -config.memoryContextMessages,
    );

    // Semantic search in Pinecone (Layer 2)
    let semanticMatches: StoredMessage[] = [];
    try {
      const queryEmbedding = await embed(newUserMessage);
      const raw = await searchMessages(
        userId,
        queryEmbedding,
        config.memorySemanticMatches + 5, // fetch a few extra to de-dupe
      );

      // De-duplicate: exclude messages already in the recent buffer
      const recentContents = new Set(recentMessages.map((m) => m.content));
      semanticMatches = raw
        .filter((m) => !recentContents.has(m.content) && (m.score ?? 0) > 0.75)
        .slice(0, config.memorySemanticMatches);
    } catch (err) {
      log.warn(err, "⚠️ Pinecone search failed");
    }

    // Structured facts (Layer 3)
    const facts = getFacts(userId);

    return { recentMessages, semanticMatches, facts };
  },

  // ── Main: save exchange after the LLM responds ─────────

  async saveExchange(
    userId: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    const now = Date.now();

    const userEntry: StoredMessage = {
      role: "user",
      content: userMessage,
      timestamp: now,
    };
    const assistantEntry: StoredMessage = {
      role: "assistant",
      content: assistantMessage,
      timestamp: now + 1,
    };

    // Layer 1 — update in-process buffer
    const buf = this.getBuffer(userId);
    buf.push(userEntry, assistantEntry);

    // Auto-trim: keep only the most recent messages
    if (buf.length > MAX_BUFFER_SIZE) {
      buf.splice(0, buf.length - MAX_BUFFER_SIZE);
    }

    // Layer 2 — async Pinecone upsert & Layer 3 fact extraction (don't block response)
    void (async () => {
      try {
        const [userEmb, assistantEmb] = await Promise.all([
          embed(userMessage),
          embed(assistantMessage),
        ]);
        await Promise.all([
          saveMessage(userId, "user", userMessage, userEmb, now),
          saveMessage(
            userId,
            "assistant",
            assistantMessage,
            assistantEmb,
            now + 1,
          ),
        ]);
      } catch (err) {
        log.warn(err, "⚠️ Pinecone save failed");
      }

      // Background fact extraction — runs every 4 messages
      if (buf.length % 4 === 0) {
        void this.extractAndSaveFacts(userId, buf.slice(-8));
      }
    })();
  },

  // ── Fact extraction using the LLM ──────────────────────

  async extractAndSaveFacts(
    userId: string,
    recentMessages: StoredMessage[],
  ): Promise<void> {
    if (recentMessages.length === 0) return;

    const transcript = recentMessages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    try {
      const response = await llm.chat.completions.create({
        model: config.llmModel,
        max_tokens: 256,
        messages: [
          {
            role: "system",
            content:
              "Extract key facts about the USER from this conversation snippet. " +
              "Only include things that are definitively stated (name, occupation, preferences, ongoing projects, relationships). " +
              "Return a JSON object with lowercase_snake_case keys and string values. " +
              "Return {} if nothing notable. Never invent information.",
          },
          { role: "user", content: transcript },
        ],
      });

      const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
      // Strip markdown code fences if present
      const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      const facts = JSON.parse(json) as Record<string, string>;

      for (const [key, value] of Object.entries(facts)) {
        if (typeof value === "string" && value.trim()) {
          upsertFact(userId, key, value.trim());
        }
      }
    } catch (err) {
      log.warn(err, "⚠️ Fact extraction failed");
    }
  },

  // ── /compact — summarise buffer → Pinecone ─────────────

  async compactSession(userId: string): Promise<void> {
    const buf = this.getBuffer(userId);
    if (buf.length === 0) return;

    const transcript = buf
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    try {
      const response = await llm.chat.completions.create({
        model: config.llmModel,
        max_tokens: 512,
        messages: [
          {
            role: "system",
            content:
              "Write a concise, information-dense summary of this conversation. " +
              "Focus on decisions made, information shared, tasks discussed, and any user preferences revealed. " +
              "Write in third person past tense.",
          },
          { role: "user", content: transcript },
        ],
      });

      const summary = response.choices[0]?.message?.content?.trim() ?? "";
      if (summary) {
        const embedding = await embed(summary);
        await saveMessage(
          userId,
          "assistant",
          `[SUMMARY] ${summary}`,
          embedding,
          Date.now(),
        );
      }
    } catch (err) {
      log.warn(err, "⚠️ Compact/summarise failed");
      throw err; // re-throw so bot can report to user
    }

    // Clear the buffer after successful compaction
    this.clearSession(userId);
  },
};
