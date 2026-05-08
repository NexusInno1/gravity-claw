/**
 * Groq LLM Provider
 *
 * Implements LLMProvider using the OpenAI SDK pointed at Groq's API.
 * Groq uses the OpenAI-compatible API format — same message structure,
 * same tool calling conventions, same response shape.
 *
 * Why Groq over OpenRouter free tier:
 *   - Free tier: 6,000 RPM (vs OpenRouter free which is shared/unreliable)
 *   - Ultra-low latency (LPU-based hardware inference)
 *   - No per-request cost on free models (llama-3.3-70b, etc.)
 *   - Reliable tool calling support
 *
 * Groq free models (as of 2026-05):
 *   - llama-3.3-70b-versatile  — best all-round (recommended fallback)
 *   - llama3-8b-8192           — fastest, good for simple tasks
 *   - mixtral-8x7b-32768       — good for long contexts
 *   - gemma2-9b-it             — Google Gemma 2
 *
 * Usage:
 *   import { groqProvider } from "../lib/groq.js";
 *   const response = await groqProvider.chat({ model, messages, ... });
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { ENV } from "../config.js";
import type {
  LLMProvider,
  LLMCallParams,
  LLMResponse,
  LLMMessage,
  LLMToolSchema,
} from "./llm.js";

// ─── Groq Client ──────────────────────────────────────────────────

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: ENV.GROQ_API_KEY,
    });
  }
  return client;
}

// ─── Conversion: LLM Types → OpenAI Types ─────────────────────────
// Identical to openrouter.ts — Groq speaks OpenAI natively.

function messagesToOpenAI(messages: LLMMessage[]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content || "" });
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      });
      continue;
    }

    if (msg.toolResults && msg.toolResults.length > 0) {
      for (const tr of msg.toolResults) {
        result.push({
          role: "tool",
          tool_call_id: tr.callId,
          content: tr.content,
        });
      }
      continue;
    }

    if (msg.role === "assistant") {
      result.push({ role: "assistant", content: msg.content || "" });
    } else {
      // Note: Groq free models do NOT support image inputs.
      // If inlineImages are present, send text-only and log a warning.
      if (msg.inlineImages && msg.inlineImages.length > 0) {
        console.warn("[Groq] Image inputs not supported on Groq — sending text only.");
      }
      result.push({ role: "user", content: msg.content || "" });
    }
  }

  return result;
}

function toolSchemasToOpenAI(schemas: LLMToolSchema[]): ChatCompletionTool[] {
  return schemas.map((s) => ({
    type: "function" as const,
    function: {
      name: s.name,
      description: s.description,
      parameters: s.parameters as Record<string, unknown>,
    },
  }));
}

function parseGroqResponse(completion: OpenAI.ChatCompletion): LLMResponse {
  const choice = completion.choices[0];
  if (!choice) {
    return { text: "Error: Empty response from Groq." };
  }

  const result: LLMResponse = {};
  const msg = choice.message;

  if (msg.content) {
    result.text = msg.content;
  }

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    result.toolCalls = msg.tool_calls
      .filter((tc) => tc.type === "function")
      .map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }
        return {
          id: tc.id,
          name: tc.function.name,
          args,
        };
      });
  }

  if (completion.usage) {
    result.usage = {
      promptTokens: completion.usage.prompt_tokens,
      completionTokens: completion.usage.completion_tokens,
      totalTokens: completion.usage.total_tokens,
    };
  }

  return result;
}

// ─── Provider Implementation ──────────────────────────────────────

class GroqProvider implements LLMProvider {
  async chat(params: LLMCallParams): Promise<LLMResponse> {
    if (!ENV.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is not configured.");
    }

    const llmMessages: LLMMessage[] = [];
    if (params.systemInstruction) {
      llmMessages.push({ role: "system", content: params.systemInstruction });
    }
    llmMessages.push(...params.messages);

    const messages = messagesToOpenAI(llmMessages);
    const tools =
      params.tools && params.tools.length > 0
        ? toolSchemasToOpenAI(params.tools)
        : undefined;

    const model = params.model || ENV.GROQ_MODEL;
    console.log(`[Groq] Calling ${model}...`);

    const completion = await getClient().chat.completions.create({
      model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      temperature: params.temperature ?? 0.7,
    });

    console.log(`[Groq] Response received.`);
    return parseGroqResponse(completion);
  }
}

/** Singleton Groq provider instance. */
export const groqProvider: LLMProvider = new GroqProvider();
