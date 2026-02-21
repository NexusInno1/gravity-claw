// ── Memory Module — Shared Types ─────────────────────────

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number; // Unix ms
  score?: number; // cosine similarity score (from semantic search)
}

export interface MemoryContext {
  /** Recent messages from the in-process buffer (Layer 1) */
  recentMessages: StoredMessage[];
  /** Semantically relevant past messages from Pinecone (Layer 2) */
  semanticMatches: StoredMessage[];
  /** Structured key-value facts about the user (Layer 3) */
  facts: Record<string, string>;
}
