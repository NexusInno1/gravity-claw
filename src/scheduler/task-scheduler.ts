import cron, { type ScheduledTask } from "node-cron";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Bot } from "grammy";
import { runAgentLoop } from "../agent/loop.js";
import type { ToolRegistry } from "../tools/registry.js";

// ── Scheduled Task Manager ───────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const TASKS_FILE = join(DATA_DIR, "scheduled-tasks.json");

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

// References set during init
let botRef: Bot | null = null;
let toolRegistryRef: ToolRegistry | null = null;

// ── Persistence ──────────────────────────────────────────

function readTasks(): ScheduledTaskDef[] {
  if (!existsSync(TASKS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(TASKS_FILE, "utf-8")) as ScheduledTaskDef[];
  } catch {
    return [];
  }
}

function writeTasks(tasks: ScheduledTaskDef[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
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

  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);

  // Start the cron job
  startJob(task);

  console.log(`⏰ Task created: [${id}] "${label}" — ${cronExpression}`);
  return task;
}

export function listTasks(userId: string): ScheduledTaskDef[] {
  return readTasks().filter((t) => t.userId === userId);
}

export function pauseTask(taskId: string): boolean {
  const tasks = readTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return false;

  task.paused = true;
  writeTasks(tasks);

  const job = activeJobs.get(taskId);
  if (job) job.stop();

  console.log(`⏸️ Task paused: [${taskId}]`);
  return true;
}

export function resumeTask(taskId: string): boolean {
  const tasks = readTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return false;

  task.paused = false;
  writeTasks(tasks);

  startJob(task);

  console.log(`▶️ Task resumed: [${taskId}]`);
  return true;
}

export function deleteTask(taskId: string): boolean {
  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return false;

  tasks.splice(idx, 1);
  writeTasks(tasks);

  const job = activeJobs.get(taskId);
  if (job) {
    job.stop();
    activeJobs.delete(taskId);
  }

  console.log(`🗑️ Task deleted: [${taskId}]`);
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
      console.log(`⏰ Executing task: [${task.id}] "${task.label}"`);

      if (!botRef || !toolRegistryRef) {
        console.warn(
          "⚠️ Bot or tool registry not initialised for task execution",
        );
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

        console.log(`  ✅ Task [${task.id}] executed successfully`);
      } catch (err) {
        console.error(`  ❌ Task [${task.id}] failed:`, err);
      }
    },
    { timezone: "Asia/Kolkata" },
  );

  job.start();
  activeJobs.set(task.id, job);
}

// ── Init — restore tasks from disk ──────────────────────

export function initTaskScheduler(bot: Bot, toolRegistry: ToolRegistry): void {
  botRef = bot;
  toolRegistryRef = toolRegistry;

  const tasks = readTasks();
  let restored = 0;
  for (const task of tasks) {
    if (!task.paused) {
      startJob(task);
      restored++;
    }
  }

  if (tasks.length > 0) {
    console.log(`⏰ Restored ${restored}/${tasks.length} scheduled task(s)`);
  }
}
