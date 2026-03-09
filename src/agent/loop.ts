/**
 * Core Agent Loop — with 3-Tier Memory, Skills, and MCP Integration
 *
 * Context Assembly Order:
 *   1. System rules (soul.md)
 *   2. Active Skills
 *   3. Tool usage rules
 *   4. Tier 1 Core Memory
 *   5. Tier 2 Rolling Summary
 *   6. Tier 2 Recent Messages
 *   7. Tier 3 Top 3-5 Semantic Memories
 *   8. Current user message
 *
 * Tool Registry:
 *   Built-in tools are registered at startup.
 *   MCP tools are merged dynamically on each iteration.
 */

import { Content, Part, Tool } from "@google/genai";
import { getAI, withRetry } from "../lib/gemini.js";
import { ENV } from "../config.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Built-in tools
import {
  getCurrentTimeDefinition,
  executeGetCurrentTime,
} from "../tools/get_current_time.js";
import {
  rememberFactDefinition,
  executeRememberFact,
} from "../tools/remember_fact.js";
import {
  webSearchDefinition,
  executeWebSearch,
  webResearchDefinition,
  executeWebResearch,
} from "../tools/web_search.js";
import { readUrlDefinition, executeReadUrl } from "../tools/read_url.js";
import {
  setReminderDefinition,
  executeSetReminder,
} from "../tools/set_reminder.js";
import {
  browsePageDefinition,
  executeBrowsePage,
} from "../tools/browse_page.js";

// Memory tiers
import { buildCoreMemoryPrompt, getCoreMemory } from "../memory/core.js";
import { saveMessage, getRecentMessages } from "../memory/buffer.js";
import {
  buildSemanticPrompt,
  triggerFactExtraction,
} from "../memory/semantic.js";

// Skills system
import { loadSkills, buildSkillsPrompt } from "../skills/skills.js";

// MCP system
import { mcpManager } from "../mcp/mcp-manager.js";

const MAX_ITERATIONS = 5;

// ─── Soul + Skills (loaded once at startup) ──────────────────────

let soulPrompt = "";
try {
  soulPrompt = readFileSync(resolve(process.cwd(), "soul.md"), "utf-8");
  console.log("[Soul] Loaded personality from soul.md");
} catch {
  console.warn("[Soul] soul.md not found — using default personality.");
  soulPrompt = "You are Gravity Claw, a sharp personal AI agent.";
}

const skills = loadSkills(resolve(process.cwd(), "skills"));
const skillsPrompt = buildSkillsPrompt(skills);

// ─── Tool Registry ───────────────────────────────────────────────

/** A registered tool executor function */
type ToolExecutor = (
  args: Record<string, unknown>,
  chatId: string,
) => Promise<string>;

/** Map of tool name → executor function */
const toolRegistry = new Map<string, ToolExecutor>();

// Register built-in tools
toolRegistry.set("get_current_time", async () => executeGetCurrentTime());
toolRegistry.set(
  "remember_fact",
  async (args) =>
    executeRememberFact(args as { key: string; value: string }),
);
toolRegistry.set(
  "web_search",
  async (args) => executeWebSearch((args as { query: string }).query),
);
toolRegistry.set(
  "web_research",
  async (args) => executeWebResearch((args as { query: string }).query),
);
toolRegistry.set(
  "read_url",
  async (args) => executeReadUrl((args as { url: string }).url),
);
toolRegistry.set("set_reminder", async (args, chatId) =>
  executeSetReminder(args as { message: string; minutes: number }, chatId),
);
toolRegistry.set(
  "browse_page",
  async (args) =>
    executeBrowsePage(
      args as { url: string; wait_for?: string; extract_selector?: string },
    ),
);

/** Built-in tool definitions (static) */
const builtinToolDefs: Tool[] = [
  getCurrentTimeDefinition,
  rememberFactDefinition,
  webSearchDefinition,
  webResearchDefinition,
  readUrlDefinition,
  setReminderDefinition,
  browsePageDefinition,
];

// Tool usage rules (appended after soul + skills)
const toolRules =
  "Use the remember_fact tool ONLY when the user states a clear preference, " +
  "defines a long-term goal, provides personal profile info, sets a recurring " +
  "routine, or explicitly asks you to remember something. " +
  "Do NOT save casual conversation, jokes, small talk, or temporary emotions. " +
  "You CAN answer general knowledge questions (people, places, history, science, etc.) " +
  "directly from your training data — you do NOT need a tool for that. " +
  "Only use tools when you need real-time or dynamic information.";

