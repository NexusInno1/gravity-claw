/**
 * Tests for LLM Router — Provider Dispatch & Fallback Logic
 *
 * Validates that models are routed to the correct provider and
 * that Gemini failures trigger the Groq fallback correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the router by mocking provider modules before importing the router.
// This avoids hitting real APIs while verifying dispatch + fallback behavior.

// ─── Mocks ────────────────────────────────────────────────────────

const mockGeminiChat = vi.fn();
const mockGroqChat = vi.fn();

vi.mock("../lib/gemini.js", () => ({
    geminiProvider: { chat: (...args: unknown[]) => mockGeminiChat(...args) },
}));

vi.mock("../lib/groq.js", () => ({
    groqProvider: { chat: (...args: unknown[]) => mockGroqChat(...args) },
}));

// Mock ENV — Groq only, no OpenRouter
vi.mock("../config.js", () => ({
    ENV: {
        GROQ_API_KEY: "test-groq-key",
        GROQ_MODEL: "llama-3.3-70b-versatile",
        GEMINI_API_KEYS: ["key-1", "key-2"],
    },
}));

// ─── Import after mocks ───────────────────────────────────────────

import { routedChat, getProviderName } from "../lib/router.js";
import type { LLMCallParams, LLMResponse } from "../lib/llm.js";

// ─── Helpers ──────────────────────────────────────────────────────

function makeParams(model: string): LLMCallParams {
    return {
        model,
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
    };
}

const MOCK_RESPONSE: LLMResponse = {
    text: "Mock response",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};

// ─── Tests ────────────────────────────────────────────────────────

describe("getProviderName", () => {
    it("returns 'Gemini' for gemini- prefixed models", () => {
        expect(getProviderName("gemini-2.5-flash")).toBe("Gemini");
        expect(getProviderName("gemini-3-flash-preview")).toBe("Gemini");
    });

    it("returns 'Groq' for groq/ prefixed models", () => {
        expect(getProviderName("groq/llama-3.3-70b-versatile")).toBe("Groq");
        expect(getProviderName("groq/mixtral-8x7b-32768")).toBe("Groq");
    });
});

describe("routedChat — Model Routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGeminiChat.mockResolvedValue(MOCK_RESPONSE);
        mockGroqChat.mockResolvedValue(MOCK_RESPONSE);
    });

    it("routes gemini- models to Gemini provider", async () => {
        await routedChat(makeParams("gemini-2.5-flash"));

        expect(mockGeminiChat).toHaveBeenCalledTimes(1);
        expect(mockGroqChat).not.toHaveBeenCalled();
    });

    it("routes groq/ models directly to Groq provider", async () => {
        await routedChat(makeParams("groq/llama-3.3-70b-versatile"));

        expect(mockGroqChat).toHaveBeenCalledTimes(1);
        expect(mockGeminiChat).not.toHaveBeenCalled();
        // Verify the groq/ prefix is stripped before calling the provider
        expect(mockGroqChat.mock.calls[0][0].model).toBe("llama-3.3-70b-versatile");
    });

    it("returns the LLM response from the correct provider", async () => {
        const geminiResult: LLMResponse = { text: "From Gemini" };
        const groqResult: LLMResponse = { text: "From Groq" };
        mockGeminiChat.mockResolvedValue(geminiResult);
        mockGroqChat.mockResolvedValue(groqResult);

        const r1 = await routedChat(makeParams("gemini-2.5-flash"));
        expect(r1.text).toBe("From Gemini");

        const r2 = await routedChat(makeParams("groq/llama-3.3-70b-versatile"));
        expect(r2.text).toBe("From Groq");
    });
});

describe("routedChat — Fallback Behavior", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGroqChat.mockResolvedValue(MOCK_RESPONSE);
    });

    it("falls back to Groq on Gemini 429", async () => {
        mockGeminiChat.mockRejectedValue({ status: 429, message: "quota exceeded" });

        const result = await routedChat(makeParams("gemini-2.5-flash"));

        expect(mockGeminiChat).toHaveBeenCalledTimes(1);
        expect(mockGroqChat).toHaveBeenCalledTimes(1);
        // Verify fallback used the configured Groq model
        expect(mockGroqChat.mock.calls[0][0].model).toBe("llama-3.3-70b-versatile");
        expect(result.text).toBe("Mock response");
    });

    it("falls back to Groq on Gemini 404 (model not found)", async () => {
        mockGeminiChat.mockRejectedValue({ status: 404, message: "model not found" });

        const result = await routedChat(makeParams("gemini-2.5-flash"));

        expect(mockGroqChat).toHaveBeenCalledTimes(1);
        expect(result.text).toBe("Mock response");
    });

    it("falls back to Groq on Gemini 503 (service unavailable)", async () => {
        mockGeminiChat.mockRejectedValue({ status: 503, message: "service unavailable" });

        const result = await routedChat(makeParams("gemini-2.5-flash"));

        expect(mockGroqChat).toHaveBeenCalledTimes(1);
        expect(result.text).toBe("Mock response");
    });

    it("does NOT fall back on Gemini 400 (bad request — real bug)", async () => {
        const error = { status: 400, message: "invalid request" };
        mockGeminiChat.mockRejectedValue(error);

        await expect(routedChat(makeParams("gemini-2.5-flash"))).rejects.toEqual(error);
        expect(mockGroqChat).not.toHaveBeenCalled();
    });

    it("does NOT fall back on Gemini 401 (unauthorized — config error)", async () => {
        const error = { status: 401, message: "unauthorized" };
        mockGeminiChat.mockRejectedValue(error);

        await expect(routedChat(makeParams("gemini-2.5-flash"))).rejects.toEqual(error);
        expect(mockGroqChat).not.toHaveBeenCalled();
    });

    it("throws original Gemini error when Groq fallback also fails", async () => {
        const geminiError = { status: 429, message: "quota exceeded" };
        const groqError = new Error("Groq exploded");
        mockGeminiChat.mockRejectedValue(geminiError);
        mockGroqChat.mockRejectedValue(groqError);

        // Should throw the ORIGINAL Gemini error, not the Groq fallback error
        await expect(routedChat(makeParams("gemini-2.5-flash"))).rejects.toEqual(geminiError);
    });

    it("does NOT attempt fallback for groq/ model failures", async () => {
        const error = new Error("Groq is down");
        mockGroqChat.mockRejectedValue(error);

        await expect(routedChat(makeParams("groq/llama-3.3-70b-versatile"))).rejects.toThrow("Groq is down");
        expect(mockGroqChat).toHaveBeenCalledTimes(1);
        expect(mockGeminiChat).not.toHaveBeenCalled();
    });
});
