import type { ToolDefinition } from "./registry.js";

// ── Web Search — DuckDuckGo HTML (no API key required) ───

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

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
    "Search the web using DuckDuckGo. Returns top results with titles, snippets, and URLs. Use this when you need current information, facts, or to research a topic.",
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

    console.log(`  🔍 Searching: "${query}" (max ${maxResults})`);

    try {
      const results = await duckduckgoSearch(query, maxResults);

      if (results.length === 0) {
        return {
          query,
          results: [],
          message: "No results found.",
        };
      }

      return {
        query,
        resultCount: results.length,
        results,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Search failed: ${message}` };
    }
  },
};
