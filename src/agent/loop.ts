import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { llm, SYSTEM_PROMPT } from "../llm/claude.js";
import { config } from "../config.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentResult } from "./types.js";
import { memoryManager } from "../memory/manager.js";
import { buildMemoryContext } from "../memory/context-builder.js";
import { withRetry } from "../llm/retry.js";
import { log } from "../logger.js";

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

          // Identify repeated tool calls
          const signature = `${fnName}:${JSON.stringify(fnArgs)}`;
          if (signature === lastToolSignature) {
            repeatedToolCount++;
          } else {
            lastToolSignature = signature;
            repeatedToolCount = 0;
          }

          let result;
          if (repeatedToolCount >= 3) {
            log.warn(
              { tool: fnName },
              "  ⚠️ Infinite loop detected, forcing stop",
            );
            result = {
              error:
                "SYSTEM: You have called this exact tool with the same arguments multiple times in a row. Stop calling this tool and provide a final text response to the user.",
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
      const finalResponse = message.content || "(no response)";

      // Save the exchange to memory asynchronously (don't block the reply)
      void memoryManager.saveExchange(userId, userMessage, finalResponse);

      return {
        response: finalResponse,
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

  return `⚠️ Something went wrong: ${msg.slice(0, 150)}`;
}
