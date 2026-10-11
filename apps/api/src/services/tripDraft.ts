import { budgetData } from "./budgetSummary.js";
import {
  deriveTripSchedule,
  summarizeAdmission,
  missingFields,
  LIMITS,
  tripAnalysisSchema,
  ASKABLE_FIELDS,
  type AskableField,
  type TripAnalysis,
  type TripAnalysisResult,
  type TripRequirementsAnswers,
  type TripEquipmentItem,
  type TripDayWeather,
  type TripAttraction,
  type TripDetail,
  type TripItinerary,
  type TripSummary,
} from "@triply/shared";
import { Types } from "mongoose";
import { fetchAttractions } from "./attractions.js";
import { geocodeLocation } from "./location.js";
import { clusterPois, normalizeDays } from "./poiClustering.js";
import { coversForecastRange, fetchDailyWeather } from "./weather.js";
import {
  TripModel,
  type AttractionsQueryRecord,
  type ClusteringRecord,
  type TripDocument,
  type TripItineraryRecord,
} from "../models/Trip.js";

const WEATHER_TTL_MS = 24 * 60 * 60 * 1000;
const ATTRACTIONS_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeText(value: string): string | null {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function applyText(
  current: string | null,
  value: string | null | undefined,
): string | null {
  if (value === undefined) {
    return current;
  }

  return value === null ? null : normalizeText(value);
}

function mergeInterests(current: string[], incoming: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const interest of [...current, ...incoming]) {
    const normalized = interest.trim().toLowerCase();

    if (!normalized || seen.has(normalized) || merged.length >= LIMITS.interests) {
      continue;
    }

    seen.add(normalized);
    merged.push(normalized);
  }

  return merged;
}

function toPlainAnalysis(stored: TripDocument["analysis"]): TripAnalysis {
  return {
    destination: stored.destination,
    country: stored.country,
    startDate: stored.startDate,
    endDate: stored.endDate,
    durationDays: stored.durationDays,
    travelers: stored.travelers,
    budget: {
      amount: stored.budget.amount,
      currency: stored.budget.currency,
      type: stored.budget.type,
    },
    interests: [...stored.interests],
    pace: stored.pace,
    maxWalkingDistanceKm: stored.maxWalkingDistanceKm,
    notes: stored.notes,
    location: stored.location
      ? {
          lat: stored.location.lat,
          lng: stored.location.lng,
          city: stored.location.city ?? null,
          country: stored.location.country ?? null,
        }
      : null,
  };
}

export function mergeRequirements(
  stored: TripDocument["analysis"],
  answers: TripRequirementsAnswers,
): TripAnalysis {
  const next: TripAnalysis = toPlainAnalysis(stored);

  next.destination = applyText(next.destination, answers.destination);
  next.country = applyText(next.country, answers.country);

  if (answers.startDate !== undefined) {
    next.startDate = answers.startDate;
  }

  if (answers.endDate !== undefined) {
    next.endDate = answers.endDate;
  }

  if (answers.durationDays !== undefined) {
    next.durationDays = answers.durationDays;
  }

  if (answers.travelers !== undefined) {
    next.travelers = answers.travelers;
  }

  if (answers.budget) {
    const { amount, currency, type } = answers.budget;

    next.budget = {
      amount: amount === undefined ? next.budget.amount : amount,
      currency:
        currency === undefined
          ? next.budget.currency
          : currency === null
            ? null
            : currency.trim().toUpperCase(),
      type: type === undefined ? next.budget.type : type,
    };

    if (next.budget.amount === null) {
      next.budget = { amount: null, currency: null, type: null };
    }
  }

  if (answers.interests !== undefined) {
    next.interests = answers.interests === null ? [] : mergeInterests(next.interests, answers.interests);
  }

  if (answers.pace !== undefined) {
    next.pace = answers.pace;
  }

  if (answers.maxWalkingDistanceKm !== undefined) {
    next.maxWalkingDistanceKm = answers.maxWalkingDistanceKm;
  }

  next.notes = applyText(next.notes, answers.notes);

  if (answers.location !== undefined) {
    next.location = answers.location === null ? null : answers.location;
  }

  return deriveTripSchedule(next);
}

