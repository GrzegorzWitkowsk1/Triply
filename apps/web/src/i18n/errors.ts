import i18n from ".";
/** API diagnostics remain on the error object. UI copy depends only on stable codes/status. */
export function errorKey(error: unknown): string {
  const value = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; name?: unknown } : {};
  const codes: Record<string, string> = {
    GUEST_SESSION_EXPIRED: "sessionExpired", GUEST_SESSION_REQUIRED: "sessionExpired",
    GUEST_TRIP_LIMIT_REACHED: "guestTripLimit", GUEST_AI_LIMIT_REACHED: "guestAiLimit",
    GUEST_AI_GENERATION_LIMIT_REACHED: "guestAiLimit", GUEST_DAY_REGENERATION_LIMIT_REACHED: "guestDayLimit",
    GUEST_TRIP_DURATION_EXCEEDED: "guestDuration", GUEST_TRIP_DAYS_LIMIT_EXCEEDED: "guestDuration",
    GUEST_DAY_REGEN_LIMIT_REACHED: "guestDayLimit", GUEST_PACKING_LIMIT_REACHED: "guestPackingLimit", GUEST_RATE_LIMITED: "rateLimited",
    IDEMPOTENCY_CONFLICT: "conflict", ITINERARY_VERSION_CONFLICT: "conflict",
    "invalid-response": "invalidResponse", "invalid-timezone": "invalidTimeZone",
  };
  const key = typeof value.code === "string" ? codes[value.code] : undefined;
  if (key) return `errors:${key}`;
  if (value.status === 401) return "errors:unauthorized";
  if (value.status === 403) return "errors:forbidden";
  if (value.status === 404 || value.status === 410) return "errors:notFound";
  if (value.status === 409) return "errors:conflict";
  if (value.status === 429) return "errors:rateLimited";
  if (value.status === 408 || value.name === "TimeoutError") return "errors:timeout";
  if (value.status === 400 || value.status === 422 || value.name === "ZodError") return "errors:validation";
  if (value.name === "TypeError") return "errors:networkError";
  return "errors:unexpected";
}
export function errorMessage(error: unknown): string { return i18n.t(errorKey(error)); }
/** Local UI state may retain a semantic key so its text changes without clearing the state. */
export function resolveMessage(message: string): string;
export function resolveMessage(message: string | null): string | null;
export function resolveMessage(message: string | null | undefined): string | null | undefined;
export function resolveMessage(message: string | null | undefined): string | null | undefined {
  return message && i18n.exists(message) ? i18n.t(message) : message;
}
