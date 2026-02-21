import type { ToolDefinition } from "./registry.js";
import {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  getWebhookUrl,
} from "../webhooks/webhook-manager.js";

// ── Webhook Management Tool ──────────────────────────────

export const webhookTool: ToolDefinition = {
  name: "manage_webhooks",
  description: `Create, list, or delete webhook endpoints. Webhooks let external services (CI/CD, monitoring, APIs) trigger the agent via HTTP POST.

When created, a webhook gets a URL like: http://localhost:3100/webhook/<id>
Any POST to that URL triggers the agent with the payload data.

Actions:
- "create": Create a new webhook endpoint
- "list": List all webhooks for the user
- "delete": Delete a webhook by ID`,

  parameters: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "delete"],
        description: "The webhook action to perform.",
      },
      id: {
        type: "string",
        description:
          "Webhook ID (URL slug). Use lowercase with hyphens. E.g. 'deploy-notify', 'github-push'.",
      },
      description: {
        type: "string",
        description: "Human-friendly description of what this webhook does.",
      },
      user_id: {
        type: "string",
        description: "The user's ID.",
      },
    },
    required: ["action"],
  },

  execute: async (input: Record<string, unknown>) => {
    const action = input.action as string;
    const id = input.id as string;
    const description = (input.description as string) || "";
    const userId = (input.user_id as string) || "default";

    switch (action) {
      case "create": {
        if (!id) return { error: "id is required for creating a webhook." };
        if (!description) return { error: "description is required." };

        try {
          const webhook = registerWebhook(id, userId, description);
          const url = getWebhookUrl(id);

          return {
            success: true,
            webhookId: webhook.id,
            url,
            description: webhook.description,
            message: `Webhook created! POST to: ${url}`,
            example: `curl -X POST ${url} -H "Content-Type: application/json" -d '{"status": "success"}'`,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      }

      case "list": {
        const webhooks = listWebhooks(userId);
        if (webhooks.length === 0) {
          return { webhooks: [], message: "No webhooks configured." };
        }
        return {
          webhooks: webhooks.map((w) => ({
            id: w.id,
            url: getWebhookUrl(w.id),
            description: w.description,
            triggerCount: w.triggerCount,
            createdAt: new Date(w.createdAt).toISOString(),
          })),
          message: `Found ${webhooks.length} webhook(s).`,
        };
      }

      case "delete": {
        if (!id) return { error: "id is required for deleting a webhook." };
        const ok = deleteWebhook(id);
        return ok
          ? { success: true, message: `Webhook "${id}" deleted.` }
          : { error: `Webhook "${id}" not found.` };
      }

      default:
        return { error: `Unknown action: ${action}` };
    }
  },
};
