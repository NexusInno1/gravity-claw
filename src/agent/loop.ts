import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { llm, SYSTEM_PROMPT, TOOL_NAMES } from "../llm/claude.js";
import { config } from "../config.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentResult } from "./types.js";
import { memoryManager } from "../memory/manager.js";
import { buildMemoryContext } from "../memory/context-builder.js";
import { withRetry } from "../llm/retry.js";
import { log } from "../logger.js";

// ── Text-based tool call detector ────────────────────────
// Some weaker models output "/tool_name args" as text instead of using
// the function-calling API. This regex detects that pattern.
const TEXT_TOOL_CALL_RE = new RegExp(
  `^\\/(${TOOL_NAMES.join("|")})(?:\\s+(.*))?$`,
  "m",
);

/** Max total tool calls per single agent run (across all iterations) */
const MAX_TOTAL_TOOL_CALLS = 15;

/** Max times the same tool name can appear (even with different args) */
const MAX_CALLS_PER_TOOL = 5;

/**
 * Run the agentic ReAct loop (OpenAI-compatible):
 *   User message → LLM → (tool calls → results →)* → final text response
 *
 * Now memory-aware: retrieves context from all 3 memory layers before calling
 * the LLM, and saves the exchange asynchronously after responding.
 */
export async function runAgentLoop(
  userMessage: string,
  toolRegistry: ToolRegistry,
  userId: string,
  imageUrl?: string,
): Promise<AgentResult> {
  const startTime = Date.now();

  // ── Retrieve memory context (Layers 1, 2, 3) ────────────
  const memCtx = await memoryManager.getContext(userId, userMessage);
  const memoryBlock = buildMemoryContext(memCtx);

  // Build enriched system prompt
  const systemContent = memoryBlock
    ? `${SYSTEM_PROMPT}\n\n${memoryBlock}`
    : SYSTEM_PROMPT;

  // Build messages: system + recent history + current user message
  const historyMessages: ChatCompletionMessageParam[] =
    memCtx.recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

  // Build user content — multimodal if image is provided
  const userContent: ChatCompletionMessageParam["content"] = imageUrl
    ? [
        { type: "image_url" as const, image_url: { url: imageUrl } },
        { type: "text" as const, text: userMessage },
      ]
    : userMessage;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...historyMessages,
    { role: "user", content: userContent },
  ];

  const tools = toolRegistry.getOpenAITools();
  let iterations = 0;
  let totalToolCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let useTools = tools.length > 0;

  // Runaway execution protection state
  let lastToolSignature = "";
  let repeatedToolCount = 0;
  const toolCallCounts = new Map<string, number>(); // per-tool call frequency

  while (iterations < config.maxAgentIterations) {
    iterations++;

    try {
      const modelToUse = config.llmModel;
      const response = await withRetry(
        () =>
          llm.chat.completions.create({
            model: modelToUse,
            max_tokens: 4096,
            messages,
            ...(useTools ? { tools } : {}),
          }),
        { label: `LLM (${modelToUse})`, maxRetries: 3 },
      );

      // Track token usage
      if (response.usage) {
        totalInputTokens += response.usage.prompt_tokens ?? 0;
        totalOutputTokens += response.usage.completion_tokens ?? 0;
      }

      const choice = response.choices[0];
      if (!choice) {
        return {
          response: "⚠️ No response from LLM.",
          toolCalls: totalToolCalls,
          iterations,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          latencyMs: Date.now() - startTime,
        };
      }

      const message = choice.message;

      // ── Tool calls requested ────────────────────────────
      if (choice.finish_reason === "tool_calls" && message.tool_calls?.length) {
        messages.push(message);

        // Global budget check
        if (totalToolCalls >= MAX_TOTAL_TOOL_CALLS) {
          log.warn({ totalToolCalls }, "  ⚠️ Total tool call budget exceeded");
          messages.push({
            role: "user",
            content:
              "SYSTEM: You have used too many tool calls. Stop calling tools and provide your final answer now.",
          });
          continue;
        }

        for (const toolCall of message.tool_calls) {
          totalToolCalls++;

          const fnName = toolCall.function.name;
          let fnArgs: Record<string, unknown> = {};
          try {
            fnArgs = JSON.parse(toolCall.function.arguments || "{}");
          } catch {
            fnArgs = {};
          }

          log.info({ tool: fnName, args: fnArgs }, "  🔧 Tool call");

          // Per-signature repeat detection (identical call)
          const signature = `${fnName}:${JSON.stringify(fnArgs)}`;
          if (signature === lastToolSignature) {
            repeatedToolCount++;
          } else {
            lastToolSignature = signature;
            repeatedToolCount = 0;
          }

          // Per-tool frequency tracking
          const toolCount = (toolCallCounts.get(fnName) ?? 0) + 1;
          toolCallCounts.set(fnName, toolCount);

          let result;
          if (repeatedToolCount >= 1) {
            // Same exact call twice in a row — halt
            log.warn(
              { tool: fnName },
              "  ⚠️ Identical tool call repeated, forcing stop",
            );
            result = {
              error:
                "SYSTEM: You called this exact tool with the same arguments twice in a row. Do not call it again. Synthesize what you know and give the user a final text answer.",
            };
          } else if (toolCount > MAX_CALLS_PER_TOOL) {
            // Same tool called too many times with different args — warn
            log.warn(
              { tool: fnName, count: toolCount },
              "  ⚠️ Tool called too frequently",
            );
            result = {
              error: `SYSTEM: You have called ${fnName} ${toolCount} times. Stop using this tool and provide your final answer to the user now.`,
            };
          } else {
            result = await toolRegistry.execute(fnName, fnArgs);
          }
          log.debug({ tool: fnName, result }, "  ✅ Tool result");

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }

        continue;
      }

      // ── Final text response ─────────────────────────────
      const rawResponse = message.content || "";

      // ── Intercept text-based tool invocations ───────────
      // Some models output "/web_search query" as text instead of calling
      // the tool via the API. Detect this and execute the tool ourselves.
      if (rawResponse) {
        const textToolMatch = rawResponse.match(TEXT_TOOL_CALL_RE);
        if (textToolMatch) {
          const fnName = textToolMatch[1]!;
          const fnArgsText = (textToolMatch[2] ?? "").trim();
          log.warn(
            { tool: fnName, args: fnArgsText },
            "  ⚠️ Model output tool as text — intercepting and executing",
          );

          // Build reasonable args from the text
          const fnArgs: Record<string, unknown> = {};
          if (fnName === "web_search" && fnArgsText) {
            fnArgs["query"] = fnArgsText;
          } else if (fnArgsText) {
            // Try to parse as JSON, else treat as input
            try {
              Object.assign(fnArgs, JSON.parse(fnArgsText));
            } catch {
              fnArgs["input"] = fnArgsText;
            }
          }

          totalToolCalls++;
          const toolCount = (toolCallCounts.get(fnName) ?? 0) + 1;
          toolCallCounts.set(fnName, toolCount);

          if (
            totalToolCalls <= MAX_TOTAL_TOOL_CALLS &&
            toolCount <= MAX_CALLS_PER_TOOL
          ) {
            const result = await toolRegistry.execute(fnName, fnArgs);
            messages.push({ role: "assistant", content: rawResponse });
            messages.push({
              role: "user",
              content: `Tool result for ${fnName}: ${JSON.stringify(result)}\n\nNow provide a final natural language answer to the user based on these results.`,
            });
            continue;
          }
        }
      }

      // ── Sanitize and check for empty response ───────────
      const finalResponse = sanitizeResponse(rawResponse);

      // If after sanitization the response is empty, the model was only
      // outputting tool commands. Re-prompt it to give a natural answer.
      if (!finalResponse && iterations < config.maxAgentIterations - 1) {
        log.warn(
          "  ⚠️ Response was entirely tool commands after sanitizing — re-prompting",
        );
        messages.push({ role: "assistant", content: rawResponse || "..." });
        messages.push({
          role: "user",
          content:
            "SYSTEM: Your previous response was empty or only contained tool commands. Please provide a natural language answer to the user's original question now. Do not output any tool names or commands.",
        });
        continue;
      }

      const safeResponse =
        finalResponse ||
        "I couldn't find a clear answer. Please try rephrasing your question.";

      // Save the exchange to memory asynchronously (don't block the reply)
      void memoryManager.saveExchange(userId, userMessage, safeResponse);

      return {
        response: safeResponse,
        toolCalls: totalToolCalls,
        iterations,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        latencyMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // If tool calling itself failed, retry without tools
      if (useTools && iterations === 1) {
        log.warn(
          { error: errMsg },
          "  ⚠️ Tool calling failed, retrying without tools",
        );
        useTools = false;
        iterations--;
        continue;
      }

      // Fallback model: try once with the backup model if configured
      if (config.fallbackModel && iterations <= 2) {
        log.info(
          { fallbackModel: config.fallbackModel },
          "  🔄 Trying fallback model",
        );
        try {
          const fallbackResponse = await withRetry(
            () =>
              llm.chat.completions.create({
                model: config.fallbackModel,
                max_tokens: 4096,
                messages,
              }),
            { label: `Fallback (${config.fallbackModel})`, maxRetries: 2 },
          );

          const fbMsg = fallbackResponse.choices[0]?.message?.content ?? "";
          if (fbMsg) {
            if (fallbackResponse.usage) {
              totalInputTokens += fallbackResponse.usage.prompt_tokens ?? 0;
              totalOutputTokens +=
                fallbackResponse.usage.completion_tokens ?? 0;
            }
            void memoryManager.saveExchange(userId, userMessage, fbMsg);
            return {
              response: fbMsg,
              toolCalls: totalToolCalls,
              iterations,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              latencyMs: Date.now() - startTime,
            };
          }
        } catch (fbErr) {
          log.error(fbErr, "  ❌ Fallback model also failed");
        }
      }

      // Build a user-friendly error message
      const userError = buildUserErrorMessage(error);
      return {
        response: userError,
        toolCalls: totalToolCalls,
        iterations,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  return {
    response:
      "⚠️ Agent reached maximum iterations. Stopping to prevent runaway execution.",
    toolCalls: totalToolCalls,
    iterations,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    latencyMs: Date.now() - startTime,
  };
}

// ── Response Sanitizer ───────────────────────────────────

/**
 * Strip accidental tool-name leaks from LLM responses.
 * e.g. "/web_search Denmark Country" → (empty, signals re-prompt needed)
 *
 * Returns empty string if the entire response was tool commands —
 * the caller should then re-prompt rather than showing the raw text.
 */
function sanitizeResponse(text: string): string {
  let cleaned = text;
  for (const name of TOOL_NAMES) {
    // Remove lines that are just "/tool_name" or "/tool_name some text"
    cleaned = cleaned.replace(new RegExp(`^\\/\\s*${name}\\b.*$`, "gm"), "");
    // Also catch bare tool names at the start of a line without slash
    cleaned = cleaned.replace(new RegExp(`^${name}\\s+[^\\n]+$`, "gm"), "");
  }
  // Collapse multiple blank lines into one
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  // Return empty string (not original) so caller knows to re-prompt
  return cleaned;
}

// ── Error Messages ───────────────────────────────────────

function buildUserErrorMessage(error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status: number }).status
      : undefined;

  if (status === 429) {
    return "⚠️ Rate limit hit — too many requests. Try again in a minute.";
  }
  if (status === 503 || status === 502) {
    return "⚠️ The AI service is temporarily down. Give it a minute and try again.";
  }
  if (status === 401) {
    return "🔑 Authentication failed. The API key may be invalid or expired.";
  }

  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) {
    return "⚠️ Network connection failed. Check your internet and try again.";
  }
  if (msg.includes("timed out")) {
    return "⚠️ Request timed out. The operation took too long — try again.";
  }

  return `⚠️ Something went wrong: ${msg.slice(0, 150)}`;
}
