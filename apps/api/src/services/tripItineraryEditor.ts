import {
  itineraryEditRequestSchema, tripAttractionSchema,
  type ItineraryEditRequest, type ItineraryDay, type TripAttraction,
  type ItineraryCandidatesResponse, type TripUnscheduledPlace,
} from "@triply/shared";
import { Types } from "mongoose";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { env } from "../config/env.js";
import { createRoutingProvider } from "../routing/index.js";
import type { RoutingProvider } from "../routing/types.js";
import { fetchAttractions } from "./attractions.js";
import { optimizeClusterRoute } from "./routeOptimizer.js";
import { buildDailySchedules } from "./scheduling.js";
import { resolvePoiTimeZone } from "./openingHoursService.js";
import { toItineraryDay, toItineraryStop, toSchedulablePois } from "./tripGeneration.js";

export class ItineraryEditError extends Error {
  constructor(message: string, readonly status = 400,
    readonly warnings: string[] = [], readonly conflicts: TripUnscheduledPlace[] = []) {
    super(message);
  }
}

export async function loadEditableTrip(tripId: string, userId: string): Promise<TripDocument> {
  if (!Types.ObjectId.isValid(tripId) || !Types.ObjectId.isValid(userId)) {
    throw new ItineraryEditError("Trip not found", 404);
  }
  const trip = await TripModel.findOne({ _id: new Types.ObjectId(tripId), user: new Types.ObjectId(userId) }).exec();
  if (!trip) throw new ItineraryEditError("Trip not found", 404);
  if (trip.status !== "ready" || !trip.itinerary) {
    throw new ItineraryEditError("Generate the itinerary before editing it.");
  }
  return trip;
}

/** Only provider/server candidates are accepted. Legacy candidates get a coordinate identity. */
function normalizeCandidates(values: readonly TripAttraction[]): TripAttraction[] {
  const unique = new Map<string, TripAttraction>();
  const locations = new Set<string>();
  for (const value of values) {
    const parsed = tripAttractionSchema.safeParse(value);
    if (!parsed.success) continue;
    const candidate = parsed.data;
    const locationKey = `${candidate.lat}:${candidate.lng}`;
    const placeId = candidate.placeId ?? `location/${locationKey}`;
    if (unique.has(placeId) || locations.has(locationKey)) continue;
    unique.set(placeId, { ...candidate, placeId });
    locations.add(locationKey);
  }
  return [...unique.values()];
}

export async function itineraryCandidates(
  tripId: string, userId: string, search: string, discover: boolean,
  fetchCandidates: typeof fetchAttractions = fetchAttractions,
): Promise<ItineraryCandidatesResponse> {
  let trip = await loadEditableTrip(tripId, userId);
  const warnings: string[] = [];
  if (discover && trip.analysis.location) {
    const location = trip.analysis.location;
    let fetched: TripAttraction[] | null = null;
    try {
      fetched = await fetchCandidates(location.lat, location.lng,
        [...new Set([...trip.analysis.interests, "culture", "food", "nature", "architecture", "shopping"])],
        { weather: trip.weather });
    } catch { /* Keep saved candidates available. */ }
    if (!fetched) warnings.push("Additional places are unavailable. You can still use saved attractions.");
    else {
      const existing = new Set(normalizeCandidates(trip.attractions).map((place) => place.placeId));
      const locations = new Set(trip.attractions.map((place) => `${place.lat}:${place.lng}`));
      const additions = normalizeCandidates(fetched).filter((place) =>
        !existing.has(place.placeId) && !locations.has(`${place.lat}:${place.lng}`));
      for (const candidate of additions) {
        // Deduplicate by identity atomically, even when simultaneous discoveries
        // return different metadata for the same upstream place.
        await TripModel.updateOne({ _id: trip._id, user: trip.user,
          attractions: { $not: { $elemMatch: { $or: [
            { placeId: candidate.placeId }, { lat: candidate.lat, lng: candidate.lng },
          ] } } },
        }, { $push: { attractions: candidate } }, { runValidators: true }).exec();
      }
      trip = await loadEditableTrip(tripId, userId);
    }
  }
  const scheduled = new Map((trip.itinerary?.days ?? []).flatMap((day) =>
    day.activities.filter((activity) => activity.type === "attraction" && activity.placeId)
      .map((activity) => [activity.placeId!, day.dayIndex] as const)));
  const query = search.trim().toLocaleLowerCase();
  return {
    candidates: normalizeCandidates(trip.attractions)
      .filter((place) => `${place.name} ${place.category}`.toLocaleLowerCase().includes(query))
      .map((place) => ({ ...place, placeId: place.placeId!, scheduledDayIndex: scheduled.get(place.placeId!) ?? null })),
    warnings,
  };
}

