import { addDays, type Coordinates, type SchedulablePoi, type TripAttraction } from "@triply/shared";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { TripModel, type TripDocument, type TripItineraryRecord } from "../models/Trip.js";
import { ensureAttractions, ensureWeather } from "./tripDraft.js";
import { planTrip, type PlanTripResult } from "./tripPlanner.js";
import type { ItineraryStop } from "@triply/shared";

/** A generation that has been running longer than this is considered abandoned. */
export const STALE_GENERATION_MS = 2 * 60 * 1000;

export const GENERIC_GENERATION_ERROR =
  "We couldn't finish generating your itinerary. Your trip details are saved, so you can try again.";

export function generationInputsReady(trip: TripDocument): boolean {
  const analysis = trip.analysis;

  return Boolean(
    analysis.location &&
      typeof analysis.durationDays === "number" &&
      analysis.durationDays > 0,
  );
}

/**
 * Atomically hands generation ownership to this request. Succeeds only when the
 * trip is a draft/failed, or when a previous `generating` run looks abandoned.
 * Returns null when another run holds the lock or the trip is not accessible.
 */
export async function claimTripForGeneration(
  tripId: string,
  userId: string,
): Promise<TripDocument | null> {
  const staleBefore = new Date(Date.now() - STALE_GENERATION_MS);

  return TripModel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(tripId),
      user: new Types.ObjectId(userId),
      $or: [
        { status: { $in: ["draft", "failed"] } },
        { status: "generating", "generation.startedAt": null },
        { status: "generating", "generation.startedAt": { $lt: staleBefore } },
      ],
    },
    {
      $set: {
        status: "generating",
        "generation.startedAt": new Date(),
        "generation.error": null,
      },
    },
    { new: true },
  ).exec();
}

export async function markGenerationFailed(
  tripId: string,
  userId: string,
  message: string,
): Promise<void> {
  await TripModel.updateOne(
    { _id: new Types.ObjectId(tripId), user: new Types.ObjectId(userId) },
    { $set: { status: "failed", "generation.error": message } },
  ).exec();
}

export function toSchedulablePois(
  attractions: readonly TripAttraction[],
): SchedulablePoi[] {
  return attractions.map((attraction) => ({
    name: attraction.name,
    category: attraction.category,
    lat: attraction.lat,
    lng: attraction.lng,
    score: attraction.score ?? undefined,
    placeId: attraction.placeId ?? undefined,
    environment: attraction.environment ?? undefined,
    visitDurationMinutes: attraction.visitDurationMinutes ?? undefined,
  }));
}

interface StoppablePoi {
  name: string;
  category?: string | null;
  lat: number;
  lng: number;
  score?: number | null;
  placeId?: string | null;
}

export function toItineraryStop(poi: StoppablePoi): ItineraryStop {
  return {
    placeId: poi.placeId ?? null,
    name: poi.name,
    category: poi.category ?? "attraction",
    lat: poi.lat,
    lng: poi.lng,
    score: typeof poi.score === "number" ? poi.score : null,
  };
}

function isUsableStop(poi: StoppablePoi): boolean {
  return Number.isFinite(poi.lat) && Number.isFinite(poi.lng) && poi.name.trim().length > 0;
}

function generationDates(trip: TripDocument): string[] | null {
  const { startDate, durationDays } = trip.analysis;

  if (!startDate || !durationDays || durationDays < 1) {
    return null;
  }

  return Array.from({ length: durationDays }, (_, index) => addDays(startDate, index));
}

export function toItineraryRecord(
  result: PlanTripResult<SchedulablePoi>,
  generatedAt: Date,
): TripItineraryRecord {
  const routeByDay = new Map(result.routing.dayRoutes.map((route) => [route.dayIndex, route]));

  const days = result.days.map((day) => {
    const route = routeByDay.get(day.dayIndex);

    return {
      dayIndex: day.dayIndex,
      date: day.date,
      timeZone: day.timeZone,
      activities: day.activities,
      stops: (route?.orderedPlaces ?? []).filter(isUsableStop).map(toItineraryStop),
      geometry: route?.geometry ?? null,
      segments: route?.segments ?? [],
      totalVisitMinutes: day.totalVisitMinutes,
      totalTravelMinutes: day.totalTravelMinutes,
      totalDistanceMeters: day.totalDistanceMeters,
      partiallyEstimated: day.partiallyEstimated,
      warnings: day.warnings,
    };
  });

  return {
    timeZone: result.timeZone,
    routingSource: result.routing.source,
    days,
    unscheduled: result.unscheduledPlaces.map((entry) => ({
      place: toItineraryStop(entry.place),
      dayIndex: entry.dayIndex,
      reason: entry.reason,
      detail: entry.detail ?? null,
    })),
  };
}

export async function runTripGeneration(trip: TripDocument): Promise<TripDocument> {
  const analysis = trip.analysis;
  const location = analysis.location;

  if (!location || !analysis.durationDays || analysis.durationDays < 1) {
    throw new Error("Trip is missing a destination or duration");
  }

  const weather = await ensureWeather(analysis, trip.weather, trip.weatherFetchedAt);
  const attractions = await ensureAttractions(
    analysis,
    trip.attractions,
    trip.attractionsFetchedAt,
    trip.attractionsQuery,
    weather.days,
  );

  const start: Coordinates = { lat: location.lat, lng: location.lng };

  const result = await planTrip({
    pois: toSchedulablePois(attractions.attractions),
    durationDays: analysis.durationDays,
    pace: analysis.pace,
    weather: weather.days,
    startDate: analysis.startDate,
    dates: generationDates(trip),
    routing: {
      mode: env.ROUTING_MODE,
      start,
      returnToStart: env.ROUTING_RETURN_TO_START,
    },
  });

  const now = new Date();
  const startedAt = trip.generation?.startedAt ?? now;

  trip.set("weather", weather.days);
  trip.set("weatherFetchedAt", weather.fetchedAt);
  trip.set("attractions", attractions.attractions);
  trip.set("attractionsFetchedAt", attractions.fetchedAt);
  trip.set("attractionsQuery", attractions.query);
  trip.set("itinerary", toItineraryRecord(result, now));
  trip.set("status", "ready");
  trip.set("generation.startedAt", startedAt);
  trip.set("generation.generatedAt", now);
  trip.set("generation.error", null);

  return trip.save();
}

export function logGenerationFailure(error: unknown): void {
  console.error(
    "[trip-generation] failed:",
    error instanceof Error ? error.message : String(error),
  );
}
