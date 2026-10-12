/** Retry-After is a minimum wait, never shortened to fit the request budget. */
export function retryAfterMilliseconds(value: string | null | undefined, now = Date.now()): number {
  if (!value?.trim()) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
export type ExternalFailureCategory = "timeout" | "rate_limit" | "temporary_provider" | "configuration" | "invalid_response" | "invalid_input" | "cancelled" | "internal";
export function classifyExternalFailure(status?: number, error?: unknown): ExternalFailureCategory {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "configuration";
  if (status && status >= 500) return "temporary_provider";
  if (status && status >= 400) return "invalid_input";
  return error instanceof TypeError ? "temporary_provider" : "invalid_response";
}
