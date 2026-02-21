import { getPineconeClient } from "./pinecone.js";

// ── Embedder — Pinecone Inference (FREE) ─────────────────

/**
 * Convert `text` into a 1024-dimensional embedding vector using
 * Pinecone's built-in inference API (multilingual-e5-large).
 *
 * No OpenAI key required — this is included free with your Pinecone account.
 */
export async function embed(text: string): Promise<number[]> {
  const pc = getPineconeClient();

  const result = await pc.inference.embed({
    model: "multilingual-e5-large",
    inputs: [text.slice(0, 2000)], // safety trim
    parameters: {
      inputType: "passage",
      truncate: "END",
    },
  });

  // result.data is an array of embeddings, one per input
  const embedding = result.data?.[0];
  if (!embedding || !("values" in embedding) || !embedding.values) {
    throw new Error("Pinecone inference returned no embedding");
  }
  return embedding.values as number[];
}
