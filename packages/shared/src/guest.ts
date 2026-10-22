export interface GuestUsage {
  tripCount: number;
  tripLimit: number;
  aiGenerationsRemaining: number;
  aiGenerationsLimit: number;
  dayRegenerationsRemaining: number;
  dayRegenerationsLimit: number;
  maxTripDays: number;
  aiQuotaResetsAt: string | null;
  dayQuotaResetsAt: string | null;
}
export type GuestErrorCode = "GUEST_TRIP_LIMIT_REACHED" | "GUEST_AI_LIMIT_REACHED" |
  "GUEST_PACKING_LIMIT_REACHED" | "GUEST_DAY_REGEN_LIMIT_REACHED" | "GUEST_TRIP_DURATION_EXCEEDED" | "GUEST_SESSION_EXPIRED" | "GUEST_RATE_LIMITED";
