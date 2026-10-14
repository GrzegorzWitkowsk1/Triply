import { z } from "zod";

export const calendarExportStatsSchema = z.object({
  exported: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(),
  unscheduled: z.number().int().nonnegative(), invalid: z.number().int().nonnegative(),
});
export type CalendarExportStats = z.infer<typeof calendarExportStatsSchema>;
export const CALENDAR_ERROR_CODES = ["empty-itinerary", "no-events", "invalid-timezone", "ambiguous-time", "nonexistent-time", "invalid-identity", "too-large", "export-failed"] as const;
export type CalendarErrorCode = (typeof CALENDAR_ERROR_CODES)[number];
