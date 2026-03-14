/**
 * OpenRouter Fallback Provider
 *
 * Translates between Gemini SDK types and OpenAI-compatible format,
 * enabling transparent fallback when Gemini keys are exhausted.
 *
 * Uses the OpenAI SDK pointed at OpenRouter's base URL.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { Content, Part, Tool } from "@google/genai";
import { ENV } from "../config.js";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: ENV.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://gravityclaw.dev",
        "X-OpenRouter-Title": "Gravity Claw",
      },
    });
  }
  return client;
}

// ─── Gemini → OpenAI Conversion ────────────────────────────────

/**
 * Convert Gemini Content[] to OpenAI messages[].
 */
function convertContents(
  contents: Content[],
  systemInstruction?: string,
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];

  // System instruction becomes a system message
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }

  for (const content of contents) {
    const role = content.role === "model" ? "assistant" : "user";
    const parts = content.parts || [];

    // Check for function calls (assistant tool_calls)
    const functionCallParts = parts.filter((p) => p.functionCall);
    if (functionCallParts.length > 0 && role === "assistant") {
      const textParts = parts.filter((p) => p.text);
      const textContent = textParts.map((p) => p.text).join("\n") || null;

      messages.push({
        role: "assistant",
        content: textContent,
        tool_calls: functionCallParts.map((p, i) => ({
          id: `call_${p.functionCall!.name}_${i}`,
          type: "function" as const,
          function: {
            name: p.functionCall!.name!,
            arguments: JSON.stringify(p.functionCall!.args || {}),
          },
        })),
      });
      continue;
    }

    // Check for function responses (tool results)
    const functionResponseParts = parts.filter((p) => p.functionResponse);
    if (functionResponseParts.length > 0) {
      for (let fri = 0; fri < functionResponseParts.length; fri++) {
        const fr = functionResponseParts[fri].functionResponse!;
        // Match the tool_call_id generated during assistant message conversion
        // by finding the corresponding tool_call in previous assistant messages
        let toolCallId = `call_${fr.name}_0`;
        for (let mi = messages.length - 1; mi >= 0; mi--) {
          const prev = messages[mi];
          if (prev.role === "assistant" && "tool_calls" in prev && prev.tool_calls) {
            const match = prev.tool_calls.find(
              (tc) => tc.type === "function" && tc.function.name === fr.name,
            );
            if (match) {
              toolCallId = match.id;
              break;
            }
          }
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify(fr.response || {}),
        });
      }
      continue;
    }

    // Regular text message
    const text = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("\n");
    if (text) {
      messages.push({ role, content: text } as ChatCompletionMessageParam);
    }
  }

  return messages;
}

/**
 * Convert Gemini Tool[] to OpenAI tools[].
 */
function convertTools(geminiTools: Tool[]): ChatCompletionTool[] {
  const openaiTools: ChatCompletionTool[] = [];

  for (const tool of geminiTools) {
    if (!tool.functionDeclarations) continue;
    for (const fd of tool.functionDeclarations) {
      openaiTools.push({
        type: "function",
        function: {
          name: fd.name!,
          description: fd.description || "",
          parameters: fd.parameters as Record<string, unknown>,
        },
      });
    }
  }

  return openaiTools;
}

// ─── OpenAI → Gemini Conversion ────────────────────────────────

/**
 * Convert OpenAI response back to Gemini-compatible format.
 * Returns an object with the same shape as Gemini's generateContent response.
 */
function convertResponse(completion: OpenAI.ChatCompletion): {
  candidates: Array<{
    content: { role: string; parts: Part[] };
  }>;
} {
  const choice = completion.choices[0];
  if (!choice) {
    return { candidates: [] };
  }

  const parts: Part[] = [];
  const msg = choice.message;

  // Text content
  if (msg.content) {
    parts.push({ text: msg.content });
  }

  // Tool calls
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      parts.push({
        functionCall: {
          name: tc.function.name,
          args,
        },
      });
    }
  }

  return {
    candidates: [
      {
        content: {
          role: "model",
          parts,
        },
      },
    ],
  };
}

// ─── Public API ────────────────────────────────────────────────

export interface OpenRouterCallParams {
  contents: Content[];
  systemInstruction?: string;
  tools?: Tool[];
  temperature?: number;
}

/**
 * Call OpenRouter as a fallback LLM provider.
 *
 * Accepts Gemini-format inputs and returns a Gemini-compatible response,
 * so the agent loop sees no difference.
 */
export async function callOpenRouter(params: OpenRouterCallParams): Promise<{
  candidates: Array<{
    content: { role: string; parts: Part[] };
  }>;
}> {
  if (!ENV.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const messages = convertContents(params.contents, params.systemInstruction);
  const tools =
    params.tools && params.tools.length > 0
      ? convertTools(params.tools)
      : undefined;

  console.log(`[OpenRouter] Calling ${ENV.OPENROUTER_MODEL} (fallback)...`);

  const completion = await getClient().chat.completions.create({
    model: ENV.OPENROUTER_MODEL,
    messages,
    tools: tools && tools.length > 0 ? tools : undefined,
    temperature: params.temperature ?? 0.7,
  });

  console.log(`[OpenRouter] Response received.`);

  return convertResponse(completion);
}
