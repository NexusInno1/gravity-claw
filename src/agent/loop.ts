/**
 * Core Agent Loop — Provider-Agnostic with 3-Tier Memory, Skills, and MCP
 *
 * Context Assembly Order:
 *   1. System rules (soul.md)
 *   2. Active Skills
 *   3. Tool usage rules
 *   4. Tier 1 Core Memory
 *   5. Tier 2 Rolling Summary
 *   6. Tier 3 Top 3-5 Semantic Memories
 *   7. Current user message
 *
 * Provider Routing:
 *   - Gemini models  → @google/genai SDK (with key rotation)
 *   - OpenRouter models → OpenAI SDK (native, first-class)
 *   - Automatic fallback: Gemini → OpenRouter on failure
 *
 * Tool Registry:
 *   Built-in tools are registered centrally in tools/registry.ts.
 *   MCP tools are merged dynamically on each iteration.
 *   An optional `allowedToolNames` filter restricts which tools
 *   are visible/executable (used by sub-agents).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import type { Tool } from "@google/genai";

// Provider-agnostic types + router
import type {
  LLMMessage,
  LLMToolCall,
  LLMToolResult,
  LLMToolSchema,
  LLMResponse,
} from "../lib/llm.js";
import { routedChat, getProviderName } from "../lib/router.js";
import { geminiToolsToSchemas } from "../lib/tool-bridge.js";

import { ENV } from "../config.js";

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
import {
  delegateDefinition,
  executeDelegate,
} from "../tools/delegate.js";

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

// Session stats tracking
import { recordTokenUsage } from "../commands/session-stats.js";

// Slash commands — model override
import { getEffectiveModel } from "../commands/slash-commands.js";

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
registerTool({
  name: "delegate",
  definition: delegateDefinition,
  executor: async (args, chatId) =>
    executeDelegate(
      args as { agent: string; task: string; context?: string },
      chatId,
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
  "Only use tools when you need real-time or dynamic information. " +
  "Use the delegate tool when a task requires deep multi-step work: thorough research " +
  "(use 'research' agent), code generation/review (use 'code' agent), content " +
  "summarization (use 'summary' agent), creative writing (use 'creative' agent), " +
  "or data analysis (use 'analyst' agent). For quick, simple questions — answer directly.";

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
 * Get available tool schemas + permitted names, respecting allow/deny lists.
 *
 * @param allowedToolNames  Optional list of tool names to include.
 *                          If omitted, all tools are returned.
 * @param deniedToolNames   Optional list of tool names to exclude.
 *                          Ignored if allowedToolNames is set.
 */
