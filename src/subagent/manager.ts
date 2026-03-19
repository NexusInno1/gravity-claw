/**
 * Sub-Agent Manager
 *
 * Spawns background agent runs that execute independently in their own
 * session. When a sub-agent finishes, it announces the result back to
 * the requester chat channel via a callback.
 *
 * Each sub-agent gets:
 *   - A unique ID for tracking
 *   - Its own isolated chat context (separate chatId for memory scoping)
 *   - A dedicated task prompt
 *   - A configurable set of tool permissions (allow/deny/full access)
 *
 * Sub-agents run fully asynchronously — the parent can continue
 * responding while sub-agents work in the background.
 */

import { runAgentLoop } from "../agent/loop.js";
import type { SubAgentOptions, ToolPermissions } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────

export type SubAgentStatus = "running" | "completed" | "failed";

export interface SubAgentRun {
  /** Unique identifier for this sub-agent run */
  id: string;
  /** The task/prompt given to the sub-agent */
  task: string;
  /** The chat ID that requested this sub-agent */
  requesterChatId: string;
  /** Isolated chat ID used for the sub-agent's own memory scope */
  sessionChatId: string;
  /** Current status */
  status: SubAgentStatus;
  /** Tool permissions applied to this run */
  permissions?: ToolPermissions;
  /** The final result (set when completed) */
  result?: string;
  /** Error message (set when failed) */
  error?: string;
  /** Timestamp when the sub-agent was spawned */
  startedAt: Date;
  /** Timestamp when the sub-agent finished */
  finishedAt?: Date;
}

/** Callback to send the sub-agent's result back to the requester chat */
type ReportCallback = (chatId: string, message: string) => Promise<void>;

// ─── State ───────────────────────────────────────────────────────

/** All tracked sub-agent runs (keyed by ID) */
const runs = new Map<string, SubAgentRun>();

/** The callback used to announce results back to the chat */
let reportCallback: ReportCallback | null = null;

/** Auto-incrementing counter for generating readable IDs */
let idCounter = 0;

// ─── API ─────────────────────────────────────────────────────────

/**
 * Initialize the sub-agent manager with a callback for sending results.
 * Must be called once during startup (after the channel is ready).
 */
export function initSubAgentReporter(callback: ReportCallback): void {
  reportCallback = callback;
  console.log("[SubAgent] Reporter callback initialized.");
}

/**
 * Generate a unique, human-readable sub-agent ID.
 */
function generateId(): string {
  idCounter++;
  const timestamp = Date.now().toString(36);
  return `sa-${timestamp}-${idCounter}`;
}

/**
 * Describe the permission mode for logging / status reports.
 */
function describePermissions(permissions?: ToolPermissions): string {
  if (!permissions) return "full access";
  if (permissions.allowedTools && permissions.allowedTools.length > 0) {
    return `allow: [${permissions.allowedTools.join(", ")}]`;
  }
  if (permissions.deniedTools && permissions.deniedTools.length > 0) {
    return `deny: [${permissions.deniedTools.join(", ")}]`;
  }
  return "full access";
}

/**
 * Spawn a new sub-agent that runs the given task in the background.
 *
 * The sub-agent runs the full agent loop (with tools, memory, etc.)
 * in its own isolated session, restricted to the specified tool
 * permissions.  When done, it reports back to the requester chat.
 *
 * @param options  Sub-agent spawn configuration
 * @returns        The sub-agent run info (with ID for tracking)
 */
export function spawnSubAgent(options: SubAgentOptions): SubAgentRun {
  const id = generateId();
  const sessionChatId = `subagent_${id}`;

  const run: SubAgentRun = {
    id,
    task: options.task,
    requesterChatId: options.chatId,
    sessionChatId,
    status: "running",
    permissions: options.permissions,
    startedAt: new Date(),
  };

  runs.set(id, run);

  const permDesc = describePermissions(options.permissions);
  console.log(`[SubAgent] Spawned "${id}" for chat ${options.chatId} (${permDesc})`);
  console.log(`[SubAgent] Task: ${options.task.substring(0, 100)}...`);

  // Fire and forget — runs in the background
  executeSubAgent(run, options.maxIterations).catch((err) => {
    console.error(`[SubAgent] Unexpected error in "${id}":`, err);
  });

  return run;
}

