import { afterEach, describe, expect, it, vi } from "vitest";
import { readPrivateResponse } from "./privateResponse.js";
import { createOpenRouterProvider } from "./providers/openrouter.js";
import { createGeminiProvider } from "./providers/gemini.js";
import type { AIRequest } from "./types.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request: AIRequest = { prompt: "PRIVATE DOCUMENT", systemInstruction: "Extract travel facts", schema: { type: "object" }, privateContext: true, maxOutputTokens: 3000, timeoutMs: 30000 };
describe("private attachment provider boundaries", () => {
  it("bounds response bytes and cancels the stream", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel }));
    await expect(readPrivateResponse(response)).resolves.toBeNull(); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["openrouter", "gemini"] as const)("redacts upstream errors for %s", async name => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "PRIVATE DOCUMENT echoed upstream" } }, { status: 503 })));
    const provider = name === "openrouter" ? createOpenRouterProvider({ apiKey: "fixture", model: "fixture", timeoutMs: 45000 }) : createGeminiProvider({ apiKey: "fixture", model: "fixture", timeoutMs: 45000 });
    await expect(provider.generate(request)).rejects.toThrow(); expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE DOCUMENT");
  });
  it.each(["openrouter", "gemini"] as const)("sends an explicit bounded text request for %s", async name => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => Response.json(name === "openrouter" ? { choices: [{ message: { content: "{}" } }] } : { candidates: [{ content: { parts: [{ text: "{}" }] } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = name === "openrouter" ? createOpenRouterProvider({ apiKey: "fixture", model: "fixture", timeoutMs: 45000 }) : createGeminiProvider({ apiKey: "fixture", model: "fixture", timeoutMs: 45000 });
    await provider.generate(request); const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(name === "openrouter" ? body.max_tokens : body.generationConfig.maxOutputTokens).toBe(3000);
    expect(body.model ?? "fixture").toBe("fixture");
  });
});