function isClearedAnswer(field: AskableField, answers: TripRequirementsAnswers): boolean {
  if (field === "budget") {
    const budget = answers.budget;

    return (
      budget !== undefined &&
      budget.amount === null &&
      budget.currency === null &&
      budget.type === null
    );
  }

  if (field === "interests") {
    const interests = answers.interests;

    return interests === null || (interests !== undefined && interests.length === 0);
  }

  return answers[field] !== undefined && answers[field] === null;
}

export function mergeConfirmedFields(
  current: AskableField[],
  incoming: AskableField[],
  answers: TripRequirementsAnswers,
): AskableField[] {
  const kept = new Set([...current, ...incoming]);

  for (const field of current) {
    if (!incoming.includes(field) && isClearedAnswer(field, answers)) {
      kept.delete(field);
    }
  }

  return ASKABLE_FIELDS.filter((field) => kept.has(field));
}

export interface UpsertTripDraftInput {
  userId: string;
  prompt: string;
  badges: string[];
  analysis: TripAnalysis;
}

async function ensureLocation(analysis: TripAnalysis): Promise<TripAnalysis> {
  if (analysis.location) {
    return analysis;
  }

  const query = [analysis.destination, analysis.country]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ");

  if (!query) {
    return analysis;
  }

  const geo = await geocodeLocation(query);

  return geo ? { ...analysis, location: geo } : analysis;
}

export interface WeatherState {
  days: TripDayWeather[];
  fetchedAt: Date | null;
}

export async function ensureWeather(
  analysis: TripAnalysis,
  current: TripDayWeather[],
  fetchedAt: Date | null,
): Promise<WeatherState> {
  const { location, startDate, endDate } = analysis;

  if (!location || !startDate || !endDate) {
    return current.length === 0 ? { days: current, fetchedAt } : { days: [], fetchedAt: null };
  }

  const isFresh = fetchedAt !== null && Date.now() - fetchedAt.getTime() < WEATHER_TTL_MS;

  if (isFresh && coversForecastRange(current, startDate, endDate)) {
    return { days: current, fetchedAt };
  }

  const fresh = await fetchDailyWeather(location.lat, location.lng, startDate, endDate);

  if (fresh) {
    return { days: fresh, fetchedAt: new Date() };
  }

  if (coversForecastRange(current, startDate, endDate)) {
    return { days: current, fetchedAt };
  }

  return { days: [], fetchedAt: null };
}

function sameWeather(a: TripDayWeather[], b: TripDayWeather[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (day, index) =>
        day.date === b[index].date &&
        day.weatherCode === b[index].weatherCode &&
        day.temperatureMax === b[index].temperatureMax,
    )
  );
}

export async function backfillTripWeather(trip: TripDocument): Promise<void> {
  const weather = await ensureWeather(trip.analysis, trip.weather, trip.weatherFetchedAt);

  if (
    sameWeather(weather.days, trip.weather) &&
    weather.fetchedAt === trip.weatherFetchedAt
  ) {
    return;
  }

  trip.set("weather", weather.days);
  trip.set("weatherFetchedAt", weather.fetchedAt);
  await trip.save();
}

export interface AttractionsState {
  attractions: TripAttraction[];
  fetchedAt: Date | null;
  query: AttractionsQueryRecord | null;
}

function buildAttractionsQuery(analysis: TripAnalysis): AttractionsQueryRecord | null {
  const { location, interests } = analysis;

  if (!location) {
    return null;
  }

  return {
    lat: location.lat,
    lng: location.lng,
    interests: [...interests],
  };
}

function sameAttractionsQuery(
  a: AttractionsQueryRecord | null,
  b: AttractionsQueryRecord | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }

  return (
    a.lat === b.lat &&
    a.lng === b.lng &&
    a.interests.length === b.interests.length &&
    a.interests.every((interest, index) => interest === b.interests[index])
  );
}

function sameAttractions(a: TripAttraction[], b: TripAttraction[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (attraction, index) =>
        attraction.name === b[index].name &&
        attraction.category === b[index].category &&
        attraction.lat === b[index].lat &&
        attraction.lng === b[index].lng &&
        attraction.score === b[index].score,
    )
  );
}

