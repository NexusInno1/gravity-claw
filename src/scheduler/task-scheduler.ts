import cron, { type ScheduledTask } from "node-cron";
import { log } from "../logger.js";
import { getPineconeIndex } from "../memory/pinecone.js";
import type { Bot } from "grammy";
import { runAgentLoop } from "../agent/loop.js";
import type { ToolRegistry } from "../tools/registry.js";

// ── Scheduled Task Manager ───────────────────────────────

/** Embedding dimension must match the index (multilingual-e5-large = 1024) */
const ZERO_VECTOR = new Array(1024).fill(0);

export interface ScheduledTaskDef {
  id: string;
  userId: string;
  cronExpression: string;
  label: string;
  action: string; // prompt to send to agent loop
  paused: boolean;
  createdAt: number;
  nextLabel?: string; // human-readable next run
}

// Active cron jobs
const activeJobs = new Map<string, ScheduledTask>();

// In-memory cache of all tasks
let taskCache: ScheduledTaskDef[] = [];

// References set during init
let botRef: Bot | null = null;
let toolRegistryRef: ToolRegistry | null = null;

// ── Pinecone Persistence ─────────────────────────────────

/** Build a deterministic Pinecone record ID for a scheduled task. */
function taskRecordId(taskId: string): string {
  return `sched-${taskId}`;
}

async function readTasksFromPinecone(): Promise<ScheduledTaskDef[]> {
  try {
    const index = getPineconeIndex();
    // Query with zero vector to find all scheduled task records
    const result = await index.query({
      vector: ZERO_VECTOR,
      topK: 100,
      filter: { _type: { $eq: "scheduled_task" } },
      includeMetadata: true,
    });

    return (result.matches ?? [])
      .filter((m) => m.metadata)
      .map((m) => ({
        id: String(m.metadata!["taskId"] ?? ""),
        userId: String(m.metadata!["userId"] ?? ""),
        cronExpression: String(m.metadata!["cronExpression"] ?? ""),
        label: String(m.metadata!["label"] ?? ""),
        action: String(m.metadata!["action"] ?? ""),
        paused:
          m.metadata!["paused"] === true || m.metadata!["paused"] === "true",
        createdAt: Number(m.metadata!["createdAt"] ?? 0),
      }))
      .filter((t) => t.id && t.cronExpression);
  } catch (err) {
    log.warn(err, "⚠️ Failed to read tasks from Pinecone");
    return [];
  }
}

async function writeTaskToPinecone(task: ScheduledTaskDef): Promise<void> {
  try {
    const index = getPineconeIndex();
    await index.upsert({
      records: [
        {
          id: taskRecordId(task.id),
          values: ZERO_VECTOR,
          metadata: {
            _type: "scheduled_task",
            taskId: task.id,
            userId: task.userId,
            cronExpression: task.cronExpression,
            label: task.label,
            action: task.action.slice(0, 1000),
            paused: task.paused,
            createdAt: task.createdAt,
          },
        },
      ],
    });
  } catch (err) {
    log.warn(err, "⚠️ Failed to save task to Pinecone");
  }
}

async function deleteTaskFromPinecone(taskId: string): Promise<void> {
  try {
    const index = getPineconeIndex();
    await index.deleteOne({ id: taskRecordId(taskId) });
  } catch (err) {
    log.warn(err, "⚠️ Failed to delete task from Pinecone");
  }
}

function readTasks(): ScheduledTaskDef[] {
  return taskCache;
}

// ── Natural Language → Cron Parser ───────────────────────

const NL_PATTERNS: { regex: RegExp; cron: string }[] = [
  { regex: /every\s+minute/i, cron: "* * * * *" },
  { regex: /every\s+5\s*min/i, cron: "*/5 * * * *" },
  { regex: /every\s+10\s*min/i, cron: "*/10 * * * *" },
  { regex: /every\s+15\s*min/i, cron: "*/15 * * * *" },
  { regex: /every\s+30\s*min/i, cron: "*/30 * * * *" },
  { regex: /every\s+hour/i, cron: "0 * * * *" },
  { regex: /every\s+2\s*hours?/i, cron: "0 */2 * * *" },
  {
    regex: /every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    cron: "DYNAMIC_DAILY",
  },
  { regex: /every\s+morning/i, cron: "0 8 * * *" },
  { regex: /every\s+evening/i, cron: "0 18 * * *" },
  { regex: /every\s+night/i, cron: "0 21 * * *" },
  { regex: /every\s+monday/i, cron: "0 9 * * 1" },
  { regex: /every\s+tuesday/i, cron: "0 9 * * 2" },
  { regex: /every\s+wednesday/i, cron: "0 9 * * 3" },
  { regex: /every\s+thursday/i, cron: "0 9 * * 4" },
  { regex: /every\s+friday/i, cron: "0 9 * * 5" },
  { regex: /every\s+saturday/i, cron: "0 9 * * 6" },
  { regex: /every\s+sunday/i, cron: "0 9 * * 0" },
  { regex: /every\s+weekday/i, cron: "0 9 * * 1-5" },
  { regex: /every\s+weekend/i, cron: "0 10 * * 0,6" },
];

