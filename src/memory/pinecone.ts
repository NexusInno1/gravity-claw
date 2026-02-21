import { Pinecone } from "@pinecone-database/pinecone";
import { config } from "../config.js";

// ── Pinecone Client ───────────────────────────────────────

let _pc: Pinecone | null = null;
let _index: ReturnType<Pinecone["index"]> | null = null;

/** Get the shared Pinecone client instance. */
export function getPineconeClient(): Pinecone {
  if (!_pc) {
    _pc = new Pinecone({ apiKey: config.pineconeApiKey });
  }
  return _pc;
}

/** Get the Pinecone index for vector operations. */
export function getPineconeIndex() {
  if (!_index) {
    _index = getPineconeClient().index(config.pineconeIndex);
  }
  return _index;
}
