import type { ToolDefinition } from "./registry.js";
import { createTask, parseSchedule } from "../scheduler/task-scheduler.js";

// ── Schedule Task Tool ───────────────────────────────────

export const scheduleTask: ToolDefinition = {
  name: "schedule_task",
  description: `Create a recurring scheduled task. The task will run on a cron schedule and execute a prompt through the agent loop, sending the result to the user via Telegram.

Supports both cron expressions and natural language:
- "every day at 6pm" → runs daily at 18:00
- "every morning" → runs daily at 8:00
- "every monday" → runs weekly on Monday at 9:00
- "every 30 minutes" → runs every 30 min
- "0 9 * * 1-5" → standard cron (weekdays at 9am)

The action is a prompt that gets processed by the AI agent each time the task runs.`,

  parameters: {
    type: "object" as const,
    properties: {
      schedule: {
        type: "string",
        description:
          "When to run. Accepts cron expressions or natural language like 'every day at 6pm', 'every morning', 'every weekday', etc.",
      },
      action: {
        type: "string",
        description:
          "The prompt to execute each time. E.g. 'Give me a motivational quote' or 'Remind me to drink water'.",
      },
      label: {
        type: "string",
        description:
          "Human-friendly name for this task. E.g. 'Daily water reminder'.",
      },
      user_id: {
        type: "string",
        description: "The user's ID. Use the current user's ID.",
      },
    },
    required: ["schedule", "action", "label"],
  },

  execute: async (input: Record<string, unknown>) => {
    const scheduleInput = input.schedule as string;
    const action = input.action as string;
    const label = input.label as string;
    const userId = (input.user_id as string) || "default";

    if (!scheduleInput || !action || !label) {
      return { error: "schedule, action, and label are all required." };
    }

    // Parse the schedule
    const cronExpr = parseSchedule(scheduleInput);
    if (!cronExpr) {
      return {
        error: `Could not parse schedule: "${scheduleInput}". Use a cron expression or natural language like "every day at 6pm".`,
      };
    }

    const task = createTask(userId, cronExpr, action, label);

    return {
      success: true,
      taskId: task.id,
      label: task.label,
      cronExpression: task.cronExpression,
      schedule: scheduleInput,
      message: `Task "${label}" created. It will run on schedule: ${cronExpr}`,
    };
  },
};
