/**
 * web_search tool — Uses Tavily Search API for real-time web search.
 *
 * Tavily provides AI-optimized search with built-in answer generation
 * and clean result snippets. No extra Gemini calls needed.
 */

import { Type, Tool } from "@google/genai";
import { ENV } from "../config.js";

export const webSearchDefinition: Tool = {
  functionDeclarations: [
    {
      name: "web_search",
      description:
        "Search the internet for real-time information. Use this for current events, news, weather, sports scores, job listings, stock prices, or any question that requires up-to-date information beyond your training data.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: "The search query to look up on the web",
          },
        },
        required: ["query"],
      },
    },
  ],
};

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  answer?: string;
  results: TavilyResult[];
}

/**
 * Execute a web search using the Tavily Search API.
 */
export async function executeWebSearch(query: string): Promise<string> {
  if (!ENV.TAVILY_API_KEY) {
    return "Error: TAVILY_API_KEY is not configured. Add it to your .env file.";
  }

  try {
    console.log(`[WebSearch] Tavily search: "${query}"`);

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[WebSearch] Tavily API error ${response.status}: ${errorText}`,
      );
      return `Search failed (HTTP ${response.status}): ${errorText}`;
    }

    const data = (await response.json()) as TavilyResponse;

    // Build formatted output
    const parts: string[] = [];

    // Include AI-generated answer if available
    if (data.answer) {
      parts.push(`**Answer:** ${data.answer}`);
    }

    // Include top results with sources
    if (data.results && data.results.length > 0) {
      parts.push("\n**Sources:**");
      for (const result of data.results) {
        parts.push(`- ${result.title}: ${result.url}`);
        if (result.content) {
          // Trim content to ~200 chars to keep it concise
          const snippet =
            result.content.length > 200
              ? result.content.substring(0, 200) + "..."
              : result.content;
          parts.push(`  ${snippet}`);
        }
      }
    }

    const output = parts.join("\n").trim();
    if (!output) {
      return "No search results found for: " + query;
    }

    return output;
  } catch (error) {
    console.error("[WebSearch] Error:", error);
    return `Search failed: ${String(error)}`;
  }
}