/**
 * Internal: Execute the sub-agent's task and report back.
 */
async function executeSubAgent(
  run: SubAgentRun,
  maxIterations?: number,
): Promise<void> {
  try {
    // Compute the effective tool filter from permissions
    const allowed = run.permissions?.allowedTools;
    const denied = run.permissions?.deniedTools;

    // Run the agent loop with tool restrictions
    const result = await runAgentLoop(
      run.task,
      run.sessionChatId,
      allowed,
      denied,
      maxIterations,
    );

    run.status = "completed";
    run.result = result;
    run.finishedAt = new Date();

    console.log(`[SubAgent] "${run.id}" completed successfully.`);

    // Report back to the requester chat
    await reportResult(run);
  } catch (error) {
    run.status = "failed";
    run.error = String(error);
    run.finishedAt = new Date();

    console.error(`[SubAgent] "${run.id}" failed:`, error);

    // Report failure back
    await reportResult(run);
  }
}

/**
 * Send the sub-agent's result back to the requester chat channel.
 */
async function reportResult(run: SubAgentRun): Promise<void> {
  if (!reportCallback) {
    console.warn(
      `[SubAgent] No reporter callback — result for "${run.id}" will not be sent.`,
    );
    return;
  }

  const duration = run.finishedAt
    ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
    : 0;

  const permDesc = describePermissions(run.permissions);
  let message: string;

  if (run.status === "completed") {
    message =
      `🤖 **Sub-Agent Complete** (${duration}s)\n` +
      `📋 *Task:* ${run.task}\n` +
      `🔧 *Tools:* ${permDesc}\n\n` +
      `${run.result}`;
  } else {
    message =
      `❌ **Sub-Agent Failed** (${duration}s)\n` +
      `📋 *Task:* ${run.task}\n` +
      `🔧 *Tools:* ${permDesc}\n\n` +
      `Error: ${run.error}`;
  }

  try {
    await reportCallback(run.requesterChatId, message);
  } catch (err) {
    console.error(`[SubAgent] Failed to report result for "${run.id}":`, err);
  }
}

/**
 * Get the status of a specific sub-agent run by ID.
 */
export function getSubAgentStatus(id: string): SubAgentRun | undefined {
  return runs.get(id);
}

/**
 * Get all sub-agent runs for a specific chat, optionally filtered by status.
 */
export function getSubAgentsByChatId(
  chatId: string,
  statusFilter?: SubAgentStatus,
): SubAgentRun[] {
  const results: SubAgentRun[] = [];
  for (const run of runs.values()) {
    if (run.requesterChatId === chatId) {
      if (!statusFilter || run.status === statusFilter) {
        results.push(run);
      }
    }
  }
  return results;
}

/**
 * List all active (running) sub-agents across all chats.
 */
export function getActiveSubAgents(): SubAgentRun[] {
  return Array.from(runs.values()).filter((r) => r.status === "running");
}

/**
 * Build a formatted status string for all sub-agents in a chat.
 */
export function buildSubAgentStatusReport(chatId: string): string {
  const chatRuns = getSubAgentsByChatId(chatId);

  if (chatRuns.length === 0) {
    return "No sub-agents have been spawned in this chat.";
  }

  const lines: string[] = ["**🤖 Sub-Agent Status**\n"];

  for (const run of chatRuns) {
    const statusEmoji =
      run.status === "running"
        ? "🔄"
        : run.status === "completed"
          ? "✅"
          : "❌";

    const duration = run.finishedAt
      ? `${Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)}s`
      : "in progress";

    const taskPreview =
      run.task.length > 60 ? run.task.substring(0, 60) + "..." : run.task;

    const permDesc = describePermissions(run.permissions);

    lines.push(
      `${statusEmoji} \`${run.id}\` — ${taskPreview} (${duration}) [${permDesc}]`,
    );
  }

  return lines.join("\n");
}