export function parseSchedule(input: string): string | null {
  // If it's already a valid cron expression, use it directly
  if (cron.validate(input)) return input;

  // Try natural language patterns
  for (const pattern of NL_PATTERNS) {
    const match = input.match(pattern.regex);
    if (match) {
      if (pattern.cron === "DYNAMIC_DAILY") {
        let hour = parseInt(match[1]!, 10);
        const minute = match[2] ? parseInt(match[2], 10) : 0;
        const ampm = match[3]?.toLowerCase();
        if (ampm === "pm" && hour < 12) hour += 12;
        if (ampm === "am" && hour === 12) hour = 0;
        return `${minute} ${hour} * * *`;
      }
      return pattern.cron;
    }
  }

  return null;
}

// ── Task CRUD ────────────────────────────────────────────

export function createTask(
  userId: string,
  cronExpression: string,
  action: string,
  label: string,
): ScheduledTaskDef {
  const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const task: ScheduledTaskDef = {
    id,
    userId,
    cronExpression,
    label,
    action,
    paused: false,
    createdAt: Date.now(),
  };

  taskCache.push(task);
  void writeTaskToPinecone(task);

  // Start the cron job
  startJob(task);

  log.info({ id, label, cronExpression }, "⏰ Task created");
  return task;
}

export function listTasks(userId: string): ScheduledTaskDef[] {
  return readTasks().filter((t) => t.userId === userId);
}

export function pauseTask(taskId: string): boolean {
  const task = taskCache.find((t) => t.id === taskId);
  if (!task) return false;

  task.paused = true;
  void writeTaskToPinecone(task);

  const job = activeJobs.get(taskId);
  if (job) job.stop();

  log.info({ taskId }, "⏸️ Task paused");
  return true;
}

export function resumeTask(taskId: string): boolean {
  const task = taskCache.find((t) => t.id === taskId);
  if (!task) return false;

  task.paused = false;
  void writeTaskToPinecone(task);

  startJob(task);

  log.info({ taskId }, "▶️ Task resumed");
  return true;
}

export function deleteTask(taskId: string): boolean {
  const idx = taskCache.findIndex((t) => t.id === taskId);
  if (idx === -1) return false;

  taskCache.splice(idx, 1);
  void deleteTaskFromPinecone(taskId);

  const job = activeJobs.get(taskId);
  if (job) {
    job.stop();
    activeJobs.delete(taskId);
  }

  log.info({ taskId }, "🗑️ Task deleted");
  return true;
}

// ── Job Execution ────────────────────────────────────────

function startJob(task: ScheduledTaskDef): void {
  // Stop existing job if any
  const existing = activeJobs.get(task.id);
  if (existing) existing.stop();

  if (task.paused) return;

  const job = cron.schedule(
    task.cronExpression,
    async () => {
      log.info({ id: task.id, label: task.label }, "⏰ Executing task");

      if (!botRef || !toolRegistryRef) {
        log.warn("⚠️ Bot or tool registry not initialised for task execution");
        return;
      }

      try {
        // Run the action through the agent loop
        const result = await runAgentLoop(
          task.action,
          toolRegistryRef,
          task.userId,
        );

        // Send the result to the user via Telegram
        const userId = parseInt(task.userId, 10);
        const message = `⏰ *Scheduled: ${task.label}*\n\n${result.response}`;
        await botRef.api
          .sendMessage(userId, message, { parse_mode: "Markdown" })
          .catch(() => botRef!.api.sendMessage(userId, message));

        log.info({ id: task.id }, "  ✅ Task executed successfully");
      } catch (err) {
        log.error(err, "  ❌ Task execution failed");
      }
    },
    { timezone: "Asia/Kolkata" },
  );

  job.start();
  activeJobs.set(task.id, job);
}

// ── Init — restore tasks from Pinecone ──────────────────

export async function initTaskScheduler(
  bot: Bot,
  toolRegistry: ToolRegistry,
): Promise<void> {
  botRef = bot;
  toolRegistryRef = toolRegistry;

  // Load tasks from Pinecone into cache
  taskCache = await readTasksFromPinecone();

  let restored = 0;
  for (const task of taskCache) {
    if (!task.paused) {
      startJob(task);
      restored++;
    }
  }

  if (taskCache.length > 0) {
    log.info(
      { restored, total: taskCache.length },
      "⏰ Scheduled tasks restored from Pinecone",
    );
  }
}
