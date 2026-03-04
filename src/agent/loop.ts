/**
 * Core Agent Loop — with 3-Tier Memory Integration
 *
 * Context Assembly Order:
 *   1. System rules
 *   2. Tier 1 Core Memory
 *   3. Tier 2 Rolling Summary
 *   4. Tier 2 Recent Messages
 *   5. Tier 3 Top 3-5 Semantic Memories
 *   6. Current user message
 */

import { Content, Part } from "@google/genai";
import { getAI, withRetry } from "../lib/gemini.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  getCurrentTimeDefinition,
  executeGetCurrentTime,
} from "../tools/get_current_time.js";
import {
  rememberFactDefinition,
  executeRememberFact,
} from "../tools/remember_fact.js";
import { webSearchDefinition, executeWebSearch } from "../tools/web_search.js";

import { buildCoreMemoryPrompt, getCoreMemory } from "../memory/core.js";
import { saveMessage, getRecentMessages } from "../memory/buffer.js";
import {
  buildSemanticPrompt,
  triggerFactExtraction,
} from "../memory/semantic.js";

// Initialize the Gemini client
// Gemini client is now managed centrally via lib/gemini.ts with key rotation

const MAX_ITERATIONS = 5;

// Load soul.md once at startup
let soulPrompt = "";
try {
  soulPrompt = readFileSync(resolve(process.cwd(), "soul.md"), "utf-8");
  console.log("[Soul] Loaded personality from soul.md");
} catch {
  console.warn("[Soul] soul.md not found — using default personality.");
  soulPrompt = "You are Gravity Claw, a sharp personal AI agent.";
}

// Combine all tool definitions
const availableTools = [
  getCurrentTimeDefinition,
  rememberFactDefinition,
  webSearchDefinition,
];

// Tool usage rules (appended after soul)
const toolRules =
  "Use the remember_fact tool ONLY when the user states a clear preference, " +
  "defines a long-term goal, provides personal profile info, sets a recurring " +
  "routine, or explicitly asks you to remember something. " +
  "Do NOT save casual conversation, jokes, small talk, or temporary emotions. " +
  "You CAN answer general knowledge questions (people, places, history, science, etc.) " +
  "directly from your training data — you do NOT need a tool for that. " +
  "Only use tools when you need real-time or dynamic information.";

/**
 * Build the full system instruction with all memory tiers injected.
 */
async function buildSystemInstruction(
  chatId: string,
  userMessage: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Soul + system rules
  parts.push(soulPrompt);
  parts.push(toolRules);

  // 2. Tier 1 Core Memory
  const coreMemory = buildCoreMemoryPrompt();
  if (coreMemory) {
    parts.push(coreMemory);
  }

  // 3. Tier 2 Rolling Summary
  const rollingSummary = getCoreMemory(`rolling_summary_${chatId}`);
  if (rollingSummary) {
    parts.push(`## Conversation Summary (Older Context)\n${rollingSummary}`);
  }

  // 4. Tier 3 Semantic Memories (top 3-5)
  try {
    const semanticBlock = await buildSemanticPrompt(userMessage);
    if (semanticBlock) {
      parts.push(semanticBlock);
    }
  } catch (err) {
    // Graceful degradation — skip Tier 3 silently
    console.warn("[Loop] Semantic memory unavailable, skipping Tier 3.");
  }

  return parts.join("\n\n");
}

/**
 * The core agentic loop with memory integration.
 *
 * @param userMessage The message text from the user
 * @param chatId The Telegram chat ID for memory scoping
 * @returns The final text response from the agent
 */
export async function runAgentLoop(
  userMessage: string,
  chatId: string,
): Promise<string> {
  // Save user message to buffer (Tier 2)
  await saveMessage(chatId, "user", userMessage);

  // Build system instruction with all memory tiers
  const systemInstruction = await buildSystemInstruction(chatId, userMessage);

  // Load Tier 2 recent messages as conversation history
  const recentMessages = await getRecentMessages(chatId);
  const contents: Content[] = recentMessages.map((msg) => ({
    role: msg.role as "user" | "model",
    parts: [{ text: msg.content }],
  }));

  // If no history loaded from DB, at minimum include the current user message
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  let iterationCount = 0;

  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++;
    console.log(`[Agent] Iteration ${iterationCount}/${MAX_ITERATIONS}`);

    // Ask LLM with full context (Gemini primary, OpenRouter fallback)
    const response = await withRetry(
      () =>
        getAI().models.generateContent({
          model: "gemini-2.5-flash",
          contents,
          config: {
            tools: availableTools,
            systemInstruction,
            temperature: 0.7,
          },
        }),
      {
        contents,
        systemInstruction,
        tools: availableTools,
        temperature: 0.7,
      },
    );

    // Check if the model returned anything
    if (!response.candidates || response.candidates.length === 0) {
      return "Error: Empty response from model.";
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      return "Error: Empty content from model.";
    }

    const messageParts = candidate.content.parts;

    // Append Gemini's response to history
    contents.push({
      role: "model",
      parts: messageParts,
    });

    // Look for tool calls
    const toolCalls = messageParts.filter((part) => part.functionCall);

    if (toolCalls.length > 0) {
      const toolResultParts: Part[] = [];

      for (const callPart of toolCalls) {
        const call = callPart.functionCall!;
        console.log(`[Agent] Tool requested: ${call.name}`);

        let toolOutputText = "";
        try {
          if (call.name === "get_current_time") {
            toolOutputText = await executeGetCurrentTime();
          } else if (call.name === "remember_fact") {
            toolOutputText = await executeRememberFact(
              call.args as { key: string; value: string },
            );
          } else if (call.name === "web_search") {
            toolOutputText = await executeWebSearch(
              (call.args as { query: string }).query,
            );
          } else {
            toolOutputText = `Error: Unknown tool ${call.name}`;
          }
        } catch (error) {
          toolOutputText = `Error calling tool: ${String(error)}`;
        }

        console.log(`[Agent] Tool result: ${toolOutputText}`);

        toolResultParts.push({
          functionResponse: {
            name: call.name,
            response: { result: toolOutputText },
          },
        });
      }

      contents.push({
        role: "user",
        parts: toolResultParts,
      });
    } else {
      // Final text response
      const texts = messageParts.filter((p) => p.text).map((p) => p.text);
      const finalResponse = texts.join("\n").trim();

      // Save assistant response to buffer (Tier 2)
      if (finalResponse) {
        await saveMessage(chatId, "model", finalResponse);
      }

      // Trigger background fact extraction (Tier 3 — async, never blocks)
      triggerFactExtraction(userMessage, finalResponse || "");

      return finalResponse || "No text response generated.";
    }
  }

  return (
    "Error: Agent reached maximum iterations (" +
    MAX_ITERATIONS +
    ") without answering."
  );
}
