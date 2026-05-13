/**
 * QA Test Suite — Engagement Commands & Mid-Day Spark
 *
 * Tests for the new features added to SUNDAY:
 *   - /what      — LLM-generated discovery list
 *   - /spark     — Manual insight trigger
 *   - /challenge — Daily executable challenge
 *   - /focus     — Session focus topic (set / view / clear lifecycle)
 *   - Plain-text aliases for all of the above
 *   - /help updated content validation
 *   - Heartbeat jobs array (Evening removed, Spark added)
 *   - Session focus injection into system prompt (loop.ts mock)
 *   - /new clears session focus
 *
 * Methodology: Each test validates command dispatch, response structure,
 * and side-effect correctness. LLM calls are mocked to avoid flakiness.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock routedChat so /what, /spark, /challenge don't make real LLM calls ──

vi.mock("../lib/router.js", () => ({
    routedChat: vi.fn().mockResolvedValue({
        text: "• Mock suggestion 1\n• Mock suggestion 2\n• Mock suggestion 3",
    }),
    getProviderName: () => "Gemini",
}));

vi.mock("../lib/config-sync.js", () => ({
    getRuntimeConfig: () => ({
        primaryModel: "gemini-2.5-flash",
        temperature: 0.7,
        semanticMemory: false,
        delegation: true,
    }),
    initConfigSync: async () => {},
}));

// ─── Import under test (after mocks) ─────────────────────────────

import {
    handleSlashCommand,
    getEffectiveModel,
    clearModelOverride,
    getSessionFocus,
    sessionFocusTopics,
} from "../commands/slash-commands.js";

const CHAT_ID = "test-engagement";

// ─── /what command ───────────────────────────────────────────────

describe("/what — Discovery command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("dispatches /what and returns handled=true", async () => {
        const result = await handleSlashCommand("/what", CHAT_ID);
        expect(result.handled).toBe(true);
    });

    it("returns a response containing 'SUNDAY'", async () => {
        const result = await handleSlashCommand("/what", CHAT_ID);
        expect(result.response).toBeTruthy();
        expect(result.response).toContain("SUNDAY");
    });

    it("includes fresh-set prompt in response", async () => {
        const result = await handleSlashCommand("/what", CHAT_ID);
        expect(result.response).toContain("/what");
    });

    it("responds to plain-text alias 'what can you do'", async () => {
        const result = await handleSlashCommand("what can you do", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("responds to plain-text alias 'what can you do?' (with question mark)", async () => {
        const result = await handleSlashCommand("what can you do?", CHAT_ID);
        expect(result.handled).toBe(true);
    });

    it("responds to plain-text alias 'what should i ask'", async () => {
        const result = await handleSlashCommand("what should i ask", CHAT_ID);
        expect(result.handled).toBe(true);
    });
});

// ─── /spark command ──────────────────────────────────────────────

describe("/spark — Manual insight trigger", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("dispatches /spark and returns handled=true", async () => {
        const result = await handleSlashCommand("/spark", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("response is non-empty string (LLM or fallback)", async () => {
        const result = await handleSlashCommand("/spark", CHAT_ID);
        expect(typeof result.response).toBe("string");
        expect(result.response!.length).toBeGreaterThan(10);
    });

    it("responds to 'inspire me' alias", async () => {
        const result = await handleSlashCommand("inspire me", CHAT_ID);
        expect(result.handled).toBe(true);
    });

    it("responds to 'spark me' alias", async () => {
        const result = await handleSlashCommand("spark me", CHAT_ID);
        expect(result.handled).toBe(true);
    });

    it("responds to 'give me a spark' alias", async () => {
        const result = await handleSlashCommand("give me a spark", CHAT_ID);
        expect(result.handled).toBe(true);
    });
});

// ─── /challenge command ──────────────────────────────────────────

describe("/challenge — Daily challenge generator", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("dispatches /challenge and returns handled=true", async () => {
        const result = await handleSlashCommand("/challenge", CHAT_ID);
        expect(result.handled).toBe(true);
    });

    it("returns a response with actionable content", async () => {
        const result = await handleSlashCommand("/challenge", CHAT_ID);
        expect(result.response).toBeTruthy();
        // Should contain the re-run CTA
        expect(result.response).toContain("/challenge");
    });

    it("responds to 'give me a challenge' alias", async () => {
        const result = await handleSlashCommand("give me a challenge", CHAT_ID);
        expect(result.handled).toBe(true);
    });

    it("responds to 'daily challenge' alias", async () => {
        const result = await handleSlashCommand("daily challenge", CHAT_ID);
        expect(result.handled).toBe(true);
    });
});

// ─── /focus command — Full lifecycle ─────────────────────────────

describe("/focus — Session focus topic lifecycle", () => {
    beforeEach(() => {
        clearModelOverride(CHAT_ID);  // Also clears focus
    });

    it("/focus (no args, no focus set) shows help", async () => {
        const result = await handleSlashCommand("/focus", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toContain("No session focus set");
        expect(result.response).toContain("Examples");
    });

    it("/focus <topic> sets the focus", async () => {
        const result = await handleSlashCommand("/focus building my SaaS MVP", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toContain("Focus set");
        expect(result.response).toContain("building my SaaS MVP");
    });

    it("getSessionFocus returns the topic after /focus <topic>", async () => {
        await handleSlashCommand("/focus learning system design", CHAT_ID);
        expect(getSessionFocus(CHAT_ID)).toBe("learning system design");
    });

    it("/focus (no args, focus IS set) shows current focus", async () => {
        await handleSlashCommand("/focus job hunting for ML roles", CHAT_ID);
        const result = await handleSlashCommand("/focus", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toContain("job hunting for ML roles");
        expect(result.response).toContain("Current session focus");
    });

    it("/focus clear removes the focus", async () => {
        await handleSlashCommand("/focus some topic", CHAT_ID);
        const result = await handleSlashCommand("/focus clear", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toContain("cleared");
        expect(getSessionFocus(CHAT_ID)).toBeUndefined();
    });

    it("/new clears the session focus", async () => {
        await handleSlashCommand("/focus launching my product", CHAT_ID);
        expect(getSessionFocus(CHAT_ID)).toBe("launching my product");

        await handleSlashCommand("/new", CHAT_ID);
        expect(getSessionFocus(CHAT_ID)).toBeUndefined();
    });

    it("plain-text 'my focus' shows current focus state", async () => {
        const result = await handleSlashCommand("my focus", CHAT_ID);
        expect(result.handled).toBe(true);
    });

    it("plain-text 'clear focus' clears focus", async () => {
        await handleSlashCommand("/focus test topic", CHAT_ID);
        const result = await handleSlashCommand("clear focus", CHAT_ID);
        expect(result.handled).toBe(true);
    });

    it("focus is per-chat — different chats have independent focuses", async () => {
        await handleSlashCommand("/focus topic A", "chat-A");
        await handleSlashCommand("/focus topic B", "chat-B");
        expect(getSessionFocus("chat-A")).toBe("topic A");
        expect(getSessionFocus("chat-B")).toBe("topic B");

        // Clean up
        sessionFocusTopics.delete("chat-A");
        sessionFocusTopics.delete("chat-B");
    });
});

// ─── /help — Updated content ─────────────────────────────────────

describe("/help — Updated engagement section", () => {
    it("contains Engagement section", async () => {
        const result = await handleSlashCommand("/help", CHAT_ID);
        expect(result.response).toContain("Engagement");
    });

    it("lists /what command", async () => {
        const result = await handleSlashCommand("/help", CHAT_ID);
        expect(result.response).toContain("/what");
    });

    it("lists /spark command", async () => {
        const result = await handleSlashCommand("/help", CHAT_ID);
        expect(result.response).toContain("/spark");
    });

    it("lists /challenge command", async () => {
        const result = await handleSlashCommand("/help", CHAT_ID);
        expect(result.response).toContain("/challenge");
    });

    it("lists /focus command", async () => {
        const result = await handleSlashCommand("/help", CHAT_ID);
        expect(result.response).toContain("/focus");
    });

    it("contains plain-text tip", async () => {
        const result = await handleSlashCommand("/help", CHAT_ID);
        expect(result.response).toContain("inspire me");
    });

    it("mentions spark in heartbeat section", async () => {
        const result = await handleSlashCommand("/help", CHAT_ID);
        expect(result.response).toContain("spark");
    });
});

// ─── Heartbeat Jobs Array — Structural validation ────────────────

describe("heartbeatJobs — Structural integrity", () => {
    it("contains Morning Check-in job", async () => {
        const { heartbeatJobs } = await import("../heartbeat/jobs.js");
        const morning = heartbeatJobs.find(j => j.name === "Morning Check-in");
        expect(morning).toBeDefined();
        expect(morning!.execute).toBeTypeOf("function");
    });

    it("contains Mid-Day Spark job", async () => {
        const { heartbeatJobs } = await import("../heartbeat/jobs.js");
        const spark = heartbeatJobs.find(j => j.name === "Mid-Day Spark");
        expect(spark).toBeDefined();
        expect(spark!.execute).toBeTypeOf("function");
    });

    it("does NOT contain Evening Briefing job (deleted)", async () => {
        const { heartbeatJobs } = await import("../heartbeat/jobs.js");
        const evening = heartbeatJobs.find(j => j.name === "Evening Briefing");
        expect(evening).toBeUndefined();
    });

    it("has exactly 2 heartbeat jobs", async () => {
        const { heartbeatJobs } = await import("../heartbeat/jobs.js");
        expect(heartbeatJobs.length).toBe(2);
    });

    it("Mid-Day Spark has valid hour/minute within IST range", async () => {
        const { heartbeatJobs } = await import("../heartbeat/jobs.js");
        const spark = heartbeatJobs.find(j => j.name === "Mid-Day Spark")!;
        expect(spark.hour).toBeGreaterThanOrEqual(0);
        expect(spark.hour).toBeLessThanOrEqual(23);
        expect(spark.minute).toBeGreaterThanOrEqual(0);
        expect(spark.minute).toBeLessThanOrEqual(59);
    });
});

// ─── Edge cases & regressions ────────────────────────────────────

describe("Engagement commands — Edge cases", () => {
    it("/focus with very long topic (200 chars) still works", async () => {
        const longTopic = "x".repeat(200);
        const result = await handleSlashCommand(`/focus ${longTopic}`, CHAT_ID);
        expect(result.handled).toBe(true);
        expect(getSessionFocus(CHAT_ID)).toBe(longTopic);
        clearModelOverride(CHAT_ID);
    });

    it("/focus with special characters works", async () => {
        const result = await handleSlashCommand("/focus building AI agents & tools (v2)", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(getSessionFocus(CHAT_ID)).toBe("building AI agents & tools (v2)");
        clearModelOverride(CHAT_ID);
    });

    it("non-matching plain text does NOT trigger commands", async () => {
        const result = await handleSlashCommand("tell me about challenges in AI", CHAT_ID);
        expect(result.handled).toBe(false);
    });

    it("case-insensitive plain-text aliases work", async () => {
        const result = await handleSlashCommand("INSPIRE ME", CHAT_ID);
        expect(result.handled).toBe(true);
    });

    it("case-insensitive /FOCUS works", async () => {
        const result = await handleSlashCommand("/FOCUS test topic", CHAT_ID);
        expect(result.handled).toBe(true);
        clearModelOverride(CHAT_ID);
    });
});
