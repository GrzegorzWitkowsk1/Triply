import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../errors.js";
import type { AIRequest } from "../types.js";
import { createOpenRouterProvider, type OpenRouterConfig } from "./openrouter.js";

const config: OpenRouterConfig = {
  apiKey: "openrouter-key",
  model: "google/gemma-4-26b-a4b-it:free",
  timeoutMs: 9_876,
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

function completionResponse(content: string, finishReason?: string): Response {
  return jsonResponse({
    choices: [{ message: { content }, ...(finishReason ? { finish_reason: finishReason } : {}) }],
  });
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

describe("OpenRouterProvider", () => {
  it("sends an OpenAI-compatible chat completion request", async () => {
    const fetchMock = stubFetch(completionResponse("{}"));

    await createOpenRouterProvider(config).generate(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer openrouter-key",
    });

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("google/gemma-4-26b-a4b-it:free");
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("system instruction");
    expect(body.messages[0].content).toContain('"type": "object"');
    expect(body.messages[1]).toEqual({ role: "user", content: "user prompt" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the parsed JSON content", async () => {
    stubFetch(completionResponse('{"destination":"Barcelona"}'));

    const result = await createOpenRouterProvider(config).generate(request);

    expect(result).toEqual({ destination: "Barcelona" });
  });

  it("parses content wrapped in a markdown fence", async () => {
    stubFetch(completionResponse('```json\n{"destination":"Barcelona"}\n```'));

    const result = await createOpenRouterProvider(config).generate(request);

    expect(result).toEqual({ destination: "Barcelona" });
  });

  it("parses JSON embedded in surrounding prose", async () => {
    stubFetch(completionResponse('Sure! Here is the JSON:\n{"destination":"Barcelona"}'));

    const result = await createOpenRouterProvider(config).generate(request);

    expect(result).toEqual({ destination: "Barcelona" });
  });

  it("reports an empty completion using the finish reason", async () => {
    stubFetch(jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "length" }] }));

    await expectAiError(createOpenRouterProvider(config).generate(request), {
      status: 502,
      code: "invalid_response",
      message: /finish reason: length/,
    });
  });

  it("rejects completions that contain non-JSON output", async () => {
    stubFetch(completionResponse("I cannot answer that."));

    await expectAiError(createOpenRouterProvider(config).generate(request), {
      status: 502,
      code: "invalid_response",
      message: "The AI service returned an unreadable response.",
    });
    expect(console.error).toHaveBeenCalledWith("[ai] openrouter returned non-JSON output");
  });

  it("maps rate limiting to 503 and logs the upstream message", async () => {
    stubFetch(jsonResponse({ error: { message: "rate limit reached" } }, 429));

    await expectAiError(createOpenRouterProvider(config).generate(request), {
      status: 503,
      code: "rate_limited",
      message: "The AI service is busy right now. Please try again in a moment.",
    });
    expect(console.error).toHaveBeenCalledWith(
      "[ai] openrouter request failed:",
      429,
      "rate limit reached",
    );
  });

  it("maps invalid credentials to 500", async () => {
    stubFetch(jsonResponse({ error: { message: "invalid api key" } }, 401));

    await expectAiError(createOpenRouterProvider(config).generate(request), {
      status: 500,
      code: "invalid_credentials",
      message: "The AI service rejected the configured credentials.",
    });
  });

  it("maps other upstream failures to 502 even when the error body is unreadable", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 502 }));

    await expectAiError(createOpenRouterProvider(config).generate(request), {
      status: 502,
      code: "unavailable",
      message: "The AI service could not complete the request.",
    });
  });

  it("maps timeouts to 504", async () => {
    stubFetchError(Object.assign(new Error("aborted"), { name: "TimeoutError" }));

    await expectAiError(createOpenRouterProvider(config).generate(request), {
      status: 504,
      code: "timeout",
      message: "The AI service took too long to respond. Please try again.",
    });
  });

  it("maps network failures to 502", async () => {
    stubFetchError(new TypeError("fetch failed"));

    await expectAiError(createOpenRouterProvider(config).generate(request), {
      status: 502,
      code: "unreachable",
      message: "The AI service is unreachable. Please try again.",
    });
  });

  it("rejects unreadable success bodies", async () => {
    stubFetch(new Response("<html>oops</html>", { status: 200 }));

    await expectAiError(createOpenRouterProvider(config).generate(request), {
      status: 502,
      code: "invalid_response",
      message: "The AI service returned an unreadable response.",
    });
  });

  it("fails without an API key and never calls the network", async () => {
    const fetchMock = stubFetch(completionResponse("{}"));

    await expectAiError(
      createOpenRouterProvider({ ...config, apiKey: null }).generate(request),
      {
        status: 500,
        code: "not_configured",
        message: "OPENROUTER_API_KEY is not configured on the server.",
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails without a model and never calls the network", async () => {
    const fetchMock = stubFetch(completionResponse("{}"));

    await expectAiError(
      createOpenRouterProvider({ ...config, model: null }).generate(request),
      {
        status: 500,
        code: "not_configured",
        message: "AI_MODEL is not configured for the openrouter provider.",
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("combines caller cancellation with the OpenRouter timeout signal", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.signal?.aborted).toBe(false);
    controller.abort();
    expect(init?.signal?.aborted).toBe(true);
    throw new DOMException("Aborted", "AbortError");
  }));
  await expect(createOpenRouterProvider(config).generate({ ...request, signal: controller.signal })).rejects.toBeInstanceOf(AiError);
});
