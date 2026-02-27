export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  execute: (input: Record<string, unknown>) => Promise<any>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getGeminiTools() {
    return [
      {
        functionDeclarations: Array.from(this.tools.values()).map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }
}