function buildClustering(analysis: TripAnalysis, attractions: TripAttraction[]): ClusteringRecord {
  const result = clusterPois(attractions, {
    days: analysis.durationDays,
    pace: analysis.pace,
  });

  return {
    days: result.days,
    pace: analysis.pace ?? null,
    clusters: result.clusters,
    unassigned: result.unassigned,
  };
}

function isClusteringStale(
  clustering: ClusteringRecord | null | undefined,
  analysis: TripAnalysis,
): boolean {
  if (clustering === null || clustering === undefined) {
    return true;
  }

  return (
    clustering.days !== normalizeDays(analysis.durationDays) ||
    clustering.pace !== (analysis.pace ?? null)
  );
}

export async function ensureAttractions(
  analysis: TripAnalysis,
  current: TripAttraction[],
  fetchedAt: Date | null,
  query: AttractionsQueryRecord | null,
  weather: readonly TripDayWeather[],
): Promise<AttractionsState> {
  const nextQuery = buildAttractionsQuery(analysis);

  if (!nextQuery) {
    return { attractions: [], fetchedAt: null, query: null };
  }

  const isFresh =
    fetchedAt !== null && Date.now() - fetchedAt.getTime() < ATTRACTIONS_TTL_MS;

  if (isFresh && sameAttractionsQuery(query, nextQuery)) {
    return { attractions: current, fetchedAt, query };
  }

  const fresh = await fetchAttractions(nextQuery.lat, nextQuery.lng, nextQuery.interests, {
    weather,
  });

  if (fresh) {
    for (const attraction of fresh) {
      const saved = current.find(p => attraction.placeId && p.placeId === attraction.placeId);
      if (saved?.admission?.source === "official" && saved.admission.checkedAt && saved.admission.status !== "unknown") attraction.admission = saved.admission;
    }
    return { attractions: fresh, fetchedAt: new Date(), query: nextQuery };
  }

  if (sameAttractionsQuery(query, nextQuery)) {
    return { attractions: current, fetchedAt, query };
  }

  return { attractions: [], fetchedAt: null, query: null };
}

export async function backfillTripAttractions(trip: TripDocument): Promise<void> {
  // Generated itineraries retain their authoritative candidate pool. Additional
  // discoveries are explicitly merged by editing/regeneration, never replaced
  // by a page refresh (which could race an edit or discard its saved options).
  if (trip.status === "ready" && trip.itinerary && trip.attractions.length > 0) return;
  const attractions = await ensureAttractions(
    trip.analysis,
    trip.attractions,
    trip.attractionsFetchedAt,
    trip.attractionsQuery,
    trip.weather,
  );

  const attractionsUnchanged =
    sameAttractions(attractions.attractions, trip.attractions) &&
    attractions.fetchedAt === trip.attractionsFetchedAt &&
    sameAttractionsQuery(attractions.query, trip.attractionsQuery);
  const staleClustering = isClusteringStale(trip.clustering, trip.analysis);

  if (attractionsUnchanged && !staleClustering) {
    return;
  }

  if (!attractionsUnchanged) {
    trip.set("attractions", attractions.attractions);
    trip.set("attractionsFetchedAt", attractions.fetchedAt);
    trip.set("attractionsQuery", attractions.query);
  }

  trip.set("clustering", buildClustering(trip.analysis, attractions.attractions));
  await trip.save();
}

