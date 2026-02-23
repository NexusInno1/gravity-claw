import { describe, it, expect } from "vitest";
import { splitMessage } from "../src/bot/typing.js";

describe("splitMessage", () => {
  const MAX = 4096;

  // ── Short messages ─────────────────────────────────────

  it("returns a single chunk for short messages", () => {
    const result = splitMessage("Hello world", MAX);
    expect(result).toEqual(["Hello world"]);
  });

  it("returns a single chunk for empty string", () => {
    const result = splitMessage("", MAX);
    expect(result).toEqual([""]);
  });

  it("returns a single chunk at exactly maxLength", () => {
    const text = "a".repeat(MAX);
    const result = splitMessage(text, MAX);
    expect(result).toEqual([text]);
  });

  // ── Long messages ──────────────────────────────────────

  it("splits at newline boundaries for long messages", () => {
    // Build a message: 3000 chars + newline + 3000 chars = > 4096
    const part1 = "a".repeat(3000);
    const part2 = "b".repeat(3000);
    const text = `${part1}\n${part2}`;

    const result = splitMessage(text, MAX);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(part1);
    expect(result[1]).toBe(part2);
  });

  it("splits at space boundaries when no good newline", () => {
    // A single line longer than MAX
    const words = Array(500).fill("word123456").join(" ");
    const result = splitMessage(words, MAX);

    expect(result.length).toBeGreaterThan(1);
    // Every chunk should be <= MAX
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(MAX);
    }
    // Reassembling should give us back approximately the same content
    const joined = result.join(" ");
    expect(joined.length).toBeGreaterThan(0);
  });

  it("hard-splits when no newlines or spaces available", () => {
    // A single unbroken string longer than MAX
    const text = "x".repeat(MAX + 100);
    const result = splitMessage(text, MAX);

    expect(result.length).toBe(2);
    expect(result[0]!.length).toBe(MAX);
    expect(result[1]!.length).toBe(100);
  });

  // ── Multiple chunks ────────────────────────────────────

  it("handles very long messages that need 3+ chunks", () => {
    const text = Array(5).fill("a".repeat(3000)).join("\n");
    const result = splitMessage(text, MAX);
    expect(result.length).toBeGreaterThanOrEqual(4);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(MAX);
    }
  });

  // ── Small maxLength ────────────────────────────────────

  it("works with a small maxLength for testing", () => {
    const result = splitMessage("Hello World, this is a test!", 10);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
  });
});
