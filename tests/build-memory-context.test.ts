import { describe, it, expect } from "vitest";
import { buildMemoryContext } from "../src/memory/context-builder.js";
import type { MemoryContext } from "../src/memory/types.js";

function makeContext(overrides: Partial<MemoryContext> = {}): MemoryContext {
  return {
    recentMessages: [],
    semanticMatches: [],
    facts: {},
    ...overrides,
  };
}

describe("buildMemoryContext", () => {
  // ── Empty context ──────────────────────────────────────

  it("returns empty string when no facts or semantic matches", () => {
    const result = buildMemoryContext(makeContext());
    expect(result).toBe("");
  });

  // ── Facts only ─────────────────────────────────────────

  it("renders facts section when facts are present", () => {
    const ctx = makeContext({
      facts: {
        name: "Nikhil",
        role: "Builder",
      },
    });
    const result = buildMemoryContext(ctx);
    expect(result).toContain("KNOWN FACTS ABOUT THE USER");
    expect(result).toContain("• name: Nikhil");
    expect(result).toContain("• role: Builder");
  });

  it("renders single fact correctly", () => {
    const ctx = makeContext({ facts: { timezone: "IST" } });
    const result = buildMemoryContext(ctx);
    expect(result).toContain("• timezone: IST");
  });

  // ── Semantic matches only ──────────────────────────────

  it("renders semantic matches section", () => {
    const now = Date.now();
    const ctx = makeContext({
      semanticMatches: [
        {
          role: "user",
          content: "I'm working on Gravity Claw",
          timestamp: now - 3600000, // 1 hour ago
        },
        {
          role: "assistant",
          content: "Noted! Gravity Claw is your AI agent project",
          timestamp: now - 3500000,
        },
      ],
    });

    const result = buildMemoryContext(ctx);
    expect(result).toContain("RELEVANT MEMORIES");
    expect(result).toContain("User said");
    expect(result).toContain("You replied");
  });

  it("sorts semantic matches oldest → newest", () => {
    const now = Date.now();
    const ctx = makeContext({
      semanticMatches: [
        {
          role: "user",
          content: "Second message",
          timestamp: now - 1000,
        },
        {
          role: "user",
          content: "First message",
          timestamp: now - 5000,
        },
      ],
    });

    const result = buildMemoryContext(ctx);
    const firstIdx = result.indexOf("First message");
    const secondIdx = result.indexOf("Second message");
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it("truncates long content to 200 chars", () => {
    const now = Date.now();
    const longContent = "x".repeat(500);
    const ctx = makeContext({
      semanticMatches: [
        {
          role: "user",
          content: longContent,
          timestamp: now - 1000,
        },
      ],
    });

    const result = buildMemoryContext(ctx);
    // The displayed content should be sliced to 200 chars
    expect(result).not.toContain("x".repeat(201));
  });

  // ── Both facts + semantic matches ──────────────────────

  it("renders both sections when both are present", () => {
    const now = Date.now();
    const ctx = makeContext({
      facts: { name: "Nikhil" },
      semanticMatches: [
        {
          role: "user",
          content: "Hello there",
          timestamp: now - 60000,
        },
      ],
    });

    const result = buildMemoryContext(ctx);
    expect(result).toContain("KNOWN FACTS ABOUT THE USER");
    expect(result).toContain("RELEVANT MEMORIES");
    // Facts should come before memories
    const factsIdx = result.indexOf("KNOWN FACTS");
    const memoriesIdx = result.indexOf("RELEVANT MEMORIES");
    expect(factsIdx).toBeLessThan(memoriesIdx);
  });

  // ── Time formatting ────────────────────────────────────

  it("shows 'just now' for very recent messages", () => {
    const ctx = makeContext({
      semanticMatches: [
        {
          role: "user",
          content: "test",
          timestamp: Date.now() - 5000, // 5 seconds ago
        },
      ],
    });

    const result = buildMemoryContext(ctx);
    expect(result).toContain("just now");
  });

  it("shows minutes ago for recent messages", () => {
    const ctx = makeContext({
      semanticMatches: [
        {
          role: "user",
          content: "test",
          timestamp: Date.now() - 300000, // 5 minutes ago
        },
      ],
    });

    const result = buildMemoryContext(ctx);
    expect(result).toContain("5m ago");
  });

  it("shows hours ago for older messages", () => {
    const ctx = makeContext({
      semanticMatches: [
        {
          role: "user",
          content: "test",
          timestamp: Date.now() - 7200000, // 2 hours ago
        },
      ],
    });

    const result = buildMemoryContext(ctx);
    expect(result).toContain("2h ago");
  });

  it("shows days ago for multi-day messages", () => {
    const ctx = makeContext({
      semanticMatches: [
        {
          role: "user",
          content: "test",
          timestamp: Date.now() - 259200000, // 3 days ago
        },
      ],
    });

    const result = buildMemoryContext(ctx);
    expect(result).toContain("3d ago");
  });
});