export async function upsertTripDraft(input: UpsertTripDraftInput): Promise<TripDocument> {
  const analysis = await ensureLocation(input.analysis);
  const gaps = missingFields(analysis);

  const existing = await TripModel.findOne({
    user: new Types.ObjectId(input.userId),
    status: "draft",
  }).exec();

  const weather = await ensureWeather(
    analysis,
    existing?.weather ?? [],
    existing?.weatherFetchedAt ?? null,
  );

  const attractions = await ensureAttractions(
    analysis,
    existing?.attractions ?? [],
    existing?.attractionsFetchedAt ?? null,
    existing?.attractionsQuery ?? null,
    weather.days,
  );

  const draft = await TripModel.findOneAndUpdate(
    { user: new Types.ObjectId(input.userId), status: "draft" },
    {
      $set: {
        prompt: input.prompt,
        badges: input.badges,
        analysis: analysis,
        confirmedFields: [],
        missingFields: gaps,
        weather: weather.days,
        weatherFetchedAt: weather.fetchedAt,
        attractions: attractions.attractions,
        attractionsFetchedAt: attractions.fetchedAt,
        attractionsQuery: attractions.query,
        clustering: buildClustering(analysis, attractions.attractions),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).exec();

  if (!draft) {
    throw new Error("Trip draft could not be saved");
  }

  return draft;
}

export async function saveTripRequirements(
  draft: TripDocument,
  answers: TripRequirementsAnswers,
  confirmedFields: AskableField[],
  regenerate = false,
): Promise<TripDocument> {
  const merged = mergeRequirements(draft.analysis, answers);
  if (answers.location === undefined &&
      (merged.destination !== draft.analysis.destination || merged.country !== draft.analysis.country)) {
    merged.location = null;
  }
  const analysis = await ensureLocation(merged);
  const locationChanged = analysis.location?.lat !== draft.analysis.location?.lat ||
    analysis.location?.lng !== draft.analysis.location?.lng;
  const weather = await ensureWeather(
    analysis, locationChanged ? [] : draft.weather, locationChanged ? null : draft.weatherFetchedAt,
  );
  const attractions = await ensureAttractions(
    analysis,
    draft.attractions,
    draft.attractionsFetchedAt,
    draft.attractionsQuery,
    weather.days,
  );

  const confirmed = mergeConfirmedFields(draft.confirmedFields, confirmedFields, answers);

  const gaps = missingFields(analysis, confirmed);
  const saved = await TripModel.findOneAndUpdate(
    {
      _id: draft._id,
      user: draft.user,
      status: { $in: regenerate ? ["draft", "failed", "ready"] : ["draft", "failed"] },
      updatedAt: (draft as TripDocument & { updatedAt: Date }).updatedAt,
    },
    { $set: {
      analysis, weather: weather.days, weatherFetchedAt: weather.fetchedAt,
      attractions: attractions.attractions, attractionsFetchedAt: attractions.fetchedAt,
      attractionsQuery: attractions.query, clustering: buildClustering(analysis, attractions.attractions),
      confirmedFields: confirmed, missingFields: gaps, status: "draft", "generation.error": null,
      ...(regenerate ? { itinerary: null, regeneration: null, "generation.generatedAt": null, "generation.startedAt": null } : {}),
    }, ...(regenerate ? { $inc: { itineraryVersion: 1 } } : {}) },
    { new: true, runValidators: true },
  ).exec();
  if (!saved) {
    const error = new Error("The trip changed while saving. Reload it and try again.");
    throw Object.assign(error, { status: 409, expose: true });
  }
  return saved;
}

export class TripRequirementsIncompleteError extends Error {
  readonly missing: AskableField[];

  constructor(missing: AskableField[]) {
    super("Trip requirements are incomplete");
    this.name = "TripRequirementsIncompleteError";
    this.missing = missing;
  }
}

/**
 * Finalizes a draft once every askable field is answered. Keeps the trip in
 * `draft` status — generation is a separate, explicit operation.
 */
export async function confirmTripRequirements(trip: TripDocument): Promise<TripDocument> {
  const analysis = tripAnalysisSchema.parse(toPlainAnalysis(trip.analysis));
  const missing = missingFields(analysis, trip.confirmedFields);

  if (missing.length > 0) {
    throw new TripRequirementsIncompleteError(missing);
  }

  trip.confirmedFields = ASKABLE_FIELDS.filter((field) => !missing.includes(field));
  trip.missingFields = [];

  return trip.save();
}

export function toTripAnalysisResult(draft: TripDocument): TripAnalysisResult {
  const analysis = tripAnalysisSchema.parse(toPlainAnalysis(draft.analysis));
  const gaps = missingFields(analysis, draft.confirmedFields);

  return {
    draftId: draft._id.toString(),
    analysis,
    missingFields: gaps,
    requirementsComplete: gaps.length === 0,
  };
}

export function toTripEquipment(trip: TripDocument): TripEquipmentItem[] {
  return trip.equipment.map((item) => ({
    id: item._id.toString(),
    name: item.name,
    count: item.count,
  }));
}

export function toTripSummary(trip: TripDocument): TripSummary {
  const analysis = trip.analysis;

  return {
    id: trip._id.toString(),
    status: trip.status,
    prompt: trip.prompt,
    badges: trip.badges,
    destination: analysis.destination,
    country: analysis.country,
    startDate: analysis.startDate,
    endDate: analysis.endDate,
    durationDays: analysis.durationDays,
    travelers: analysis.travelers ?? null,
    budget: {
      amount: analysis.budget.amount ?? null,
      currency: analysis.budget.currency ?? null,
      type: analysis.budget.type ?? null,
    },
    location: analysis.location ?? null,
    fixtureKey: trip.fixtureKey ?? null,
    createdAt: (trip as any).createdAt ? (trip as any).createdAt.toISOString() : null,
    updatedAt: (trip as any).updatedAt ? (trip as any).updatedAt.toISOString() : null,
  };
}

function toPlainItinerary(trip: TripDocument): TripItineraryRecord | null {
  if (!trip.itinerary) {
    return null;
  }

  const candidate = trip.itinerary as unknown as { toObject?: () => TripItineraryRecord };

  return typeof candidate.toObject === "function" ? candidate.toObject() : trip.itinerary;
}

function toTripItinerary(trip: TripDocument, generatedAt: string | null): TripItinerary | null {
  const record = toPlainItinerary(trip);

  if (!record) {
    return null;
  }

  return {
    timeZone: record.timeZone,
    routingSource: record.routingSource,
    generatedAt,
    days: record.days.map((day) => ({
      dayIndex: day.dayIndex,
      date: day.date,
      timeZone: day.timeZone,
      activities: day.activities.map((activity) => ({
        ...activity,
        warnings: activity.warnings ? [...activity.warnings] : undefined,
      })),
      stops: day.stops.map((stop) => ({ ...stop })),
      geometry: day.geometry ?? null,
      segments: day.segments.map((segment) => ({ ...segment })),
      totalVisitMinutes: day.totalVisitMinutes,
      totalTravelMinutes: day.totalTravelMinutes,
      totalDistanceMeters: day.totalDistanceMeters,
      partiallyEstimated: day.partiallyEstimated,
      warnings: [...day.warnings],
    })),
    unscheduled: record.unscheduled.map((entry) => ({
      place: { ...entry.place },
      dayIndex: entry.dayIndex,
      reason: entry.reason,
      detail: entry.detail ?? null,
    })),
  };
}

export function toTripDetail(trip: TripDocument): TripDetail {
  const result = toTripAnalysisResult(trip);
  const generatedAt = trip.generation?.generatedAt
    ? trip.generation.generatedAt.toISOString()
    : null;

  return {
    ...result,
    budgetData: budgetData(trip.toObject()),
    itineraryVersion: trip.itineraryVersion ?? 0,
    id: trip._id.toString(),
    status: trip.status,
    prompt: trip.prompt,
    badges: trip.badges,
    equipment: toTripEquipment(trip),
    weather: trip.weather.map((day) => ({
      date: day.date,
      weatherCode: day.weatherCode,
      temperatureMax: day.temperatureMax,
    })),
    itinerary: toTripItinerary(trip, generatedAt),
    admissionSummary: summarizeAdmission(trip.itinerary?.days ?? [], trip.attractions, trip.analysis.travelers),
    generation: {
      startedAt: trip.generation?.startedAt ? trip.generation.startedAt.toISOString() : null,
      generatedAt,
      error: trip.generation?.error ?? null,
    },
    fixtureKey: trip.fixtureKey ?? null,
    createdAt: (trip as any).createdAt ? (trip as any).createdAt.toISOString() : null,
    updatedAt: (trip as any).updatedAt ? (trip as any).updatedAt.toISOString() : null,
  };
}
