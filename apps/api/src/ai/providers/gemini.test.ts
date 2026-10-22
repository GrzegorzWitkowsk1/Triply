import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../errors.js";
import type { AIRequest } from "../types.js";
import { createGeminiProvider, type GeminiConfig } from "./gemini.js";

const config: GeminiConfig = {
  apiKey: "gemini-key",
  model: "gemini-test",
  timeoutMs: 12_345,
};

const schema = {
  type: "object",
  properties: { destination: { type: "string", nullable: true } },
  required: ["destination"],
};

const request: AIRequest = {
  systemInstruction: "system instruction",
  prompt: "user prompt",
  schema,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(text: string): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function stubFetch(response: Response) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function stubFetchError(error: unknown) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => {
    throw error;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function expectAiError(
  promise: Promise<unknown>,
  expected: { status: number; message?: RegExp | string; code?: string },
): Promise<AiError> {
  const error = await promise.catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(AiError);
  expect((error as AiError).status).toBe(expected.status);
  if (expected.code) {
    expect((error as AiError).code).toBe(expected.code);
  }
  if (expected.message) {
    expect((error as AiError).message).toMatch(expected.message);
  }

  return error as AiError;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GeminiProvider", () => {
  it("sends the generateContent request with schema and API key", async () => {
    const fetchMock = stubFetch(textResponse("{}"));

    await createGeminiProvider(config).generate(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "gemini-key",
    });

    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "system instruction" }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "user prompt" }] }]);
    expect(body.generationConfig).toEqual({
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.2,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the parsed JSON from the first candidate", async () => {
    stubFetch(textResponse('{"destination":"Barcelona"}'));

    const result = await createGeminiProvider(config).generate(request);

    expect(result).toEqual({ destination: "Barcelona" });
  });

  it("reports blocked prompts from promptFeedback", async () => {
    stubFetch(jsonResponse({ candidates: [], promptFeedback: { blockReason: "SAFETY" } }));

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 502,
      code: "invalid_response",
      message: /blocked: SAFETY/,
    });
  });

  it("reports the finish reason when no text was returned", async () => {
    stubFetch(
      jsonResponse({
        candidates: [{ content: { parts: [] }, finishReason: "RECITATION" }],
      }),
    );

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 502,
      message: /finish reason: RECITATION/,
    });
  });

  it("maps rate limiting to 503", async () => {
    stubFetch(jsonResponse({ error: { message: "quota exceeded" } }, 429));

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 503,
      code: "rate_limited",
      message: "The AI service is busy right now. Please try again in a moment.",
    });
  });

  it("maps upstream unavailability to 503", async () => {
    stubFetch(jsonResponse({ error: { message: "overloaded" } }, 503));

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 503,
      message: "The AI service is busy right now. Please try again in a moment.",
    });
  });

  it("maps invalid credentials to 500", async () => {
    stubFetch(jsonResponse({ error: { message: "bad key" } }, 401));

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 500,
      code: "invalid_credentials",
      message: "The AI service rejected the configured credentials.",
    });
  });

  it("maps other upstream failures to 502", async () => {
    stubFetch(jsonResponse({ error: { message: "boom" } }, 500));

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 502,
      code: "unavailable",
      message: "The AI service could not complete the request.",
    });
  });

  it("maps timeouts to 504", async () => {
    stubFetchError(Object.assign(new Error("aborted"), { name: "TimeoutError" }));

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 504,
      code: "timeout",
      message: "The AI service took too long to respond. Please try again.",
    });
  });

  it("maps network failures to 502", async () => {
    stubFetchError(new TypeError("fetch failed"));

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 502,
      code: "unreachable",
      message: "The AI service is unreachable. Please try again.",
    });
  });

  it("rejects unreadable response bodies", async () => {
    stubFetch(new Response("<html>oops</html>", { status: 200 }));

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 502,
      code: "invalid_response",
      message: "The AI service returned an unreadable response.",
    });
  });

  it("rejects candidates that contain non-JSON output", async () => {
    stubFetch(textResponse("not json at all"));

    await expectAiError(createGeminiProvider(config).generate(request), {
      status: 502,
      code: "invalid_response",
    });
    expect(console.error).toHaveBeenCalledWith("[ai] gemini returned non-JSON output");
  });

  it("fails without an API key and never calls the network", async () => {
    const fetchMock = stubFetch(textResponse("{}"));

    await expectAiError(
      createGeminiProvider({ ...config, apiKey: null }).generate(request),
      {
        status: 500,
        code: "not_configured",
        message: "GEMINI_API_KEY is not configured on the server.",
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("combines caller cancellation with the Gemini timeout signal", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.signal?.aborted).toBe(false);
    controller.abort();
    expect(init?.signal?.aborted).toBe(true);
    throw new DOMException("Aborted", "AbortError");
  }));
  await expect(createGeminiProvider(config).generate({ ...request, signal: controller.signal })).rejects.toBeInstanceOf(AiError);
});
