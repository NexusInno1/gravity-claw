// ── Usage Tracking ───────────────────────────────────────
// Logs every LLM call: model, tokens, cost estimate, latency.
// In-memory store — resets on restart. Exposed via /usage.

export interface UsageEntry {
  timestamp: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  costEstimate: number; // USD estimate
}

// Rough per-1K-token pricing for common models (input/output)
const PRICING: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-4-20250514": { input: 0.003, output: 0.015 },
  "openai/gpt-4o": { input: 0.0025, output: 0.01 },
  "meta-llama/llama-3.3-70b-instruct:free": { input: 0, output: 0 },
  "arcee-ai/trinity-large-preview:free": { input: 0, output: 0 },
  "google/gemini-2.0-flash-exp:free": { input: 0, output: 0 },
};

class UsageTracker {
  private entries: UsageEntry[] = [];
  private startTime = new Date();

  log(
    model: string,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
  ): UsageEntry {
    const pricing = PRICING[model] ?? { input: 0.001, output: 0.005 };
    const costEstimate =
      (inputTokens / 1000) * pricing.input +
      (outputTokens / 1000) * pricing.output;

    const entry: UsageEntry = {
      timestamp: new Date(),
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs,
      costEstimate,
    };

    this.entries.push(entry);
    return entry;
  }

  /** Summary stats for the /usage command. */
  getSummary(): string {
    if (this.entries.length === 0) {
      return "📊 No usage data yet. Send a message first!";
    }

    const totalCalls = this.entries.length;
    const totalInput = this.entries.reduce((s, e) => s + e.inputTokens, 0);
    const totalOutput = this.entries.reduce((s, e) => s + e.outputTokens, 0);
    const totalCost = this.entries.reduce((s, e) => s + e.costEstimate, 0);
    const avgLatency =
      this.entries.reduce((s, e) => s + e.latencyMs, 0) / totalCalls;
    const model = this.entries[this.entries.length - 1].model;
    const uptime = this.getUptime();

    return [
      "📊 *Usage Stats*",
      "────────────────────",
      `⏱ Uptime: ${uptime}`,
      `🤖 Model: \`${model}\``,
      `📞 Total calls: ${totalCalls}`,
      `📥 Input tokens: ${totalInput.toLocaleString()}`,
      `📤 Output tokens: ${totalOutput.toLocaleString()}`,
      `📦 Total tokens: ${(totalInput + totalOutput).toLocaleString()}`,
      `⚡ Avg latency: ${Math.round(avgLatency)}ms`,
      `💰 Est. cost: $${totalCost.toFixed(6)}`,
    ].join("\n");
  }

  getUptime(): string {
    const ms = Date.now() - this.startTime.getTime();
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const hours = Math.floor(mins / 60);

    if (hours > 0) return `${hours}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${secs % 60}s`;
    return `${secs}s`;
  }

  getCallCount(): number {
    return this.entries.length;
  }
}

// Singleton
export const usageTracker = new UsageTracker();