// ─── System Instruction Builder ──────────────────────────────────

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

  // 2. Skills
  if (skillsPrompt) {
    parts.push(skillsPrompt);
  }

  // 3. Tool usage rules
  parts.push(toolRules);

  // 4. Tier 1 Core Memory
  const coreMemory = buildCoreMemoryPrompt();
  if (coreMemory) {
    parts.push(coreMemory);
  }

  // 5. Tier 2 Rolling Summary
  const rollingSummary = getCoreMemory(`rolling_summary_${chatId}`);
  if (rollingSummary) {
    parts.push(`## Conversation Summary (Older Context)\n${rollingSummary}`);
  }

  // 6. Tier 3 Semantic Memories (top 3-5)
  try {
    const semanticBlock = await buildSemanticPrompt(userMessage);
    if (semanticBlock) {
      parts.push(semanticBlock);
    }
  } catch (err) {
    console.warn("[Loop] Semantic memory unavailable, skipping Tier 3.");
  }

  return parts.join("\n\n");
}

// ─── Tool Execution Helper ───────────────────────────────────────

/**
 * Execute a tool by name, checking the registry first, then MCP.
 */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  chatId: string,
): Promise<string> {
  // Check built-in registry
  const executor = toolRegistry.get(name);
  if (executor) {
    return executor(args, chatId);
  }

  // Check MCP tools
  if (mcpManager.isMcpTool(name)) {
    return mcpManager.executeMcpTool(name, args);
  }

  return `Error: Unknown tool "${name}"`;
}

// ─── Agent Loop ──────────────────────────────────────────────────

/**
 * Get all available tool definitions (built-in + MCP).
 */
function getAllTools(): Tool[] {
  const mcpTools = mcpManager.getAllMcpTools();
  return [...builtinToolDefs, ...mcpTools];
}

/**
 * The core agentic loop with memory integration.
 *
 * @param userMessage The message text from the user
 * @param chatId The chat ID for memory scoping
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

  const availableTools = getAllTools();
  let iterationCount = 0;

  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++;
    console.log(`[Agent] Iteration ${iterationCount}/${MAX_ITERATIONS}`);

    // Ask LLM with full context (Gemini primary, OpenRouter fallback)
    const response = await withRetry(
      () =>
        getAI().models.generateContent({
          model: ENV.GEMINI_MODEL,
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

    // Append model's response to history
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
          toolOutputText = await executeTool(
            call.name!,
            (call.args as Record<string, unknown>) || {},
            chatId,
          );
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

/**
 * Agent loop variant that accepts an image for multimodal (vision) queries.
 *
 * @param userMessage Text accompanying the image (or a default prompt)
 * @param chatId The chat ID
 * @param imageBase64 Base64-encoded image data
 * @param mimeType The image MIME type (e.g. "image/jpeg")
 */
export async function runAgentLoopWithImage(
  userMessage: string,
  chatId: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  // Save a text note to buffer (we can't store binary images)
  await saveMessage(chatId, "user", `[Sent an image] ${userMessage}`);

  const systemInstruction = await buildSystemInstruction(chatId, userMessage);

  // Build multimodal content with inline image data
  const contents: Content[] = [
    {
      role: "user",
      parts: [
        { text: userMessage },
        {
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        },
      ],
    },
  ];

  const availableTools = getAllTools();
  let iterationCount = 0;

  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++;
    console.log(`[Agent/Vision] Iteration ${iterationCount}/${MAX_ITERATIONS}`);

    const response = await withRetry(
      () =>
        getAI().models.generateContent({
          model: ENV.GEMINI_MODEL,
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

    if (!response.candidates || response.candidates.length === 0) {
      return "Error: Empty response from model.";
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      return "Error: Empty content from model.";
    }

    const messageParts = candidate.content.parts;
    contents.push({ role: "model", parts: messageParts });

    const toolCalls = messageParts.filter((part) => part.functionCall);

    if (toolCalls.length > 0) {
      const toolResultParts: Part[] = [];

      for (const callPart of toolCalls) {
        const call = callPart.functionCall!;
        console.log(`[Agent/Vision] Tool requested: ${call.name}`);

        let toolOutputText = "";
        try {
          toolOutputText = await executeTool(
            call.name!,
            (call.args as Record<string, unknown>) || {},
            chatId,
          );
        } catch (error) {
          toolOutputText = `Error calling tool: ${String(error)}`;
        }

        toolResultParts.push({
          functionResponse: {
            name: call.name,
            response: { result: toolOutputText },
          },
        });
      }

      contents.push({ role: "user", parts: toolResultParts });
    } else {
      const texts = messageParts.filter((p) => p.text).map((p) => p.text);
      const finalResponse = texts.join("\n").trim();

      if (finalResponse) {
        await saveMessage(chatId, "model", finalResponse);
      }

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
