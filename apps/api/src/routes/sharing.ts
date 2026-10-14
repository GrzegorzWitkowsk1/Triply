import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import type { FastifyInstance } from "fastify";
import { publicTripSchema, type SharingStatus } from "@triply/shared";
import { TripModel, type TripRecord } from "../models/Trip.js";
import { currentUserId } from "../middleware/auth.js";

export const hashShareToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const PUBLIC_TRIP_PROJECTION = "analysis.destination analysis.country analysis.startDate analysis.endDate analysis.durationDays analysis.location weather itinerary attractions";
export async function findPublicTrip(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return TripModel.findOne({ "sharing.enabled": true, "sharing.tokenHash": hashShareToken(token) }).select(PUBLIC_TRIP_PROJECTION).exec();
}
const status = (trip: TripRecord): SharingStatus => ({ enabled: trip.sharing?.enabled === true,
  createdAt: trip.sharing?.createdAt?.toISOString() ?? null, updatedAt: trip.sharing?.updatedAt?.toISOString() ?? null });

/** Explicit nested allowlist. Provider IDs and diagnostic strings never cross this boundary. */
export function toPublicTrip(trip: TripRecord & { _id: Types.ObjectId }, options: { calendarMetadata?: boolean } = {}) {
  const a = trip.analysis;
  const counts = new Map<string, number>();
  for (const day of trip.itinerary?.days ?? []) for (const activity of day.activities)
    if (activity.type === "attraction" && activity.placeId) counts.set(activity.placeId, (counts.get(activity.placeId) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  const unscheduled = new Set((trip.itinerary?.unscheduled ?? []).filter(item =>
    !(trip.itinerary?.days ?? []).some(day => (item.dayIndex === null || item.dayIndex === day.dayIndex) &&
      day.activities.some(activity => activity.type === "attraction" && activity.placeId && activity.placeId === item.place.placeId)))
    .map(item => `${item.dayIndex}:${item.place.placeId ?? `${item.place.name}:${item.place.lat}:${item.place.lng}`}`));
  return publicTripSchema.parse({ destination: a.destination, country: a.country, startDate: a.startDate,
    endDate: a.endDate, durationDays: a.durationDays, location: a.location ? { lat: a.location.lat, lng: a.location.lng } : null,
    weather: trip.weather.map(w => ({ date: w.date, weatherCode: w.weatherCode, temperatureMax: w.temperatureMax })),
    ...(options.calendarMetadata ? { unscheduledCount: unscheduled.size } : {}),
    days: (trip.itinerary?.days ?? []).map(day => ({
      dayIndex: day.dayIndex, date: day.date, timeZone: day.timeZone,
      activities: day.activities.map(activity => {
        const identity = activity.type === "attraction" && activity.placeId
          ? `attraction:${activity.placeId}${counts.get(activity.placeId) === 1 ? "" : `:day:${day.dayIndex}`}`
          : `${activity.type}:day:${day.dayIndex}:${activity.title}`;
        const occurrence = occurrences.get(identity) ?? 0; occurrences.set(identity, occurrence + 1);
        const calendarUid = options.calendarMetadata ? `${createHash("sha256").update(JSON.stringify(["triply-calendar-v1", String(trip._id), identity, occurrence])).digest("hex")}@calendar.triply.invalid` : undefined;
        return { type: activity.type, title: activity.title, ...(options.calendarMetadata ? { calendarUid } : {}),
        startTime: activity.startTime, endTime: activity.endTime, durationMinutes: activity.durationMinutes,
        schedulingStatus: activity.schedulingStatus,
        stopIndex: activity.placeId ? (() => { const i = day.stops.findIndex(s => s.placeId === activity.placeId); return i < 0 ? null : i; })() : null,
        distanceMeters: activity.distanceMeters ?? null, openingHoursStatus: activity.openingHoursCheck?.status ?? null,
        durationSource: activity.durationSource ?? null, travelDurationSource: activity.travelDurationSource ?? null }; }),
      stops: day.stops.map(stop => { const detail = trip.attractions.find(p => p.placeId && p.placeId === stop.placeId);
        return { name: stop.name, category: stop.category, lat: stop.lat, lng: stop.lng,
          address: detail?.address ?? null, description: detail?.description ?? null }; }),
      geometry: day.geometry ? { type: "LineString", coordinates: day.geometry.coordinates.map(p => [p[0], p[1]]) } : null,
      travelMode: day.travelMode ?? null, totalVisitMinutes: day.totalVisitMinutes, totalTravelMinutes: day.totalTravelMinutes,
      totalDistanceMeters: day.totalDistanceMeters, partiallyEstimated: day.partiallyEstimated,
      warnings: [
        ...(day.activities.some(a => a.schedulingStatus === "unresolved") ? ["schedule-unresolved"] : []),
        ...(day.partiallyEstimated ? ["estimated-travel"] : []),
        ...(day.routingSource === "unavailable" ? ["route-unavailable"] : []),
        ...(day.activities.some(a => a.type === "attraction" && a.openingHoursCheck?.status === "closed") ? ["opening-hours-conflict"] : []),
        ...(day.activities.some(a => a.type === "attraction" && (!a.openingHoursCheck || a.openingHoursCheck.status === "unknown")) ? ["opening-hours-unknown"] : []),
      ],
    })),
  });
}

export function registerSharingRoutes(app: FastifyInstance): void {
  const options = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
  for (const operation of ["status", "enable", "rotate", "disable"] as const) {
    app.route<{ Params: { id: string } }>({ method: operation === "status" ? "GET" : operation === "disable" ? "DELETE" : "POST",
      url: `/trips/:id/sharing${operation === "rotate" ? "/rotate" : ""}`, ...options,
      // enable and status share a path with distinct HTTP methods.
      handler: async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!Types.ObjectId.isValid(req.params.id)) return reply.code(404).send({ error: "Trip not found" });
        const filter = { _id: new Types.ObjectId(req.params.id), user: new Types.ObjectId(currentUserId(req)) };
        if (operation === "status") {
          const trip = await TripModel.findOne(filter).select("sharing").exec();
          return trip ? reply.send(status(trip)) : reply.code(404).send({ error: "Trip not found" });
        }
        const token = randomBytes(32).toString("base64url");
        const now = new Date();
        // One atomic transition: concurrent requests are ordered by MongoDB.
        const trip = await TripModel.findOneAndUpdate({ ...filter,
          ...(operation === "rotate" ? { "sharing.enabled": true } : {}),
          ...(operation === "enable" ? { "sharing.enabled": { $ne: true } } : {}),
        }, { $set: { sharing: { enabled: operation !== "disable", tokenHash: operation === "disable" ? null : hashShareToken(token),
          createdAt: operation === "disable" ? null : now, updatedAt: now } } }, { new: true }).exec();
        if (!trip) {
          if (!await TripModel.exists(filter)) return reply.code(404).send({ error: "Trip not found" });
          return reply.code(409).send({ error: "Sharing state changed. Refresh its status and try again." });
        }
        return reply.send({ ...status(trip), ...(operation === "disable" ? {} : { token }) });
      },
    });
  }
}

export function registerPublicTripRoutes(app: FastifyInstance): void {
  app.get<{ Params: { shareToken: string } }>("/api/public/trips/:shareToken", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    onRequest: async (_req, reply) => { reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex, nofollow"); },
  }, async (req, reply) => {
    const token = req.params.shareToken;
    const trip = await findPublicTrip(token);
    return trip ? reply.send(toPublicTrip(trip)) : reply.code(404).send({ error: "Shared trip not found" });
  });
}
