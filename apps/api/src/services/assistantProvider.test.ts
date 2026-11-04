import { expect, it, vi } from "vitest";
import { AiError } from "../ai/errors.js";
import { assistantCompletion, assistantError } from "./assistantProvider.js";
const request = { systemInstruction: "system", prompt: "prompt", schema: { type: "string" } };
it("retries connection errors once, returns text, never fabricates a fallback", async () => {
  const generate = vi.fn().mockRejectedValueOnce(new AiError("network", 502, { code: "unreachable" })).mockResolvedValue("Answer");
  const retry = vi.fn();
  expect(await assistantCompletion({ generate }, request, new AbortController().signal, retry)).toBe("Answer");
  expect(generate).toHaveBeenCalledTimes(2); expect(retry).toHaveBeenCalledTimes(1);
});
it.each(["rate_limited", "invalid_credentials", "not_configured", "invalid_response", "invalid_request", "context_too_large"] as const)("does not retry %s", async code => {
  const generate = vi.fn().mockRejectedValue(new AiError("failure", 502, { code }));
  await expect(assistantCompletion({ generate }, request, new AbortController().signal, vi.fn())).rejects.toBeInstanceOf(AiError);
  expect(generate).toHaveBeenCalledTimes(1);
});
it("bounds retries and cleans up after a timeout even when a provider ignores cancellation", async () => {
  const generate = vi.fn().mockRejectedValue(new AiError("offline", 502, { code: "unavailable" }));
  await expect(assistantCompletion({ generate }, request, new AbortController().signal, vi.fn())).rejects.toBeInstanceOf(AiError);
  expect(generate).toHaveBeenCalledTimes(2);
  const controller = new AbortController(); const provider = { generate: vi.fn(() => new Promise(() => {})) };
  const result = assistantCompletion(provider, request, controller.signal, vi.fn());
  controller.abort(new DOMException("deadline", "TimeoutError"));
  await expect(result).rejects.toMatchObject({ code: "timeout" });
  expect(assistantError(new RangeError())).toEqual({ code: "CONTEXT_TOO_LARGE", retryable: false });
});
it("propagates user cancellation without retry", async () => {
  const controller = new AbortController(); const generate = vi.fn(() => new Promise(() => {}));
  const result = assistantCompletion({ generate }, request, controller.signal, vi.fn()); controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" }); expect(generate).toHaveBeenCalledTimes(1);
});
