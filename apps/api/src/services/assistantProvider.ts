import type { AssistantErrorCode } from "@triply/shared";
import { AiError } from "../ai/errors.js";
import type { AIProvider, AIRequest } from "../ai/types.js";

export function assistantError(error: unknown): { code: AssistantErrorCode; retryable: boolean } {
  if (error instanceof Error && error.name === "TimeoutError") return { code: "PROVIDER_TIMEOUT", retryable: true };
  if (error instanceof RangeError) return { code: "CONTEXT_TOO_LARGE", retryable: false };
  if (error instanceof AiError) {
    if (error.code === "context_too_large") return { code: "CONTEXT_TOO_LARGE", retryable: false };
    if (error.code === "timeout") return { code: "PROVIDER_TIMEOUT", retryable: true };
    if (error.code === "rate_limited") return { code: "RATE_LIMITED", retryable: true };
    if (error.code === "invalid_response") return { code: "PROVIDER_BAD_RESPONSE", retryable: true };
    return { code: "PROVIDER_UNAVAILABLE", retryable: !["not_configured", "invalid_credentials", "invalid_request"].includes(error.code ?? "") };
  }
  return { code: "INTERNAL_ERROR", retryable: true };
}

/** One deadline, at most one connection/server retry. Rate limits return immediately.
 * The existing factory has no configured fallback; no model/credentials are fabricated.
 */
export async function assistantInvocation(provider: AIProvider, request: AIRequest, signal: AbortSignal, onRetry: () => void): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    let listener!: () => void;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        listener = () => reject(signal.reason);
        signal.addEventListener("abort", listener, { once: true });
      });
      const result = await Promise.race([provider.generate({ ...request, signal }), aborted]);
      return result;
    } catch (error) {
      if (signal.aborted) {
        if (signal.reason instanceof Error && signal.reason.name === "TimeoutError") throw new AiError("Assistant deadline exceeded", 504, { code: "timeout" });
        throw signal.reason;
      }
      if (attempt || !(error instanceof AiError) || !["unreachable", "unavailable"].includes(error.code ?? "")) throw error;
      onRetry();
    } finally { signal.removeEventListener("abort", listener); }
  }
  throw new Error("Assistant retry exhausted");
}
export async function assistantCompletion(provider: AIProvider, request: AIRequest, signal: AbortSignal, onRetry: () => void): Promise<string> {
  const result = await assistantInvocation(provider, request, signal, onRetry);
  if (typeof result !== "string" || !result.trim() || result.length > 12000) throw new AiError("Unusable assistant response", 502, { code: "invalid_response" });
  return result.trim();
}
