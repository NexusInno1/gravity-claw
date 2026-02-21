import type { ChatCompletionTool } from "openai/resources/chat/completions.js";

// ── Tool Definition ──────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

// ── Tool Registry ────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Returns tool definitions in the OpenAI function-calling format. */
  getOpenAITools(): ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /** Execute a tool by name. Returns the result or an error object. */
  async execute(
    name: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { error: `Unknown tool: ${name}` };
    }
    try {
      return await tool.execute(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Tool "${name}" failed: ${message}` };
    }
  }
}
