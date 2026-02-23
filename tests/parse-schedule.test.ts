import { describe, it, expect } from "vitest";
import { parseSchedule } from "../src/scheduler/task-scheduler.js";

describe("parseSchedule", () => {
  // ── Natural Language ───────────────────────────────────

  it("parses 'every day at 6pm' → cron", () => {
    expect(parseSchedule("every day at 6pm")).toBe("0 18 * * *");
  });

  it("parses 'every day at 6:30pm' → cron with minutes", () => {
    expect(parseSchedule("every day at 6:30pm")).toBe("30 18 * * *");
  });

  it("parses 'every day at 12am' → midnight", () => {
    expect(parseSchedule("every day at 12am")).toBe("0 0 * * *");
  });

  it("parses 'every day at 12pm' → noon", () => {
    expect(parseSchedule("every day at 12pm")).toBe("0 12 * * *");
  });

  it("parses 'every day at 9' → 9:00 (no am/pm)", () => {
    expect(parseSchedule("every day at 9")).toBe("0 9 * * *");
  });

  it("parses 'every morning' → 8:00", () => {
    expect(parseSchedule("every morning")).toBe("0 8 * * *");
  });

  it("parses 'every evening' → 18:00", () => {
    expect(parseSchedule("every evening")).toBe("0 18 * * *");
  });

  it("parses 'every night' → 21:00", () => {
    expect(parseSchedule("every night")).toBe("0 21 * * *");
  });

  // ── Day-of-week ────────────────────────────────────────

  it("parses 'every monday' → Monday at 9am", () => {
    expect(parseSchedule("every monday")).toBe("0 9 * * 1");
  });

  it("parses 'every friday' → Friday at 9am", () => {
    expect(parseSchedule("every friday")).toBe("0 9 * * 5");
  });

  it("parses 'every weekday' → M-F at 9am", () => {
    expect(parseSchedule("every weekday")).toBe("0 9 * * 1-5");
  });

  it("parses 'every weekend' → Sat+Sun at 10am", () => {
    expect(parseSchedule("every weekend")).toBe("0 10 * * 0,6");
  });

  // ── Intervals ──────────────────────────────────────────

  it("parses 'every minute' → every minute", () => {
    expect(parseSchedule("every minute")).toBe("* * * * *");
  });

  it("parses 'every 5 min' → every 5 minutes", () => {
    expect(parseSchedule("every 5 min")).toBe("*/5 * * * *");
  });

  it("parses 'every 30 minutes' → every 30 minutes", () => {
    expect(parseSchedule("every 30 minutes")).toBe("*/30 * * * *");
  });

  it("parses 'every hour' → every hour", () => {
    expect(parseSchedule("every hour")).toBe("0 * * * *");
  });

  it("parses 'every 2 hours' → every 2 hours", () => {
    expect(parseSchedule("every 2 hours")).toBe("0 */2 * * *");
  });

  // ── Raw cron passthrough ───────────────────────────────

  it("passes through a valid cron expression unchanged", () => {
    expect(parseSchedule("0 9 * * 1-5")).toBe("0 9 * * 1-5");
  });

  it("passes through '*/15 * * * *'", () => {
    expect(parseSchedule("*/15 * * * *")).toBe("*/15 * * * *");
  });

  // ── Invalid input ──────────────────────────────────────

  it("returns null for unparseable input", () => {
    expect(parseSchedule("banana")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSchedule("")).toBeNull();
  });

  it("returns null for random sentence", () => {
    expect(parseSchedule("remind me later")).toBeNull();
  });
});