/** Pure operation application; routing, scheduling and persistence are separate stages. */
export function applyItineraryOperation(days: ItineraryDay[], pool: readonly TripAttraction[], request: ItineraryEditRequest): number[] {
  const operation = request.operation;
  const affected = operation.type === "move"
    ? [operation.sourceDayIndex, operation.targetDayIndex] : [operation.dayIndex];
  const getDay = (index: number) => {
    const day = days.find((entry) => entry.dayIndex === index);
    if (!day) throw new ItineraryEditError("Day not found", 404);
    const activities = day.activities.filter((entry) => entry.type === "attraction");
    const scheduled = new Set(activities.map((entry) => entry.placeId));
    if (activities.some((entry) => !entry.placeId)) {
      throw new ItineraryEditError("This legacy day has attractions without stable IDs and cannot be edited safely.", 422);
    }
    // Generation stores route stops that may not have fit in the schedule.
    const stops = new Map(day.stops.filter((stop) => stop.placeId && scheduled.has(stop.placeId))
      .map((stop) => [stop.placeId, stop]));
    if (stops.size !== activities.length || activities.some((activity) => !stops.has(activity.placeId!))) {
      throw new ItineraryEditError("The day's attractions and schedule are inconsistent. No changes were saved.", 422);
    }
    day.stops = activities.map((activity) => stops.get(activity.placeId!)!);
    return day;
  };
  const selected = affected.map(getDay);
  const occupied = new Set(days.flatMap((day) => day.activities
    .filter((entry) => entry.type === "attraction").map((entry) => entry.placeId)));
  const requireNew = (id: string) => {
    if (occupied.has(id)) throw new ItineraryEditError("That attraction is already scheduled.");
    const attraction = normalizeCandidates(pool).find((place) => place.placeId === id);
    if (!attraction) throw new ItineraryEditError("Attraction not found", 404);
    if (days.some((day) => day.stops.some((stop) => occupied.has(stop.placeId ?? undefined) &&
      stop.lat === attraction.lat && stop.lng === attraction.lng))) {
      throw new ItineraryEditError("That attraction is already scheduled.");
    }
    return toItineraryStop(attraction);
  };
  const requireIndex = (day: ItineraryDay, id: string) => {
    const index = day.stops.findIndex((stop) => stop.placeId === id);
    if (index < 0) throw new ItineraryEditError("The attraction does not belong to this day.");
    return index;
  };
  const insert = (day: ItineraryDay, stop: ItineraryDay["stops"][number], position?: number) => {
    const index = position ?? day.stops.length;
    if (index > day.stops.length) throw new ItineraryEditError("Insertion position is outside this day.");
    day.stops.splice(index, 0, stop);
  };
  const day = selected[0];
  switch (operation.type) {
    // Retry uses the same validated recalculation and version-guarded save as other edits.
    case "reroute": break;
    case "add": insert(day, requireNew(operation.attractionId), operation.position); break;
    case "remove": day.stops.splice(requireIndex(day, operation.attractionId), 1); break;
    case "replace": {
      const index = requireIndex(day, operation.oldAttractionId);
      day.stops[index] = requireNew(operation.newAttractionId);
      break;
    }
    case "move": {
      if (operation.sourceDayIndex === operation.targetDayIndex) throw new ItineraryEditError("Choose a different destination day.");
      const index = requireIndex(day, operation.attractionId);
      const stop = day.stops.splice(index, 1)[0];
      insert(selected[1], stop, operation.position);
      break;
    }
    case "reorder": {
      const ids = operation.attractionIds;
      if (ids.length !== day.stops.length || new Set(ids).size !== ids.length ||
        ids.some((id) => !day.stops.some((stop) => stop.placeId === id))) {
        throw new ItineraryEditError("Reordering must include each scheduled attraction exactly once.");
      }
      const stops = new Map(day.stops.map((stop) => [stop.placeId, stop]));
      day.stops = ids.map((id) => stops.get(id)!);
      break;
    }
  }
  const ids = days.flatMap((entry) => affected.includes(entry.dayIndex)
    ? entry.stops.map((stop) => stop.placeId)
    : entry.activities.filter((activity) => activity.type === "attraction").map((activity) => activity.placeId));
  const knownIds = ids.filter((id): id is string => Boolean(id));
  if (new Set(knownIds).size !== knownIds.length) throw new ItineraryEditError("Duplicate attractions are not allowed.");
  return affected;
}

