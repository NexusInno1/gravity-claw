import type { ToolDefinition } from "./registry.js";
import { log } from "../logger.js";

// ── Read URL Tool ────────────────────────────────────────

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  return (
    html
      // Remove script and style blocks entirely
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, "")
      // Replace block-level tags with newlines
      .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Strip remaining tags
      .replace(/<[^>]*>/g, "")
      // Decode common entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Collapse whitespace
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export const readUrl: ToolDefinition = {
  name: "read_url",
  description:
    "Fetch a URL and extract its readable text content. Use this to read articles, blog posts, documentation, or any web page the user wants summarized or analyzed. Returns plain text stripped of HTML.",

  parameters: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "The full URL to fetch, e.g. 'https://example.com/article'.",
      },
      max_length: {
        type: "number",
        description:
          "Maximum characters to return (default: 8000). Truncates if the page is longer.",
      },
    },
    required: ["url"],
  },

  execute: async (input: Record<string, unknown>) => {
    const url = input.url as string;
    const maxLength = Math.min(Number(input.max_length ?? 8000), 15000);

    if (!url?.trim()) {
      return { error: "URL cannot be empty." };
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return {
        error: `Invalid URL: "${url}". Include the full URL with https://`,
      };
    }

    log.info({ url }, "🔗 Fetching URL content");

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15000), // 15s timeout
      });

      if (!response.ok) {
        return {
          error: `HTTP ${response.status}: ${response.statusText}`,
          url,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      const html = await response.text();

      // If it's plain text or JSON, return as-is
      if (
        contentType.includes("text/plain") ||
        contentType.includes("application/json")
      ) {
        const text = html.slice(0, maxLength);
        return {
          url,
          contentType,
          charCount: text.length,
          content: text,
          truncated: html.length > maxLength,
        };
      }

      // Extract text from HTML
      // Try to find the main content area first
      let mainContent = html;

      // Try to extract <article> or <main> content
      const articleMatch = html.match(
        /<article[\s\S]*?>([\s\S]*?)<\/article>/i,
      );
      const mainMatch = html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);

      if (articleMatch) {
        mainContent = articleMatch[1]!;
      } else if (mainMatch) {
        mainContent = mainMatch[1]!;
      }

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? stripHtml(titleMatch[1]!) : "";

      const text = stripHtml(mainContent).slice(0, maxLength);

      return {
        url,
        title,
        charCount: text.length,
        content: text,
        truncated: stripHtml(mainContent).length > maxLength,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Failed to fetch URL: ${msg}`, url };
    }
  },
};
