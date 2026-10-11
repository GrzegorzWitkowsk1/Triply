import {
  type Coordinates,
  type DayComparisonMetrics,
  type ItineraryDay,
  type ItineraryStop,
  type PoiCluster,
  type RegenerateDayPreview,
  type RegeneratedDayComparison,
  type RegenerationPreferences,
  type SchedulablePoi,
  type TripAttraction,
  type TripUnscheduledPlace,
} from "@triply/shared";
import { randomUUID } from "node:crypto";
import { budgetAwareCandidates } from "./budgetSelection.js";
import { summarizeBudget } from "./budgetSummary.js";
import { formatMoney } from "@triply/shared";
import { env } from "../config/env.js";
import { TripModel, type TripDocument, type TripRegenerationRecord } from "../models/Trip.js";
import { createRoutingProvider } from "../routing/index.js";
import type { RoutingProvider } from "../routing/types.js";
import { fetchAttractions } from "./attractions.js";
import { distanceMeters } from "./geo.js";
import { optimizeClusterRoute } from "./routeOptimizer.js";
import { buildDailySchedules } from "./scheduling.js";
import { improveOpeningHoursRoute, planningAvailability } from "./openingHoursPlanning.js";
import { resolvePoiTimeZone } from "./openingHoursService.js";
import { toItineraryDay, toItineraryStop, toSchedulablePois } from "./tripGeneration.js";

export const PREVIEW_TTL_MS = 30 * 60 * 1000;

const PACE_TARGETS = { relaxed: 3, balanced: 4, packed: 6 } as const;

const MAX_CANDIDATE_WINDOW = 18;
const PROXIMITY_RADIUS_M = 4000;

export class TripDayNotFoundError extends Error {
  constructor() {
    super("The selected day does not exist on this trip");
    this.name = "TripDayNotFoundError";
  }
}

export class NoSuitableAlternativesError extends Error {
  readonly warnings: string[];

  constructor(warnings: string[] = []) {
    super("We couldn't build a suitable alternative for this day.");
    this.name = "NoSuitableAlternativesError";
    this.warnings = warnings;
  }
}

export class RegenerationConflictError extends Error {
  constructor() {
    super("The itinerary changed since this preview was created. Please try again.");
    this.name = "RegenerationConflictError";
  }
}

export class RegenerationNotFoundError extends Error {
  constructor() {
    super("That regeneration preview is no longer available. Please generate a new one.");
    this.name = "RegenerationNotFoundError";
  }
}

export interface RegenerateTripDayInput {
  cheaper?: boolean;
  trip: TripDocument;
  dayIndex: number;
  preferences: RegenerationPreferences;
  variation?: number;
  provider?: RoutingProvider | null;
  fetchCandidates?: typeof fetchAttractions;
  customInstructionWarning?: string | null;
  now?: Date;
}

export interface RegenerateTripDayResult {
  day: ItineraryDay;
  warnings: string[];
  unscheduled: TripUnscheduledPlace[];
  comparison: RegeneratedDayComparison;
  newAttractions: TripAttraction[];
}

function stopKey(placeId: string | null | undefined, name: string): string {
  return placeId ? `id:${placeId}` : `name:${name.trim().toLowerCase()}`;
}

function attractionKey(attraction: TripAttraction): string {
  return stopKey(attraction.placeId ?? null, attraction.name);
}