export async function recalculateEditedDay(trip: TripDocument, day: ItineraryDay, provider: RoutingProvider | null): Promise<ItineraryDay> {
  const pool = normalizeCandidates(trip.attractions);
  const pois = toSchedulablePois(day.stops.map((stop) => pool.find((place) => place.placeId === stop.placeId) ?? stop));
  const start = trip.analysis.location ?? null;
  const route = await optimizeClusterRoute({ day: day.dayIndex, pois, center: null, medoid: null,
    count: pois.length, avgScore: 0, spreadMeters: 0 }, {
    preserveOrder: true, mode: env.ROUTING_MODE, start, returnToStart: env.ROUTING_RETURN_TO_START, provider,
  });
  const dates: (string | null)[] = [];
  dates[day.dayIndex - 1] = day.date || null;
  const scheduled = buildDailySchedules({ dayRoutes: [route], travelMode: env.ROUTING_MODE,
    pace: trip.analysis.pace, weather: trip.weather,
    timeZone: resolvePoiTimeZone(trip.analysis.location ?? {}, day.timeZone), dates, start });
  const result = scheduled.days[0];
  const actualIds = result.activities.filter((activity) => activity.type === "attraction").map((activity) => activity.placeId);
  const conflicts = scheduled.unscheduledPlaces.map((entry) => ({ place: toItineraryStop(entry.place),
    dayIndex: entry.dayIndex, reason: entry.reason, detail: entry.detail ?? null }));
  if (conflicts.length || actualIds.length !== pois.length || actualIds.some((id, index) => id !== pois[index].placeId) ||
    result.warnings.includes("Return travel does not fit within the daily time window.")) {
    throw new ItineraryEditError("These attractions cannot fit in the day's schedule. No changes were saved.", 422,
      [...result.warnings, ...conflicts.map((entry) => `${entry.place.name}: ${entry.detail}`)], conflicts);
  }
  const updated = toItineraryDay(result, route);
  if (route.routingSource === "approximation" && route.segments.length) {
    updated.warnings.push("Routing is unavailable. Travel distance and time are estimates. Route geometry is unavailable.");
    updated.partiallyEstimated = true;
  }
  return updated;
}

/** The entry point for all callers, including a future assistant: authorized load + validated edit + CAS. */
export async function editTripItinerary(tripId: string, userId: string, input: ItineraryEditRequest,
  options: { provider?: RoutingProvider | null } = {}) {
  const parsed = itineraryEditRequestSchema.safeParse(input);
  if (!parsed.success) throw new ItineraryEditError(parsed.error.issues[0]?.message ?? "Invalid edit");
  const trip = await loadEditableTrip(tripId, userId);
  if (trip.itineraryVersion !== parsed.data.expectedVersion) {
    throw new ItineraryEditError("The itinerary has changed. Refresh it and try again.", 409);
  }
  const itinerary = trip.toObject().itinerary!;
  const affectedDayIndices = applyItineraryOperation(itinerary.days, trip.attractions, parsed.data);
  const provider = options.provider !== undefined ? options.provider : createRoutingProvider();
  for (const index of affectedDayIndices) {
    const position = itinerary.days.findIndex((day) => day.dayIndex === index);
    itinerary.days[position] = await recalculateEditedDay(trip, itinerary.days[position], provider);
  }
  const scheduledIds = new Set(itinerary.days.flatMap((day) => day.activities
    .filter((activity) => activity.type === "attraction").map((activity) => activity.placeId)));
  itinerary.unscheduled = itinerary.unscheduled.filter((entry) => !scheduledIds.has(entry.place.placeId ?? undefined));
  itinerary.routingSource = itinerary.days.some((day) => day.partiallyEstimated) ? "approximation"
    : itinerary.days.some((day) => day.segments.length > 0) ? "provider" : "unavailable";
  const updated = await TripModel.findOneAndUpdate({ _id: trip._id, user: trip.user,
    status: "ready", itineraryVersion: parsed.data.expectedVersion }, {
    $set: { itinerary, regeneration: null }, $inc: { itineraryVersion: 1 },
  }, { new: true, runValidators: true }).exec();
  if (!updated) throw new ItineraryEditError("The itinerary has changed. Refresh it and try again.", 409);
  return { trip: updated, itineraryVersion: updated.itineraryVersion, affectedDayIndices,
    warnings: itinerary.days.filter((day) => affectedDayIndices.includes(day.dayIndex)).flatMap((day) => day.warnings) };
}
