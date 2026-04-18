/**
 * Core Agent Loop — Provider-Agnostic with 2-Tier Memory
 *
 * Context Assembly Order:
 *   1. System rules (soul.md)
 *   2. Tool usage rules
 *   3. Tier 1 Core Memory
 *   4. Tier 2 Rolling Summary
 *   5. Current user message
 *
 * Provider Routing:
 *   - Gemini models  → @google/genai SDK (with key rotation)
 *   - OpenRouter models → OpenAI SDK (native, first-class)
 *   - Automatic fallback: Gemini → OpenRouter on failure
 */

import { readFileSync, statSync } from "fs";
import { resolve } from "path";

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

// Slash commands — model override
import { getEffectiveModel } from "../commands/slash-commands.js";

const MAX_ITERATIONS = 5;
const MAX_LOOP_TIMEOUT_MS = 120_000; // 120 seconds hard wall-clock limit

// ─── Soul (loaded once at startup) ───────────────────────────────
//
// Guards:
//   1. Max file size of 64 KB
//   2. NUL-byte rejection
//   3. Minimum content check

const SOUL_MAX_BYTES = 64 * 1024; // 64 KB

let soulPrompt = "";
try {
  const soulPath = resolve(process.cwd(), "soul.md");
  const stat = statSync(soulPath);

  if (stat.size > SOUL_MAX_BYTES) {
    throw new Error(
      `soul.md is oversized (${stat.size} bytes, max ${SOUL_MAX_BYTES}). ` +
      "Refusing to load — truncated system prompts cause undefined behaviour.",
    );
  }

  const raw = readFileSync(soulPath, "utf-8");

  if (raw.includes("\x00")) {
    throw new Error(
      "soul.md contains NUL bytes — possible file corruption or injection attempt. Refusing to load.",
    );
  }

  const trimmed = raw.trim();
  if (trimmed.length < 20) {
    throw new Error(
      `soul.md appears empty or too short (${trimmed.length} chars). ` +
      "Refusing to use it as a system prompt.",
    );
  }

  soulPrompt = trimmed;
  console.log(`[Soul] Loaded personality from soul.md (${stat.size} bytes).`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[Soul] soul.md not loaded — ${msg}`);
  console.warn("[Soul] Falling back to built-in default personality.");
  soulPrompt = "You are SUNDAY (Superior Universal Neural Digital Assistant Yield), a sharp personal AI agent.";
}

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
    executeSetReminder(
      args as { message: string; when?: string; minutes?: number },
      chatId,
    ),
});
registerTool({
  name: "browse_page",
  definition: browsePageDefinition,
  executor: async (args) =>
    executeBrowsePage(
      args as { url: string; wait_for?: string; extract_selector?: string },
    ),
});

// Tool usage rules (appended after soul in system prompt)
const toolRules =
  "## Tool Usage Rules\n\n" +

  "### NEVER refuse a task you have tools to handle.\n" +
  "If the user asks for real-time data, news, prices, search results, " +
  "or any live/current information — USE YOUR TOOLS. Do NOT say 'I cannot browse the web' " +
  "or 'I don't have access to real-time data'. You DO have web_search, web_research, " +
  "browse_page, and read_url tools. USE THEM.\n\n" +

  "### General Tool Rules:\n" +
  "- Use web_search for quick lookups of current/real-time information.\n" +
  "- Use web_research for structured deep dives (it does multiple searches).\n" +
  "- Use browse_page to read a specific URL or page.\n" +
  "- Use read_url to extract content from a direct link.\n" +
  "- Use remember_fact ONLY when the user states a clear preference, defines a long-term goal, " +
  "provides personal profile info, sets a recurring routine, or explicitly asks you to remember something.\n" +
  "- Do NOT save casual conversation, jokes, small talk, or temporary emotions.\n" +
  "- You CAN answer general knowledge questions directly from training data — no tool needed.\n";

// ─── System Instruction Builder ──────────────────────────────────

/**
 * Build the full system instruction with memory tiers injected.
 */
async function buildSystemInstruction(
  chatId: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Soul + system rules
  parts.push(soulPrompt);

  // 2. Current date/time (injected fresh on every request)
  const nowIST = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "long",
  });
  parts.push(
    `## Current Date & Time\n` +
    `The current date and time is: **${nowIST}** (Indian Standard Time).\n` +
    `Always use this as the authoritative date. When searching for news or current events, ` +
    `always include the current year (${new Date().getFullYear()}) and month in your search queries ` +
    `to ensure you get fresh results and not stale/old articles.`,
  );

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

  return parts.join("\n\n");
}

// ─── Tool Execution Helper ───────────────────────────────────────

/**
 * Execute a tool by name from the registry.
 * If `permittedNames` is provided, the tool must be in that set.
 */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  chatId: string,
  permittedNames?: Set<string>,
): Promise<string> {
  if (permittedNames && !permittedNames.has(name)) {
    console.warn(`[Agent] Blocked tool call "${name}" — not permitted.`);
    return `Error: Tool "${name}" is not permitted in this context.`;
  }

  const executor = getToolExecutor(name);
  if (executor) {
    return executor(args, chatId);
  }

  return `Error: Unknown tool "${name}"`;
}

