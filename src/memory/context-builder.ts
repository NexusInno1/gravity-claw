import type { MemoryContext } from "./types.js";

// ── Context Builder — assemble the enriched system prompt ─

/**
 * Builds additional context blocks to prepend to the conversation.
 * Returns an array of ChatCompletionMessageParam-compatible objects
 * that should be injected between the system prompt and the user message.
 */
export function buildMemoryContext(ctx: MemoryContext): string {
  const parts: string[] = [];

  // Layer 3 — facts block
  const factEntries = Object.entries(ctx.facts);
  if (factEntries.length > 0) {
    const factLines = factEntries.map(([k, v]) => `• ${k}: ${v}`).join("\n");
    parts.push(`📋 KNOWN FACTS ABOUT THE USER:\n${factLines}`);
  }

  // Layer 2 — semantic memories (sorted oldest → newest)
  if (ctx.semanticMatches.length > 0) {
    const sorted = [...ctx.semanticMatches].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    const lines = sorted.map((m) => {
      const ago = formatAgo(m.timestamp);
      const prefix = m.role === "user" ? "User said" : "You replied";
      return `• [${ago}] ${prefix}: "${m.content.slice(0, 200)}"`;
    });
    parts.push(
      `🧠 RELEVANT MEMORIES (retrieved semantically):\n${lines.join("\n")}`,
    );
  }

  return parts.join("\n\n");
}

/** Format a Unix ms timestamp as a human-readable "X ago" string. */
function formatAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.floor(diffDay / 30);
  return `${diffMo}mo ago`;
}
