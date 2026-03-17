/**
 * Sub-Agent Types & Configuration
 *
 * Defines the permission model and spawn options used by the
 * sub-agent manager to restrict which tools each agent can access.
 */

// ─── Tool Permissions ────────────────────────────────────────────

/**
 * Controls which tools a sub-agent can use.
 *
 * - **Allowlist mode**: set `allowedTools` → only those tools are available.
 * - **Denylist mode**: set `deniedTools` → all tools except those are available.
 * - **Full access**: omit both → the sub-agent gets every tool.
 *
 * If both are provided, `allowedTools` wins.
 */
export interface ToolPermissions {
    /** If set, ONLY these tools are available (allowlist mode). */
    allowedTools?: string[];
    /** If set, these tools are blocked (denylist mode). Ignored when allowedTools is set. */
    deniedTools?: string[];
}

// ─── Spawn Options ───────────────────────────────────────────────

/**
 * Options bag for spawning a new sub-agent.
 */
export interface SubAgentOptions {
    /** The task / prompt for the sub-agent to execute. */
    task: string;
    /** Chat ID of the requester (results are reported back here). */
    chatId: string;
    /** Tool permission restrictions.  Omit for full access. */
    permissions?: ToolPermissions;
    /** Max agentic loop iterations (defaults to the loop's built-in limit). */
    maxIterations?: number;
}
