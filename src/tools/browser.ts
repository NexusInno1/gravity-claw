import type { ToolDefinition } from "./registry.js";
import { getPage, takeScreenshot } from "./browser-manager.js";

// ── Browser Automation Tool ──────────────────────────────

export const browserTool: ToolDefinition = {
  name: "browser",
  description: `Automate a real Chromium browser. Use this for scraping, navigating websites, filling forms, or taking screenshots.
Actions:
- "navigate": Go to a URL, returns page title and text snippet
- "click": Click an element by CSS selector
- "type": Type text into an input field by CSS selector
- "screenshot": Take a screenshot of the current page
- "extract": Extract text content from the page or a specific selector
- "evaluate": Run arbitrary JavaScript in the page context

The browser persists between calls — you can navigate, then click, then extract across multiple tool calls.`,

  parameters: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "navigate",
          "click",
          "type",
          "screenshot",
          "extract",
          "evaluate",
        ],
        description: "The browser action to perform.",
      },
      url: {
        type: "string",
        description: "URL to navigate to (for 'navigate' action).",
      },
      selector: {
        type: "string",
        description:
          "CSS selector for the target element (for 'click', 'type', 'extract' actions).",
      },
      text: {
        type: "string",
        description: "Text to type into the element (for 'type' action).",
      },
      script: {
        type: "string",
        description:
          "JavaScript code to execute in the page (for 'evaluate' action).",
      },
      user_id: {
        type: "string",
        description:
          "User ID for session isolation. Use the current user's ID.",
      },
    },
    required: ["action"],
  },

  execute: async (input: Record<string, unknown>) => {
    const action = input.action as string;
    const userId = (input.user_id as string) || "default";

    try {
      switch (action) {
        case "navigate": {
          const url = input.url as string;
          if (!url) return { error: "URL is required for navigate action." };

          console.log(`  🌐 Navigating to: ${url}`);
          const page = await getPage(userId);
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });

          const title = await page.title();
          const textSnippet = await page
            .evaluate(() => {
              const body = document.body?.innerText || "";
              return body.slice(0, 1000);
            })
            .catch(() => "(could not extract text)");

          return {
            success: true,
            title,
            url: page.url(),
            textSnippet,
          };
        }

        case "click": {
          const selector = input.selector as string;
          if (!selector)
            return { error: "Selector is required for click action." };

          console.log(`  🖱️ Clicking: ${selector}`);
          const page = await getPage(userId);
          await page.click(selector, { timeout: 5000 });

          return { success: true, clicked: selector };
        }

        case "type": {
          const selector = input.selector as string;
          const text = input.text as string;
          if (!selector || !text)
            return {
              error: "Both selector and text are required for type action.",
            };

          console.log(`  ⌨️ Typing into: ${selector}`);
          const page = await getPage(userId);
          await page.fill(selector, text, { timeout: 5000 });

          return { success: true, typed: text, into: selector };
        }

        case "screenshot": {
          console.log("  📸 Taking screenshot...");
          const filepath = await takeScreenshot(userId);

          return {
            success: true,
            path: filepath,
            message:
              "Screenshot saved. The file is stored locally on the server.",
          };
        }

        case "extract": {
          const selector = input.selector as string;
          const page = await getPage(userId);

          let content: string;
          if (selector) {
            console.log(`  📄 Extracting from: ${selector}`);
            content = await page
              .locator(selector)
              .first()
              .innerText({ timeout: 5000 });
          } else {
            console.log("  📄 Extracting full page text");
            content = await page.evaluate(() => {
              return document.body?.innerText || "";
            });
          }

          // Trim to reasonable size for LLM context
          const trimmed = content.slice(0, 3000);

          return {
            success: true,
            content: trimmed,
            truncated: content.length > 3000,
            fullLength: content.length,
          };
        }

        case "evaluate": {
          const script = input.script as string;
          if (!script)
            return { error: "Script is required for evaluate action." };

          console.log(`  ⚡ Evaluating JS: ${script.slice(0, 80)}...`);
          const page = await getPage(userId);
          const result = await page.evaluate(script);

          return {
            success: true,
            result:
              typeof result === "object"
                ? JSON.stringify(result)
                : String(result),
          };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Browser ${action} failed: ${message}`);
      return { error: `Browser ${action} failed: ${message}` };
    }
  },
};
