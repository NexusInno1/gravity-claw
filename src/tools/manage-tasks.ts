import type { ToolDefinition } from "./registry.js";
import {
  listTasks,
  pauseTask,
  resumeTask,
  deleteTask,
} from "../scheduler/task-scheduler.js";

// ── Manage Tasks Tool ────────────────────────────────────

export const manageTasks: ToolDefinition = {
  name: "manage_tasks",
  description: `List, pause, resume, or delete scheduled tasks.
Actions:
- "list": Show all scheduled tasks for the user
- "pause": Pause a task by ID (keeps it saved but stops execution)
- "resume": Resume a paused task
- "delete": Permanently delete a task`,

  parameters: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["list", "pause", "resume", "delete"],
        description: "The action to perform on scheduled tasks.",
      },
      task_id: {
        type: "string",
        description: "Task ID (required for pause/resume/delete).",
      },
      user_id: {
        type: "string",
        description: "The user's ID. Use the current user's ID.",
      },
    },
    required: ["action"],
  },

  execute: async (input: Record<string, unknown>) => {
    const action = input.action as string;
    const taskId = input.task_id as string;
    const userId = (input.user_id as string) || "default";

    switch (action) {
      case "list": {
        const tasks = listTasks(userId);
        if (tasks.length === 0) {
          return { tasks: [], message: "No scheduled tasks found." };
        }
        return {
          tasks: tasks.map((t) => ({
            id: t.id,
            label: t.label,
            schedule: t.cronExpression,
            action: t.action,
            paused: t.paused,
            createdAt: new Date(t.createdAt).toISOString(),
          })),
          message: `Found ${tasks.length} scheduled task(s).`,
        };
      }

      case "pause": {
        if (!taskId) return { error: "task_id is required for pause." };
        const ok = pauseTask(taskId);
        return ok
          ? { success: true, message: `Task ${taskId} paused.` }
          : { error: `Task ${taskId} not found.` };
      }

      case "resume": {
        if (!taskId) return { error: "task_id is required for resume." };
        const ok = resumeTask(taskId);
        return ok
          ? { success: true, message: `Task ${taskId} resumed.` }
          : { error: `Task ${taskId} not found.` };
      }

      case "delete": {
        if (!taskId) return { error: "task_id is required for delete." };
        const ok = deleteTask(taskId);
        return ok
          ? { success: true, message: `Task ${taskId} deleted.` }
          : { error: `Task ${taskId} not found.` };
      }

      default:
        return { error: `Unknown action: ${action}` };
    }
  },
};
