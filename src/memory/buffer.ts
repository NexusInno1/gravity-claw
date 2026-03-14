/**
 * Tier 2 — Conversation Buffer
 *
 * Keeps the last 20 messages verbatim per chat.
 * When buffer overflows, older messages are compacted into a rolling summary.
 * Summary retains decisions, commitments, and unresolved items.
 */

import { getSupabase } from "../lib/supabase.js";
import { setCoreMemory, deleteCoreMemory } from "./core.js";
import { getAI, withRetry } from "../lib/gemini.js";
import { ENV } from "../config.js";

const MAX_BUFFER_SIZE = 20;

interface BufferMessage {
  role: string;
  content: string;
  created_at: string;
}

/**
 * Save a message to the conversation buffer.
 */
export async function saveMessage(
  chatId: string,
  role: "user" | "model",
  content: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb.from("messages").insert({
      chat_id: chatId,
      role,
      content,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[Buffer] Failed to save message:", error.message);
      return;
    }

    // Check if compaction is needed
    await maybeCompact(chatId);
  } catch (err) {
    console.error("[Buffer] Unexpected error:", err);
  }
}

/**
 * Get the most recent messages for a chat.
 */
export async function getRecentMessages(
  chatId: string,
): Promise<BufferMessage[]> {
  const sb = getSupabase();
  if (!sb) return [];

  try {
    const { data, error } = await sb
      .from("messages")
      .select("role, content, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(MAX_BUFFER_SIZE);

    if (error) {
      console.error("[Buffer] Failed to fetch messages:", error.message);
      return [];
    }

    // Reverse so oldest is first (chronological order)
    return (data || []).reverse();
  } catch (err) {
    console.error("[Buffer] Unexpected error:", err);
    return [];
  }
}

/**
 * Compact old messages into a rolling summary when buffer exceeds MAX_BUFFER_SIZE.
 * Preserves decisions, commitments, and unresolved items.
 */
async function maybeCompact(chatId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    // Count total messages for this chat
    const { count, error: countError } = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chatId);

    if (countError || !count || count <= MAX_BUFFER_SIZE + 5) {
      // Only compact when we're 5 over the limit to avoid constant compaction
      return;
    }

    // Fetch the oldest messages that exceed the buffer
    const overflowCount = count - MAX_BUFFER_SIZE;
    const { data: oldMessages, error: fetchError } = await sb
      .from("messages")
      .select("id, role, content")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(overflowCount);

    if (fetchError || !oldMessages || oldMessages.length === 0) return;

    // Build text to summarize
    const transcript = oldMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // Use Gemini to create a structured rolling summary
    const compactionContents = [
      {
        role: "user" as const,
        parts: [
          {
            text: `Summarize this conversation into a structured memory block. Use these sections (skip empty ones):

## Decisions Made
- ...

## Active Projects / Tasks
- ...

## Action Items & Commitments
- ...

## Key Context
- ...

Do NOT include greetings, small talk, or irrelevant chatter. Be concise but preserve all important details.

${transcript}`,
          },
        ],
      },
    ];

    const response = await withRetry(
      () =>
        getAI().models.generateContent({
          model: ENV.GEMINI_MODEL,
          contents: compactionContents,
          config: { temperature: 0.3 },
        }),
      {
        contents: compactionContents,
        systemInstruction: undefined,
        tools: undefined,
        temperature: 0.3,
      },
    );

    const summary =
      response.candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        .map((p) => p.text)
        .join("\n")
        .trim() || "";

    if (summary) {
      // Save rolling summary to core memory
      await setCoreMemory(`rolling_summary_${chatId}`, summary);
      console.log(
        `[Buffer] Compacted ${oldMessages.length} messages into rolling summary.`,
      );
    }

    // Delete the old messages
    const idsToDelete = oldMessages.map((m) => m.id);
    const { error: deleteError } = await sb
      .from("messages")
      .delete()
      .in("id", idsToDelete);

    if (deleteError) {
      console.error(
        "[Buffer] Failed to delete old messages:",
        deleteError.message,
      );
    }
  } catch (err) {
    console.error("[Buffer] Compaction error:", err);
  }
}

/**
 * Clear all conversation history for a chat.
 * Deletes all messages from the buffer and removes the rolling summary.
 */
export async function clearChatHistory(chatId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb.from("messages").delete().eq("chat_id", chatId);

    if (error) {
      console.error("[Buffer] Failed to clear history:", error.message);
    } else {
      console.log(`[Buffer] Cleared all messages for chat ${chatId}.`);
    }

    // Also delete the rolling summary from core memory
    await deleteCoreMemory(`rolling_summary_${chatId}`);
  } catch (err) {
    console.error("[Buffer] Clear history error:", err);
  }
}
