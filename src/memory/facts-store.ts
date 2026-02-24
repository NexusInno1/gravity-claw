import { getPineconeIndex } from "./pinecone.js";
import { log } from "../logger.js";

// ── Facts Store — Layer 3 (Pinecone-backed) ──────────────

/** Embedding dimension must match the index (multilingual-e5-large = 1024) */
const ZERO_VECTOR = new Array(1024).fill(0);

/** Build a deterministic Pinecone record ID for a user's facts. */
function factsId(userId: string): string {
  return `facts-${userId}`;
}

/**
 * In-memory cache so we don't hit Pinecone on every call.
 * Populated on first read, updated on every write.
 */
const cache = new Map<string, Record<string, string>>();

/** Insert or update a fact for a user. Writes to Pinecone + cache. */
export function upsertFact(userId: string, key: string, value: string): void {
  const current = cache.get(userId) ?? {};
  current[key] = value;
  cache.set(userId, current);

  // Async Pinecone write (don't block the caller)
  void writeFacts(userId, current);
}

/** Retrieve all known facts for a user. Returns empty object if none. */
export function getFacts(userId: string): Record<string, string> {
  return cache.get(userId) ?? {};
}

/** Delete all facts for a user. */
export function clearFacts(userId: string): void {
  cache.delete(userId);
  const index = getPineconeIndex();
  void index.deleteOne({ id: factsId(userId) }).catch((err: unknown) => {
    log.warn(err, "⚠️ Failed to delete facts from Pinecone");
  });
}

// ── Pinecone I/O ─────────────────────────────────────────

/**
 * Load facts from Pinecone into the in-memory cache.
 * Called once at startup for a given userId.
 */
export async function loadFacts(userId: string): Promise<void> {
  try {
    const index = getPineconeIndex();
    const result = await index.fetch({ ids: [factsId(userId)] });
    const record = result.records?.[factsId(userId)];

    if (record?.metadata) {
      // Extract facts from metadata (skip internal keys)
      const facts: Record<string, string> = {};
      for (const [k, v] of Object.entries(record.metadata)) {
        if (k !== "_type" && k !== "userId" && typeof v === "string") {
          facts[k] = v;
        }
      }
      if (Object.keys(facts).length > 0) {
        cache.set(userId, facts);
        log.info(
          { userId, factCount: Object.keys(facts).length },
          "📦 Facts loaded from Pinecone",
        );
      }
    }
  } catch (err) {
    log.warn(err, "⚠️ Failed to load facts from Pinecone");
  }
}

/** Write the full facts object to Pinecone as metadata on a zero-vector record. */
async function writeFacts(
  userId: string,
  facts: Record<string, string>,
): Promise<void> {
  try {
    const index = getPineconeIndex();
    await index.upsert({
      records: [
        {
          id: factsId(userId),
          values: ZERO_VECTOR,
          metadata: {
            _type: "facts",
            userId,
            ...facts,
          },
        },
      ],
    });
  } catch (err) {
    log.warn(err, "⚠️ Failed to save facts to Pinecone");
  }
}
