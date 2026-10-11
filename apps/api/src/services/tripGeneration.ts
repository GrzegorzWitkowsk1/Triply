import {
  addDays,
  type Coordinates,
  type DailySchedule,
  type ItineraryDay,
  type ItineraryStop,
  type OptimizedDayRoute,
  type SchedulablePoi,
  type TripAttraction,
} from "@triply/shared";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { TripModel, type TripDocument, type TripItineraryRecord } from "../models/Trip.js";
import { ensureAttractions, ensureWeather } from "./tripDraft.js";
import { planTrip, type PlanTripResult } from "./tripPlanner.js";
import { resolvePoiTimeZone } from "./openingHoursService.js";

/** A generation that has been running longer than this is considered abandoned. */
export const STALE_GENERATION_MS = 2 * 60 * 1000;

export const GENERIC_GENERATION_ERROR =
  "We couldn't finish generating your itinerary. Your trip details are saved, so you can try again.";

export class GenerationSupersededError extends Error {
  constructor() {
    super("Another request has taken over itinerary generation.");
  }
}

export class GenerationUnavailableError extends Error {}

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
  startedAt: Date | null,
): Promise<boolean> {
  const result = await TripModel.updateOne(
    {
      _id: new Types.ObjectId(tripId), user: new Types.ObjectId(userId),
      status: "generating", "generation.startedAt": startedAt,
    },
    { $set: { status: "failed", "generation.error": message } },
  ).exec();
  return result.matchedCount > 0;
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
    openingHours: attraction.openingHours ?? undefined,
    admission: attraction.admission ?? undefined,
  }));
}

interface StoppablePoi {
  admission?: TripAttraction["admission"];
  name: string;
  category?: string | null;
  lat: number;
  lng: number;
  score?: number | null;
  placeId?: string | null;
}

export function toItineraryStop(poi: StoppablePoi): ItineraryStop {
  return {
    admission: poi.admission,
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

export function toItineraryDay(
  day: DailySchedule<SchedulablePoi>,
  route: OptimizedDayRoute<SchedulablePoi> | undefined,
): ItineraryDay {
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
}

export function toItineraryRecord(
  result: PlanTripResult<SchedulablePoi>,
  generatedAt: Date,
): TripItineraryRecord {
  const routeByDay = new Map(result.routing.dayRoutes.map((route) => [route.dayIndex, route]));

  const days = result.days.map((day) => toItineraryDay(day, routeByDay.get(day.dayIndex)));

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

  if (attractions.attractions.length === 0) {
    throw new GenerationUnavailableError(
      attractions.query === null
        ? "The places service is temporarily unavailable. Your trip details are saved. Please try again in a moment."
        : "We couldn't find suitable places near this destination. Adjust your destination or interests, then try again.",
    );
  }

  const start: Coordinates = { lat: location.lat, lng: location.lng };

  const result = await planTrip({
    pois: toSchedulablePois(attractions.attractions),
    durationDays: analysis.durationDays,
    pace: analysis.pace,
    weather: weather.days,
    startDate: analysis.startDate,
    dates: generationDates(trip),
    timeZone: resolvePoiTimeZone(location),
    routing: {
      mode: env.ROUTING_MODE,
      start,
      returnToStart: env.ROUTING_RETURN_TO_START,
    },
  });

  const now = new Date();
  if (!result.days.some((day) => day.activities.some((activity) => activity.type === "attraction"))) {
    throw new GenerationUnavailableError(
      "We couldn't fit any places into this itinerary. Adjust your trip details, then try again.",
    );
  }

  const saved = await TripModel.findOneAndUpdate(
    { _id: trip._id, user: trip.user, status: "generating", "generation.startedAt": trip.generation.startedAt },
    {
      $set: {
        weather: weather.days,
        weatherFetchedAt: weather.fetchedAt,
        attractions: attractions.attractions,
        attractionsFetchedAt: attractions.fetchedAt,
        attractionsQuery: attractions.query,
        itinerary: toItineraryRecord(result, now),
        regeneration: null,
        status: "ready",
        "generation.generatedAt": now,
        "generation.error": null,
      },
      $inc: { itineraryVersion: 1 },
    },
    { new: true, runValidators: true },
  ).exec();
  if (!saved) throw new GenerationSupersededError();
  return saved;
}

export function logGenerationFailure(error: unknown): void {
  console.error(
    "[trip-generation] failed:",
    error instanceof Error ? error.message : String(error),
  );
}
