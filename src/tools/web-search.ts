import type { ToolDefinition } from "./registry.js";
import { config } from "../config.js";

// ── Web Search — DuckDuckGo HTML (no API key required) ───

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ── Web Search — Tavily API (Primary) ────────────────────

async function tavilySearch(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  if (!config.tavilyApiKey) {
    throw new Error("Tavily API key is not configured.");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: config.tavilyApiKey,
      query: query,
      search_depth: "basic",
      include_answer: false,
      include_images: false,
      include_raw_content: false,
      max_results: maxResults,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Tavily API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  if (!data || !data.results) {
    return [];
  }

  return data.results.map((result: any) => ({
    title: result.title || "",
    url: result.url || "",
    snippet: result.content || result.raw_content || "",
  }));
}

// ── Web Search — DuckDuckGo HTML (Fallback) ──────────────

/**
 * Scrapes DuckDuckGo HTML search results.
 * No API key, no rate limits for personal use.
 */
async function duckduckgoSearch(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const html = await response.text();
  const results: SearchResult[] = [];

  // Parse results from DuckDuckGo HTML — each result is in a <div class="result">
  const resultBlocks = html.split(/class="result\s/g).slice(1);

  for (const block of resultBlocks) {
    if (results.length >= maxResults) break;

    // Extract title from <a class="result__a">
    const titleMatch = block.match(
      /class="result__a"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/,
    );
    // Extract URL from href in the result__a link
    const urlMatch = block.match(/class="result__a"\s+href="([^"]*)"/);
    // Extract snippet from <a class="result__snippet">
    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/,
    );

    if (titleMatch && urlMatch) {
      const rawUrl = urlMatch[1] ?? "";
      // DuckDuckGo wraps URLs in a redirect — extract the actual URL
      const actualUrlMatch = rawUrl.match(/uddg=([^&]*)/);
      const finalUrl = actualUrlMatch
        ? decodeURIComponent(actualUrlMatch[1] ?? rawUrl)
        : rawUrl;

      results.push({
        title: stripHtml(titleMatch[1] ?? ""),
        url: finalUrl,
        snippet: stripHtml(snippetMatch?.[1] ?? ""),
      });
    }
  }

  return results;
}

/** Strip HTML tags from a string. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// ── Tool Definition ──────────────────────────────────────

export const webSearch: ToolDefinition = {
  name: "web_search",
  description:
    "Search the web for current information. Automatically uses Tavily API (if configured) for high-quality extracted content, or falls back to DuckDuckGo search.",
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The search query string.",
      },
      max_results: {
        type: "number",
        description:
          "Maximum number of results to return (default: 5, max: 10).",
      },
    },
    required: ["query"],
  },

  execute: async (input: Record<string, unknown>) => {
    const query = input.query as string;
    const maxResults = Math.min(Number(input.max_results ?? 5), 10);

    if (!query?.trim()) {
      return { error: "Query cannot be empty." };
    }

    let results: SearchResult[] = [];
    let source = "";

    try {
      if (config.tavilyApiKey) {
        console.log(`  🔍 Searching Tavily: "${query}" (max ${maxResults})`);
        results = await tavilySearch(query, maxResults);
        source = "Tavily";
      } else {
        throw new Error("Tavily API key not found, using DuckDuckGo fallback.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `  ⚠️ Tavily search failed (${msg}). Falling back to DuckDuckGo.`,
      );
      try {
        console.log(
          `  🔍 Searching DuckDuckGo: "${query}" (max ${maxResults})`,
        );
        results = await duckduckgoSearch(query, maxResults);
        source = "DuckDuckGo HTML";
      } catch (ddgErr) {
        const ddgMsg =
          ddgErr instanceof Error ? ddgErr.message : String(ddgErr);
        return {
          error: `Both Tavily and DuckDuckGo searches failed. Primary error: ${msg}. Fallback error: ${ddgMsg}`,
        };
      }
    }

    if (results.length === 0) {
      return {
        query,
        source,
        results: [],
        message: "No results found.",
      };
    }

    return {
      query,
      source,
      resultCount: results.length,
      results,
    };
  },
};
