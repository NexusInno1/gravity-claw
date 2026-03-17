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
 *   Built-in tools are registered centrally in tools/registry.ts.
 *   MCP tools are merged dynamically on each iteration.
 *   An optional `allowedToolNames` filter restricts which tools
 *   are visible/executable (used by sub-agents).
 */

import { Content, Part, Tool } from "@google/genai";
import { getAI, withRetry } from "../lib/gemini.js";
import { ENV } from "../config.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Centralized tool registry
import {
  registerTool,
  getAllToolEntries,
  getFilteredToolEntries,
  getToolDefinitions,
  getToolExecutor,
} from "../tools/registry.js";

// Built-in tool definitions + executors
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

// ─── Register Built-in Tools ─────────────────────────────────────

registerTool({
  name: "get_current_time",
  definition: getCurrentTimeDefinition,
  executor: async () => executeGetCurrentTime(),
});
registerTool({
  name: "remember_fact",
  definition: rememberFactDefinition,
  executor: async (args) =>
    executeRememberFact(args as { key: string; value: string }),
});
registerTool({
  name: "web_search",
  definition: webSearchDefinition,
  executor: async (args) => executeWebSearch((args as { query: string }).query),
});
registerTool({
  name: "web_research",
  definition: webResearchDefinition,
  executor: async (args) =>
    executeWebResearch((args as { query: string }).query),
});
registerTool({
  name: "read_url",
  definition: readUrlDefinition,
  executor: async (args) => executeReadUrl((args as { url: string }).url),
});
registerTool({
  name: "set_reminder",
  definition: setReminderDefinition,
  executor: async (args, chatId) =>
    executeSetReminder(args as { message: string; minutes: number }, chatId),
});
registerTool({
  name: "browse_page",
  definition: browsePageDefinition,
  executor: async (args) =>
    executeBrowsePage(
      args as { url: string; wait_for?: string; extract_selector?: string },
    ),
});

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
 * If `permittedNames` is provided, the tool must be in that set.
 */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  chatId: string,
  permittedNames?: Set<string>,
): Promise<string> {
  // Runtime permission guard
  if (permittedNames && !permittedNames.has(name)) {
    console.warn(`[Agent] Blocked tool call "${name}" — not permitted.`);
    return `Error: Tool "${name}" is not permitted in this context.`;
  }

  // Check built-in registry
  const executor = getToolExecutor(name);
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
 * Get available tool definitions, filtered for permitted tools.
 *
 * @param allowedToolNames  Optional list of tool names to include.
 *                          If omitted, all tools are returned.
 * @param deniedToolNames   Optional list of tool names to exclude.
 *                          Ignored if allowedToolNames is set.
 */
function getAvailableTools(
  allowedToolNames?: string[],
  deniedToolNames?: string[],
): { definitions: Tool[]; permittedNames: Set<string> } {
  // Filter built-in tools
  const filteredEntries = getFilteredToolEntries(
    allowedToolNames,
    deniedToolNames,
  );
  const builtinDefs = getToolDefinitions(filteredEntries);

  // Collect permitted built-in names
  const permittedNames = new Set(filteredEntries.map((e) => e.name));

  // MCP tools: apply the same allow/deny logic
  const mcpTools = mcpManager.getAllMcpTools();
  const filteredMcpTools: Tool[] = [];

  for (const mcpTool of mcpTools) {
    if (!mcpTool.functionDeclarations) continue;

    const filteredDecls = mcpTool.functionDeclarations.filter((decl) => {
      const name = decl.name!;
      if (allowedToolNames && allowedToolNames.length > 0) {
        return allowedToolNames.includes(name);
      }
      if (deniedToolNames && deniedToolNames.length > 0) {
        return !deniedToolNames.includes(name);
      }
      return true;
    });

    if (filteredDecls.length > 0) {
      filteredMcpTools.push({ functionDeclarations: filteredDecls });
      for (const decl of filteredDecls) {
        permittedNames.add(decl.name!);
      }
    }
  }

  return {
    definitions: [...builtinDefs, ...filteredMcpTools],
    permittedNames,
  };
}

/**
 * The core agentic loop with memory integration.
 *
 * @param userMessage      The message text from the user
 * @param chatId           The chat ID for memory scoping
 * @param allowedToolNames Optional allowlist of tool names (sub-agent restriction)
 * @param deniedToolNames  Optional denylist of tool names (sub-agent restriction)
 * @param maxIterations    Optional override for max loop iterations
 * @returns The final text response from the agent
 */
export async function runAgentLoop(
  userMessage: string,
  chatId: string,
  allowedToolNames?: string[],
  deniedToolNames?: string[],
  maxIterations?: number,
): Promise<string> {
  const iterLimit = maxIterations ?? MAX_ITERATIONS;

  // Load Tier 2 recent messages as conversation history (before saving current)
  const recentMessages = await getRecentMessages(chatId);

  // Save user message to buffer (Tier 2) — after loading to avoid duplication
  await saveMessage(chatId, "user", userMessage);

  // Build system instruction with all memory tiers
  const systemInstruction = await buildSystemInstruction(chatId, userMessage);

  const contents: Content[] = recentMessages.map((msg) => ({
    role: msg.role as "user" | "model",
    parts: [{ text: msg.content }],
  }));

  // Append current user message (it wasn't in DB when we loaded)
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const { definitions: availableTools, permittedNames } = getAvailableTools(
    allowedToolNames,
    deniedToolNames,
  );
  let iterationCount = 0;

  while (iterationCount < iterLimit) {
    iterationCount++;
    console.log(`[Agent] Iteration ${iterationCount}/${iterLimit}`);

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
            permittedNames,
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
    iterLimit +
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

  // Vision loop always gets full tool access
  const { definitions: availableTools, permittedNames } = getAvailableTools();
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
            permittedNames,
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
