import type { ToolDefinition } from "./registry.js";
import {
  broadcastCanvas,
  getCanvasClientCount,
  type CanvasPayload,
} from "../canvas/server.js";
import { log } from "../logger.js";

// ── Push Canvas — A2UI Tool ─────────────────────────────

export const pushCanvas: ToolDefinition = {
  name: "push_canvas",
  description: `Push interactive widgets to the user's Live Canvas (a browser-based dashboard).
Use this to display rich content that doesn't fit in a text message:
- "chart": Chart.js chart (bar, line, pie, doughnut, radar, etc.)
- "table": Data table with headers and rows
- "markdown": Formatted markdown document
- "form": Interactive form with input fields
- "html": Raw HTML/JS/CSS widget

The canvas is at http://localhost:3100. Tell the user to open it if they haven't.
Currently ${getCanvasClientCount()} client(s) connected.`,

  parameters: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["chart", "table", "markdown", "form", "html"],
        description:
          "Widget type to push. 'chart' expects Chart.js config, 'table' expects {headers, rows}, 'form' expects {fields, submitLabel}.",
      },
      title: {
        type: "string",
        description: "Title shown above the widget on the canvas.",
      },
      content: {
        type: "object",
        description: `The widget content. Format depends on type:
- chart: Full Chart.js config object, e.g. {type:"bar", data:{labels:[...], datasets:[...]}, options:{...}}
- table: {headers: string[], rows: string[][]}
- markdown: A string of markdown text (pass as string in the object)
- form: {fields: [{name, type, label, placeholder?, options?}], submitLabel: string}
- html: A string of raw HTML (pass as string in the object)`,
      },
    },
    required: ["type", "title", "content"],
  },

  execute: async (input: Record<string, unknown>) => {
    const type = input.type as CanvasPayload["type"];
    const title = (input.title as string) || "Widget";
    const content = input.content;

    if (!type || !content) {
      return { error: "Both 'type' and 'content' are required." };
    }

    const clientCount = getCanvasClientCount();

    const payload: CanvasPayload = {
      id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      title,
      content,
      timestamp: Date.now(),
    };

    broadcastCanvas(payload);

    log.info({ type, title, clientCount }, "  🖼️ Canvas push");

    return {
      success: true,
      widgetId: payload.id,
      clientsReached: clientCount,
      message:
        clientCount > 0
          ? `Widget "${title}" pushed to ${clientCount} canvas client(s).`
          : `Widget "${title}" queued. No canvas clients connected. Tell the user to open http://localhost:3100`,
    };
  },
};
