import type { ToolDefinition } from "./registry.js";

export const getCurrentTime: ToolDefinition = {
  name: "get_current_time",
  description:
    'Get the current date and time. Optionally specify an IANA timezone (e.g. "Asia/Kolkata", "America/New_York"). Defaults to UTC.',
  parameters: {
    type: "object" as const,
    properties: {
      timezone: {
        type: "string",
        description:
          'IANA timezone string (e.g. "Asia/Kolkata", "Europe/London"). Defaults to "UTC".',
      },
    },
    required: [],
  },

  execute: async (input: Record<string, unknown>) => {
    const timezone = (input.timezone as string) || "UTC";
    try {
      const now = new Date();
      const formatted = now.toLocaleString("en-US", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "long",
      });
      return {
        time: formatted,
        timezone,
        iso: now.toISOString(),
      };
    } catch {
      return { error: `Invalid timezone: "${timezone}"` };
    }
  },
};