function getAvailableTools(
  allowedToolNames?: string[],
  deniedToolNames?: string[],
): { schemas: LLMToolSchema[]; permittedNames: Set<string> } {
  // Filter built-in tools (these are still stored as Gemini Tool objects)
  const filteredEntries = getFilteredToolEntries(
    allowedToolNames,
    deniedToolNames,
  );
  const builtinGeminiDefs = getToolDefinitions(filteredEntries);

  // Convert Gemini Tool[] → LLMToolSchema[]
  const builtinSchemas = geminiToolsToSchemas(builtinGeminiDefs);

  // Collect permitted built-in names
  const permittedNames = new Set(filteredEntries.map((e) => e.name));

  // MCP tools: apply the same allow/deny logic, then convert
  const mcpGeminiTools = mcpManager.getAllMcpTools();
  const mcpSchemas: LLMToolSchema[] = [];

  for (const mcpTool of mcpGeminiTools) {
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

    for (const decl of filteredDecls) {
      mcpSchemas.push({
        name: decl.name!,
        description: decl.description || "",
        parameters: (decl.parameters as Record<string, unknown>) || {},
      });
      permittedNames.add(decl.name!);
    }
  }

  return {
    schemas: [...builtinSchemas, ...mcpSchemas],
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

  // Build conversation as provider-agnostic LLMMessage[]
  const messages: LLMMessage[] = recentMessages.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));

  // Append current user message (it wasn't in DB when we loaded)
  messages.push({ role: "user", content: userMessage });

  const { schemas: availableTools, permittedNames } = getAvailableTools(
    allowedToolNames,
    deniedToolNames,
  );
  let iterationCount = 0;

  while (iterationCount < iterLimit) {
    iterationCount++;

    const activeModel = getEffectiveModel(chatId);
    const provider = getProviderName(activeModel);
    console.log(
      `[Agent] Iteration ${iterationCount}/${iterLimit} — ${activeModel} (${provider})`,
    );

    // Ask LLM via the smart router (Gemini or OpenRouter, with fallback)
    const llmStart = Date.now();
    const response: LLMResponse = await routedChat({
      model: activeModel,
      systemInstruction,
      messages,
      tools: availableTools,
      temperature: 0.7,
    });
    const llmLatencyMs = Date.now() - llmStart;

    // Track token usage (works for both providers now)
    if (response.usage) {
      recordTokenUsage(
        chatId,
        activeModel,
        response.usage.promptTokens,
        response.usage.completionTokens,
        response.usage.totalTokens,
        llmLatencyMs,
      );
    }

    // Handle tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      // Append the model's response (with tool calls) to history
      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      const toolResults: LLMToolResult[] = [];

      for (const call of response.toolCalls) {
        console.log(`[Agent] Tool requested: ${call.name}`);

        let toolOutputText = "";
        try {
          toolOutputText = await executeTool(
            call.name,
            call.args,
            chatId,
            permittedNames,
          );
        } catch (error) {
          toolOutputText = `Error calling tool: ${String(error)}`;
        }

        console.log(`[Agent] Tool result: ${toolOutputText}`);

        toolResults.push({
          callId: call.id,
          name: call.name,
          content: toolOutputText,
        });
      }

      // Append tool results to history
      messages.push({
        role: "user",
        toolResults,
      });
    } else {
      // Final text response — no tool calls
      const finalResponse = response.text?.trim() || "";

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
 * Note: Currently images are only natively supported through Gemini's
 * inline data format. For OpenRouter vision models, this would need
 * base64 → URL conversion. For now, this always uses Gemini.
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

  // For vision, we need to use the Gemini SDK directly since it supports
  // inline base64 image data. The provider-agnostic layer doesn't abstract
  // multimodal content yet — this is a Gemini-specific path.
  const { GoogleGenAI } = await import("@google/genai");

  // We still use the tool pipeline through the agnostic layer
  const { schemas: availableTools, permittedNames } = getAvailableTools();
  let iterationCount = 0;

  // Build Gemini-native content with inline image
  const activeVisionModel = getEffectiveModel(chatId);

  const geminiKeys = ENV.GEMINI_API_KEYS;
  const ai = new GoogleGenAI({ apiKey: geminiKeys[0] });

  // Use generic array to avoid type issues with mixed role literals
  const geminiContents: Array<{ role: string; parts: any[] }> = [
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

  // Get Gemini-format tool definitions for vision calls
  const filteredEntries = getFilteredToolEntries();
  const builtinGeminiDefs = getToolDefinitions(filteredEntries);
  const mcpGeminiTools = mcpManager.getAllMcpTools();
  const allGeminiTools: Tool[] = [...builtinGeminiDefs, ...mcpGeminiTools];

  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++;
    console.log(
      `[Agent/Vision] Iteration ${iterationCount}/${MAX_ITERATIONS}`,
    );

    const visionStart = Date.now();
    const response = await ai.models.generateContent({
      model: activeVisionModel,
      contents: geminiContents,
      config: {
        tools: allGeminiTools.length > 0 ? allGeminiTools : undefined,
        systemInstruction,
        temperature: 0.7,
      },
    });
    const visionLatencyMs = Date.now() - visionStart;

    // Track token usage
    const visionUsage = (
      response as {
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      }
    ).usageMetadata;
    if (visionUsage) {
      recordTokenUsage(
        chatId,
        activeVisionModel,
        visionUsage.promptTokenCount || 0,
        visionUsage.candidatesTokenCount || 0,
        visionUsage.totalTokenCount || 0,
        visionLatencyMs,
      );
    }

    if (!response.candidates || response.candidates.length === 0) {
      return "Error: Empty response from model.";
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      return "Error: Empty content from model.";
    }

    const messageParts = candidate.content.parts;
    geminiContents.push({ role: "model", parts: messageParts as any[] });

    const toolCalls = messageParts.filter((part: any) => part.functionCall);

    if (toolCalls.length > 0) {
      const toolResultParts: any[] = [];

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

      geminiContents.push({ role: "user", parts: toolResultParts });
    } else {
      const texts = messageParts
        .filter((p: any) => p.text)
        .map((p: any) => p.text);
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

