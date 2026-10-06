import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../errors.js";
import type { AIRequest } from "../types.js";
import { createAIProvider, type AIProviderConfig } from "./factory.js";

const baseConfig: AIProviderConfig = {
  AI_PROVIDER: "gemini",
  AI_MODEL: null,
  AI_TIMEOUT_MS: 45_000,
  GEMINI_API_KEY: "gemini-key",
  OPENROUTER_API_KEY: null,
};

const request: AIRequest = {
  systemInstruction: "system instruction",
  prompt: "user prompt",
  schema: { type: "object" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(response: Response) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createAIProvider", () => {
  it("defaults to the gemini provider", async () => {
    const fetchMock = stubFetch(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
    );

    await createAIProvider(baseConfig).generate(request);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("gemini-flash-latest");
  });

  it("selects openrouter when configured", async () => {
    const fetchMock = stubFetch(jsonResponse({ choices: [{ message: { content: "{}" } }] }));

    await createAIProvider({
      ...baseConfig,
      AI_PROVIDER: "openrouter",
      AI_MODEL: "google/gemma-4-26b-a4b-it:free",
      GEMINI_API_KEY: null,
      OPENROUTER_API_KEY: "openrouter-key",
    }).generate(request);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer openrouter-key",
    );
    expect(JSON.parse(init.body as string).model).toBe("google/gemma-4-26b-a4b-it:free");
  });

  it("passes AI_MODEL through to the selected provider", async () => {
    const fetchMock = stubFetch(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
    );

    await createAIProvider({ ...baseConfig, AI_MODEL: "custom-model" }).generate(request);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("custom-model");
  });

  it("does not require credentials for the provider that is not selected", async () => {
    const fetchMock = stubFetch(jsonResponse({ choices: [{ message: { content: "{}" } }] }));

    await createAIProvider({
      ...baseConfig,
      AI_PROVIDER: "openrouter",
      AI_MODEL: "some/model",
      GEMINI_API_KEY: null,
      OPENROUTER_API_KEY: "openrouter-key",
    }).generate(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails at call time, not construction, when the selected provider has no credentials", async () => {
    const fetchMock = stubFetch(jsonResponse({}));

    const provider = createAIProvider({ ...baseConfig, GEMINI_API_KEY: null });
    const error = await provider.generate(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).status).toBe(500);
    expect((error as AiError).code).toBe("not_configured");
    expect((error as AiError).message).toContain("GEMINI_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a clear error for an unsupported provider", () => {
    expect(() => createAIProvider({ ...baseConfig, AI_PROVIDER: "vertex" })).toThrow(
      'Unsupported AI_PROVIDER "vertex". Supported values: gemini, openrouter.',
    );
  });
});
