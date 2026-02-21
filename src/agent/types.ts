export interface AgentResult {
  /** The final text response from the agent. */
  response: string;
  /** Number of tool calls made during this run. */
  toolCalls: number;
  /** Number of LLM round-trips taken. */
  iterations: number;
  /** Total input tokens used. */
  inputTokens: number;
  /** Total output tokens used. */
  outputTokens: number;
  /** Total latency in milliseconds. */
  latencyMs: number;
}
