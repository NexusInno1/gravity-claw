import { getPineconeIndex } from "./pinecone.js";
import type { StoredMessage } from "./types.js";

// ── Pinecone Message Store (Layer 2) ─────────────────────

/**
 * Upsert a single message as a vector record in Pinecone.
 * Pinecone SDK v5: upsert takes { records: [...] }
 */
export async function saveMessage(
  userId: string,
  role: "user" | "assistant",
  content: string,
  embedding: number[],
  timestamp: number,
): Promise<void> {
  const index = getPineconeIndex();
  const id = `${userId}-${timestamp}-${role}`;
  await index.upsert({
    records: [
      {
        id,
        values: embedding,
        metadata: {
          userId,
          role,
          content: content.slice(0, 1000), // Pinecone metadata capped at 40KB total
          timestamp,
        },
      },
    ],
  });
}

/**
 * Find the top-k most semantically relevant past messages for a user.
 * Filters to the current user only via metadata filter.
 */
export async function searchMessages(
  userId: string,
  queryEmbedding: number[],
  topK: number,
): Promise<StoredMessage[]> {
  const index = getPineconeIndex();

  const result = await index.query({
    vector: queryEmbedding,
    topK,
    filter: { userId: { $eq: userId } },
    includeMetadata: true,
  });

  return (result.matches ?? [])
    .filter((m) => m.metadata)
    .map((m) => ({
      role: m.metadata!["role"] as "user" | "assistant",
      content: String(m.metadata!["content"] ?? ""),
      timestamp: Number(m.metadata!["timestamp"] ?? 0),
      score: m.score ?? 0,
    }));
}