function hashSeed(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/** Tiny deterministic PRNG so "surprise me" stays reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function currentDayKeys(day: ItineraryDay): Set<string> {
  const keys = new Set<string>();

  for (const stop of day.stops) {
    keys.add(stopKey(stop.placeId, stop.name));
  }

  for (const activity of day.activities) {
    if (activity.type === "attraction" && activity.placeId) {
      keys.add(stopKey(activity.placeId, activity.title));
    }
  }

  return keys;
}

function otherDayKeys(itinerary: TripDocument["itinerary"], dayIndex: number): Set<string> {
  const keys = new Set<string>();

  for (const day of itinerary?.days ?? []) {
    if (day.dayIndex === dayIndex) {
      continue;
    }

    for (const stop of day.stops) {
      keys.add(stopKey(stop.placeId, stop.name));
    }
  }

  return keys;
}

function dayAnchor(trip: TripDocument, day: ItineraryDay): Coordinates {
  if (day.stops.length > 0) {
    let lat = 0;
    let lng = 0;

    for (const stop of day.stops) {
      lat += stop.lat;
      lng += stop.lng;
    }

    return { lat: lat / day.stops.length, lng: lng / day.stops.length };
  }

  if (trip.analysis.location) {
    return { lat: trip.analysis.location.lat, lng: trip.analysis.location.lng };
  }

  return { lat: 0, lng: 0 };
}

interface RankingContext {
  preferences: RegenerationPreferences;
  anchor: Coordinates;
  currentKeys: Set<string>;
  rng: () => number;
}

function preferenceAdjustment(
  attraction: TripAttraction,
  context: RankingContext,
): number {
  const { preferences, anchor, currentKeys } = context;
  let adjustment = 0;

  if (preferences.moreFood && attraction.category === "food") {
    adjustment += 18;
  }

  if (preferences.preferIndoor) {
    if (attraction.environment === "indoor") {
      adjustment += 18;
    } else if (attraction.environment === "outdoor") {
      adjustment -= 10;
    }
  }

  if (preferences.lessWalking) {
    const proximity = 1 - distanceMeters(anchor.lat, anchor.lng, attraction.lat, attraction.lng) / PROXIMITY_RADIUS_M;
    adjustment += Math.max(0, proximity) * 25;
  }

  if (preferences.surpriseMe && currentKeys.has(attractionKey(attraction))) {
    adjustment -= 30;
  }

  return adjustment;
}

function rankCandidates(
  pool: readonly TripAttraction[],
  context: RankingContext,
): TripAttraction[] {
  const decorated = pool.map((attraction, index) => {
    const jitter = context.preferences.surpriseMe ? context.rng() * 8 - 4 : 0;
    const base = Number.isFinite(attraction.score) ? (attraction.score as number) : 50;

    return {
      attraction,
      index,
      value: base + preferenceAdjustment(attraction, context) + jitter,
    };
  });

  decorated.sort((a, b) => {
    if (a.value !== b.value) {
      return b.value - a.value;
    }

    if (a.attraction.name !== b.attraction.name) {
      return a.attraction.name < b.attraction.name ? -1 : 1;
    }

    return a.index - b.index;
  });

  return decorated.map((entry) => entry.attraction);
}

function selectCohesive(ranked: TripAttraction[], target: number): TripAttraction[] {
  if (ranked.length <= target) {
    return [...ranked];
  }

  const windowSize = Math.min(ranked.length, Math.max(target * 2, target + 4), MAX_CANDIDATE_WINDOW);
  const candidates = ranked.slice(0, windowSize);
  const selected: TripAttraction[] = [candidates[0]];
  const remaining = candidates.slice(1);

  let center: Coordinates = { lat: candidates[0].lat, lng: candidates[0].lng };

  while (selected.length < target && remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const distance = distanceMeters(center.lat, center.lng, candidate.lat, candidate.lng);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    const chosen = remaining.splice(bestIndex, 1)[0];
    selected.push(chosen);
    const count = selected.length;
    center = {
      lat: (center.lat * (count - 1) + chosen.lat) / count,
      lng: (center.lng * (count - 1) + chosen.lng) / count,
    };
  }

  return selected;
}

function plannedTarget(preferences: RegenerationPreferences, pace: string | null): number {
  const effective = preferences.relaxedPace ? "relaxed" : (pace ?? "balanced");

  return PACE_TARGETS[effective as keyof typeof PACE_TARGETS] ?? PACE_TARGETS.balanced;
}

function countSuitable(
  pool: readonly TripAttraction[],
  preferences: RegenerationPreferences,
): number {
  if (preferences.moreFood) {
    return pool.filter((attraction) => attraction.category === "food").length;
  }

  if (preferences.preferIndoor) {
    return pool.filter(
      (attraction) => attraction.environment === "indoor" || attraction.environment === "unknown",
    ).length;
  }

  return pool.length;
}

function augmentedInterests(
  interests: readonly string[],
  preferences: RegenerationPreferences,
): string[] {
  const next = new Set(interests);

  if (preferences.moreFood) {
    next.add("food");
  }

  if (preferences.preferIndoor) {
    next.add("culture");
    next.add("shopping");
  }

  return [...next];
}

function buildCluster(dayIndex: number, pois: SchedulablePoi[]): PoiCluster<SchedulablePoi> {
  if (pois.length === 0) {
    return {
      day: dayIndex,
      pois: [],
      center: null,
      medoid: null,
      count: 0,
      avgScore: 0,
      spreadMeters: 0,
    };
  }

  let lat = 0;
  let lng = 0;
  let scoreSum = 0;

  for (const poi of pois) {
    lat += poi.lat;
    lng += poi.lng;
    scoreSum += Number.isFinite(poi.score) ? (poi.score as number) : 0;
  }

  const center = { lat: lat / pois.length, lng: lng / pois.length };
  let spread = 0;

  for (const poi of pois) {
    spread = Math.max(spread, distanceMeters(center.lat, center.lng, poi.lat, poi.lng));
  }

  return {
    day: dayIndex,
    pois,
    center,
    medoid: pois[0],
    count: pois.length,
    avgScore: Math.round((scoreSum / pois.length) * 10) / 10,
    spreadMeters: Math.round(spread),
  };
}

function dayMetrics(day: ItineraryDay): DayComparisonMetrics {
  return {
    attractionCount: day.activities.filter((activity) => activity.type === "attraction").length,
    walkingMeters: day.totalDistanceMeters,
    travelMinutes: day.totalTravelMinutes,
    visitMinutes: day.totalVisitMinutes,
  };
}

function diffStops(original: ItineraryDay, proposed: ItineraryDay): {
  added: ItineraryStop[];
  removed: ItineraryStop[];
} {
  const originalKeys = new Set(original.stops.map((stop) => stopKey(stop.placeId, stop.name)));
  const proposedKeys = new Set(proposed.stops.map((stop) => stopKey(stop.placeId, stop.name)));

  return {
    added: proposed.stops.filter((stop) => !originalKeys.has(stopKey(stop.placeId, stop.name))),
    removed: original.stops.filter((stop) => !proposedKeys.has(stopKey(stop.placeId, stop.name))),
  };
}

/**
 * Builds an alternative for a single day using the existing planner services:
 * candidate selection -> route optimization -> daily scheduling.
 *
 * The stored itinerary is never modified; the caller decides whether to persist
 * the returned preview.
 */
export async function regenerateTripDay(
  input: RegenerateTripDayInput,
): Promise<RegenerateTripDayResult> {
  const { trip, dayIndex, preferences } = input;
  const itinerary = trip.itinerary;

  if (!itinerary) {
    throw new TripDayNotFoundError();
  }

  const targetDay = itinerary.days.find((day) => day.dayIndex === dayIndex);

  if (!targetDay) {
    throw new TripDayNotFoundError();
  }

  const warnings: string[] = [];

  if (input.customInstructionWarning) {
    warnings.push(input.customInstructionWarning);
  }

  const excluded = otherDayKeys(itinerary, dayIndex);
  const currentKeys = currentDayKeys(targetDay);
  const anchor = dayAnchor(trip, targetDay);
  const seed = hashSeed(`${trip._id.toString()}:${dayIndex}:${input.variation ?? 0}`);
  const rng = mulberry32(seed);
  const context: RankingContext = { preferences, anchor, currentKeys, rng };

  const available = (attraction: TripAttraction) => {
    const check = planningAvailability(toSchedulablePois([attraction])[0], targetDay.date,
      { travelMode: env.ROUTING_MODE, pace: preferences.relaxedPace ? "relaxed" : trip.analysis.pace,
        timeZone: itinerary.timeZone }, dayIndex);
    if (check.status === "closed" && !check.nextAvailableStart && !check.intervals.some(interval => interval.unknown)) {
      warnings.push(`${attraction.name}: ${check.reason}`);
      return false;
    }
    return true;
  };
  const basePool = trip.attractions.filter((attraction) => !excluded.has(attractionKey(attraction)) && available(attraction));
  const target = plannedTarget(preferences, trip.analysis.pace);
  const baseRanked = rankCandidates(budgetAwareCandidates(basePool, trip.toObject(), dayIndex, input.cheaper), context);
  const location = trip.analysis.location;
  const newAttractions: TripAttraction[] = [];

  if (countSuitable(basePool, preferences) < target && location) {
    const fetchCandidates = input.fetchCandidates ?? fetchAttractions;

    try {
      const fetched = await fetchCandidates(
        location.lat,
        location.lng,
        augmentedInterests(trip.analysis.interests, preferences),
        { weather: trip.weather },
      );

      if (fetched) {
        const existingKeys = new Set(basePool.map(attractionKey));

        for (const attraction of fetched) {
          const key = attractionKey(attraction);

          if (excluded.has(key) || existingKeys.has(key) || !available(attraction)) {
            continue;
          }

          existingKeys.add(key);
          newAttractions.push(attraction);
        }
      }
    } catch {
      // Fall back to the stored pool below.
    }

    if (newAttractions.length === 0) {
      warnings.push(
        "We couldn't find additional places for this request, so the alternative leans on your saved options.",
      );
    }
  }

  const pool = [...basePool, ...newAttractions];
  const ranked = newAttractions.length > 0 ? rankCandidates(budgetAwareCandidates(pool, trip.toObject(), dayIndex, input.cheaper), context) : baseRanked;

  if (ranked.length === 0) {
    throw new NoSuitableAlternativesError(warnings);
  }

  const selected = selectCohesive(ranked, target);
  const pois = toSchedulablePois(selected);

  if (pois.length === 0) {
    throw new NoSuitableAlternativesError(warnings);
  }

  const cluster = buildCluster(dayIndex, pois);
  const provider =
    input.provider !== undefined ? input.provider : createRoutingProvider();
  const start: Coordinates | null = location
    ? { lat: location.lat, lng: location.lng }
    : null;

  let route = await optimizeClusterRoute<SchedulablePoi>(cluster, {
    mode: env.ROUTING_MODE,
    start,
    returnToStart: env.ROUTING_RETURN_TO_START,
    provider,
  });

  const dates: (string | null)[] = [];
  dates[dayIndex - 1] = targetDay.date && targetDay.date.length > 0 ? targetDay.date : null;
  const improved = await improveOpeningHoursRoute(route, {
    travelMode: env.ROUTING_MODE, pace: preferences.relaxedPace ? "relaxed" : trip.analysis.pace,
    weather: trip.weather, timeZone: resolvePoiTimeZone(location ?? {}, itinerary.timeZone), dates, start,
  }, { mode: env.ROUTING_MODE, start, returnToStart: env.ROUTING_RETURN_TO_START, provider });
  route = improved.route;

  const scheduling = buildDailySchedules<SchedulablePoi>({
    dayRoutes: [route],
    travelMode: env.ROUTING_MODE,
    pace: preferences.relaxedPace ? "relaxed" : (trip.analysis.pace ?? null),
    weather: trip.weather,
    timeZone: resolvePoiTimeZone(location ?? {}, itinerary.timeZone),
    dates,
    start,
  });

  const scheduleDay = scheduling.days[0];

  if (!scheduleDay) {
    throw new NoSuitableAlternativesError(warnings);
  }

  const day = toItineraryDay(scheduleDay, route);
  warnings.push(...day.warnings);
  const originalBudget = summarizeBudget(trip.toObject());
  const proposedBudget = summarizeBudget({ ...trip.toObject(), attractions: [...trip.toObject().attractions, ...newAttractions], itinerary: { ...trip.toObject().itinerary!, days: itinerary.days.map(d => d.dayIndex === dayIndex ? day : d) } });
  warnings.push(...proposedBudget.warnings);
  for (const code of new Set([...originalBudget.totals, ...proposedBudget.totals].map(t => t.currency))) {
    const before = originalBudget.totals.find(t => t.currency === code)?.automaticMinor ?? 0;
    const after = proposedBudget.totals.find(t => t.currency === code)?.automaticMinor ?? 0;
    warnings.push(`Known admission estimate change: ${formatMoney(after - before, code)}. Manual expenses are preserved.`);
  }

  const scheduledAttractions = day.activities.filter(
    (activity) => activity.type === "attraction",
  );

  if (scheduledAttractions.length === 0) {
    throw new NoSuitableAlternativesError(warnings);
  }

  if (preferences.lessWalking) {
    const before = targetDay.totalDistanceMeters;
    const after = day.totalDistanceMeters;

    if (before === null || after === null) {
      warnings.push("Walking distance couldn't be compared reliably for this alternative.");
    } else if (after >= before) {
      warnings.push("We couldn't find a route meaningfully shorter than the current day.");
    }
  }

  if (preferences.preferIndoor) {
    const indoor = selected.filter((attraction) => attraction.environment === "indoor").length;

    if (indoor < Math.min(2, selected.length)) {
      warnings.push(
        "Few reliably indoor options were available around this day, so some stops may be outdoors.",
      );
    }
  }

  const unscheduled: TripUnscheduledPlace[] = [...scheduling.unscheduledPlaces, ...improved.conflicts].map((entry) => ({
    place: toItineraryStop(entry.place),
    dayIndex: entry.dayIndex,
    reason: entry.reason,
    detail: entry.detail ?? null,
  }));

  const { added, removed } = diffStops(targetDay, day);

  return {
    day,
    warnings: [...new Set(warnings)],
    unscheduled,
    comparison: {
      original: dayMetrics(targetDay),
      proposed: dayMetrics(day),
      added,
      removed,
    },
    newAttractions,
  };
}

export interface CreateDayPreviewInput extends Omit<RegenerateTripDayInput, "now"> {
  customInstructions?: string | null;
  now?: Date;
}

function toPlainRecord(record: TripRegenerationRecord): TripRegenerationRecord {
  const candidate = record as unknown as { toObject?: () => TripRegenerationRecord };

  return typeof candidate.toObject === "function" ? candidate.toObject() : record;
}

/**
 * Runs the regeneration engine and stores the result as a server-side preview.
 * The saved itinerary is left untouched until the preview is applied.
 */
export async function createDayRegenerationPreview(
  input: CreateDayPreviewInput,
): Promise<RegenerateDayPreview> {
  const now = input.now ?? new Date();
  const result = await regenerateTripDay({ ...input, now });

  const previewId = randomUUID();
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
  const baseItineraryVersion = input.trip.itineraryVersion ?? 0;
  const instructions = input.customInstructions?.trim();

  const record: TripRegenerationRecord = {
    previewId,
    dayIndex: input.dayIndex,
    baseItineraryVersion,
    preferences: input.preferences,
    customInstructions: instructions && instructions.length > 0 ? instructions : null,
    day: result.day,
    unscheduled: result.unscheduled,
    warnings: result.warnings,
    comparison: result.comparison,
    newAttractions: result.newAttractions,
    createdAt: now,
    expiresAt,
  };

  const updated = await TripModel.findOneAndUpdate(
    { _id: input.trip._id, itineraryVersion: baseItineraryVersion },
    { $set: { regeneration: record } },
    { new: true },
  ).exec();

  if (!updated) {
    throw new RegenerationConflictError();
  }

  return {
    previewId,
    tripId: input.trip._id.toString(),
    dayIndex: input.dayIndex,
    baseItineraryVersion,
    expiresAt: expiresAt.toISOString(),
    day: result.day,
    warnings: result.warnings,
    unscheduled: result.unscheduled,
    comparison: result.comparison,
    appliedPreferences: input.preferences,
    customInstructions: record.customInstructions,
  };
}

/**
 * Applies a stored preview, replacing only the selected day. The update is
 * version-guarded so a stale preview cannot overwrite a changed itinerary.
 */
export async function applyDayRegeneration(
  trip: TripDocument,
  previewId: string,
  dayIndex: number,
): Promise<TripDocument> {
  const stored = trip.regeneration;

  if (!stored || stored.previewId !== previewId || stored.dayIndex !== dayIndex) {
    throw new RegenerationNotFoundError();
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw new RegenerationNotFoundError();
  }

  const preview = toPlainRecord(stored);
  const base = preview.baseItineraryVersion;

  const remainingUnscheduled = (trip.itinerary?.unscheduled ?? [])
    .filter((entry) => entry.dayIndex !== dayIndex)
    .map((entry) => ({
      place: { ...entry.place },
      dayIndex: entry.dayIndex,
      reason: entry.reason,
      detail: entry.detail ?? null,
    }));

  const update: Record<string, unknown> = {
    $set: {
      "itinerary.days.$[day]": preview.day,
      "itinerary.unscheduled": [...remainingUnscheduled, ...preview.unscheduled],
      itineraryVersion: base + 1,
      regeneration: null,
    },
  };

  if (preview.newAttractions.length > 0) {
    update.$addToSet = { attractions: { $each: preview.newAttractions } };
  }

  const updated = await TripModel.findOneAndUpdate(
    {
      _id: trip._id,
      itineraryVersion: base,
      "regeneration.previewId": previewId,
      "regeneration.dayIndex": dayIndex,
    },
    update,
    { new: true, arrayFilters: [{ "day.dayIndex": dayIndex }] },
  ).exec();

  if (!updated) {
    throw new RegenerationConflictError();
  }

  return updated;
}
