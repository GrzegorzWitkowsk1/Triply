import { supportedLocaleSchema } from "./locale.js";
import { z } from "zod";
import { tripDayWeatherSchema } from "./trip.js";

export const sharingStatusSchema = z.object({ enabled: z.boolean(), createdAt: z.string().nullable(), updatedAt: z.string().nullable() });
export type SharingStatus = z.infer<typeof sharingStatusSchema>;
export const sharingLinkSchema = sharingStatusSchema.extend({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export type SharingLink = z.infer<typeof sharingLinkSchema>;
const point = z.tuple([z.number(), z.number()]);
export const publicTripSchema = z.object({
  contentLocale: supportedLocaleSchema.optional(),
  destination: z.string().nullable(), country: z.string().nullable(),
  startDate: z.string().nullable(), endDate: z.string().nullable(), durationDays: z.number().nullable(),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  weather: z.array(tripDayWeatherSchema),
  unscheduledCount: z.number().int().nonnegative().optional(),
  days: z.array(z.object({
    dayIndex: z.number(), date: z.string(), timeZone: z.string(),
    activities: z.array(z.object({ type: z.enum(["attraction", "travel", "break"]), title: z.string(),
      startTime: z.string(), endTime: z.string(), durationMinutes: z.number(),
      schedulingStatus: z.literal("unresolved").optional(), stopIndex: z.number().nullable(), distanceMeters: z.number().nullable(),
      openingHoursStatus: z.enum(["open", "closed", "unknown"]).nullable().optional(),
      calendarUid: z.string().regex(/^[a-f0-9]{64}@calendar\.triply\.invalid$/).optional(),
      durationSource: z.enum(["provided", "estimated"]).nullable().optional(),
      travelDurationSource: z.enum(["provider", "approximation", "unavailable"]).nullable().optional() })),
    stops: z.array(z.object({ name: z.string(), category: z.string(), lat: z.number(), lng: z.number(),
      address: z.string().nullable(), description: z.string().nullable() })),
    geometry: z.object({ type: z.literal("LineString"), coordinates: z.array(point) }).nullable(),
    travelMode: z.enum(["walking", "cycling", "driving"]).nullable(),
    totalVisitMinutes: z.number(), totalTravelMinutes: z.number().nullable(), totalDistanceMeters: z.number().nullable(), partiallyEstimated: z.boolean(),
    warnings: z.array(z.enum(["schedule-unresolved", "estimated-travel", "route-unavailable", "opening-hours-conflict", "opening-hours-unknown"])).optional(),
  })),
});
export type PublicTrip = z.infer<typeof publicTripSchema>;