// ─── Agent Loop ──────────────────────────────────────────────────

/**
 * Get available tool schemas + permitted names.
 */
function getAvailableTools(
  allowedToolNames?: string[],
  deniedToolNames?: string[],
): { schemas: LLMToolSchema[]; permittedNames: Set<string> } {
  const filteredEntries = getFilteredToolEntries(
    allowedToolNames,
    deniedToolNames,
  );
  const builtinGeminiDefs = getToolDefinitions(filteredEntries);
  const schemas = geminiToolsToSchemas(builtinGeminiDefs);
  const permittedNames = new Set(filteredEntries.map((e) => e.name));

  return { schemas, permittedNames };
}

/**
 * The core agentic loop with 2-tier memory integration.
 *
 * @param userMessage      The message text from the user
 * @param chatId           The chat ID for memory scoping
 * @param allowedToolNames Optional allowlist of tool names
 * @param deniedToolNames  Optional denylist of tool names
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
  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("Agent loop timed out (120s limit)")), MAX_LOOP_TIMEOUT_MS),
  );
  return Promise.race([runAgentLoopInner(userMessage, chatId, allowedToolNames, deniedToolNames, maxIterations), timeoutPromise]);
}

async function runAgentLoopInner(
  userMessage: string,
  chatId: string,
  allowedToolNames?: string[],
  deniedToolNames?: string[],
  maxIterations?: number,
): Promise<string> {
  const iterLimit = maxIterations ?? MAX_ITERATIONS;

  const recentMessages = await getRecentMessages(chatId);
  await saveMessage(chatId, "user", userMessage);

  const systemInstruction = await buildSystemInstruction(chatId);

  const messages: LLMMessage[] = recentMessages.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));
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

    const response: LLMResponse = await routedChat({
      model: activeModel,
      systemInstruction,
      messages,
      tools: availableTools,
      temperature: ENV.DEFAULT_TEMPERATURE ?? 0.7,
    });

    if (response.toolCalls && response.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      const toolResults: LLMToolResult[] = await Promise.all(
        response.toolCalls.map(async (call) => {
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

          const preview = toolOutputText.length > 200
            ? toolOutputText.substring(0, 200) + "..."
            : toolOutputText;
          console.log(`[Agent] Tool result (${toolOutputText.length} chars): ${preview}`);

          return {
            callId: call.id,
            name: call.name,
            content: toolOutputText,
          };
        }),
      );

      messages.push({ role: "user", toolResults });
    } else {
      const finalResponse = response.text?.trim() || "";

      if (finalResponse) {
        await saveMessage(chatId, "model", finalResponse);
      }

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
 */
export async function runAgentLoopWithImage(
  userMessage: string,
  chatId: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("Agent loop timed out (120s limit)")), MAX_LOOP_TIMEOUT_MS),
  );
  return Promise.race([runAgentLoopWithImageInner(userMessage, chatId, imageBase64, mimeType), timeoutPromise]);
}

async function runAgentLoopWithImageInner(
  userMessage: string,
  chatId: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  const iterLimit = MAX_ITERATIONS;

  const recentMessages = await getRecentMessages(chatId);
  await saveMessage(chatId, "user", `[Sent an image] ${userMessage}`);

  const systemInstruction = await buildSystemInstruction(chatId);
  const { schemas: availableTools, permittedNames } = getAvailableTools();

  const messages: LLMMessage[] = recentMessages.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));

  messages.push({
    role: "user",
    content: userMessage,
    inlineImages: [{ data: imageBase64, mimeType }],
  });

  let iterationCount = 0;

  while (iterationCount < iterLimit) {
    iterationCount++;

    const activeModel = getEffectiveModel(chatId);
    const provider = getProviderName(activeModel);
    console.log(
      `[Agent/Vision] Iteration ${iterationCount}/${iterLimit} — ${activeModel} (${provider})`,
    );

    const response: LLMResponse = await routedChat({
      model: activeModel,
      systemInstruction,
      messages,
      tools: availableTools,
      temperature: ENV.DEFAULT_TEMPERATURE ?? 0.7,
    });

    if (response.toolCalls && response.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      const toolResults: LLMToolResult[] = await Promise.all(
        response.toolCalls.map(async (call) => {
          console.log(`[Agent/Vision] Tool requested: ${call.name}`);

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

          const preview = toolOutputText.length > 200
            ? toolOutputText.substring(0, 200) + "..."
            : toolOutputText;
          console.log(`[Agent/Vision] Tool result (${toolOutputText.length} chars): ${preview}`);

          return {
            callId: call.id,
            name: call.name,
            content: toolOutputText,
          };
        }),
      );

      messages.push({ role: "user", toolResults });
    } else {
      const finalResponse = response.text?.trim() || "";

      if (finalResponse) {
        await saveMessage(chatId, "model", finalResponse);
      }

      return finalResponse || "No text response generated.";
    }
  }

  return (
    "Error: Agent reached maximum iterations (" +
    iterLimit +
    ") without answering."
  );
}
