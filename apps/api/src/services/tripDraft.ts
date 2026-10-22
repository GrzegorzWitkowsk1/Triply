import { ownerFilter, storedOwner, guestOwnerId } from "../middleware/tripIdentity.js";
import { savedAttractionIdentity, savedAttractionPlace } from "./savedAttractionIdentity.js";
import { validateGuestDuration } from "./guestLimits.js";
import { budgetData } from "./budgetSummary.js";
import { assessTripQuality } from "./tripQualityService.js";
import {
  deriveTripSchedule,
  summarizeAdmission,
  missingFields,
  LIMITS,
  tripAnalysisSchema,
  tripLocationSchema,
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
  type WeatherAvailability,
} from "@triply/shared";
import { fetchAttractions } from "./attractions.js";
import { DestinationResolutionError, resolveDestination } from "./location.js";
import { clusterPois, normalizeDays } from "./poiClustering.js";
import { describeWeather, ensureWeatherData } from "./weather.js";
import { refreshTripWeather } from "./tripWeather.js";
import {
  TripModel,
  type AttractionsQueryRecord,
  type ClusteringRecord,
  type TripDocument,
  type TripItineraryRecord,
} from "../models/Trip.js";

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

function normalizeInterests(incoming: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const interest of incoming) {
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
    destinationId: stored.destinationId ?? null,
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
    location: tripLocationSchema.safeParse(stored.location).success && stored.location
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
  if (next.destination !== stored.destination || next.country !== stored.country) next.destinationId = null;

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
    next.interests = answers.interests === null ? [] : normalizeInterests(answers.interests);
  }

  if (answers.pace !== undefined) {
    next.pace = answers.pace;
  }

  if (answers.maxWalkingDistanceKm !== undefined) {
    next.maxWalkingDistanceKm = answers.maxWalkingDistanceKm;
  }

  next.notes = applyText(next.notes, answers.notes);

  if (answers.location !== undefined && (answers.location !== null ||
      next.destination !== stored.destination || next.country !== stored.country)) {
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
  draftId?: string;
  prompt: string;
  badges: string[];
  analysis: TripAnalysis;
}

async function ensureLocation(analysis: TripAnalysis): Promise<TripAnalysis> {
  if (tripLocationSchema.safeParse(analysis.location).success) {
    return analysis;
  }
  if (!analysis.destination?.trim() || !analysis.country?.trim()) {
    return { ...analysis, location: null };
  }
  try {
    return { ...analysis, location: await resolveDestination(analysis.destination, analysis.country) };
  } catch (error) {
    if (!(error instanceof DestinationResolutionError)) throw error;
    // Drafts remain editable during lookup outages; generation retries with an actionable error.
    return { ...analysis, location: null };
  }
}

export interface WeatherState {
  days: TripDayWeather[];
  fetchedAt: Date | null;
  availability?: WeatherAvailability;
}

export async function ensureWeather(
  analysis: TripAnalysis,
  current: TripDayWeather[],
  fetchedAt: Date | null,
  previous?: WeatherAvailability | null,
): Promise<WeatherState> {
  return ensureWeatherData(analysis, current, fetchedAt, previous);
}

export async function backfillTripWeather(trip: TripDocument): Promise<void> {
  if (!tripLocationSchema.safeParse(trip.analysis.location).success) return;
  const saved = await refreshTripWeather(trip);
  // Keep the route's local snapshot current without saving the whole document.
  trip.set("weather", saved.weather);
  trip.set("weatherFetchedAt", saved.weatherFetchedAt);
  trip.set("weatherAvailability", saved.weatherAvailability);
  trip.set("updatedAt", saved.updatedAt);
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
  if (!tripLocationSchema.safeParse(trip.analysis.location).success) return;
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
  if (guestOwnerId(input.userId) && !input.draftId) throw new Error("Guest storage reservation required");
  const existing = await TripModel.findOne({
    ...ownerFilter(input.userId),
    ...(input.draftId ? { _id: input.draftId } : {}),
    status: "draft",
  }).exec();

  const incoming = tripAnalysisSchema.parse(input.analysis);
  validateGuestDuration(input.userId, incoming);
  if (!incoming.location && existing && incoming.destination === existing.analysis.destination &&
      incoming.country === existing.analysis.country && tripLocationSchema.safeParse(existing.analysis.location).success) {
    incoming.location = toPlainAnalysis(existing.analysis).location;
  }
  const analysis = await ensureLocation(incoming);
  const gaps = missingFields(analysis);
  const locationChanged = analysis.location?.lat !== existing?.analysis.location?.lat ||
    analysis.location?.lng !== existing?.analysis.location?.lng;
  const weatherInputsChanged = locationChanged || analysis.startDate !== existing?.analysis.startDate ||
    analysis.endDate !== existing?.analysis.endDate;

  const weather = await ensureWeather(
    analysis,
    locationChanged ? [] : existing?.weather ?? [],
    locationChanged ? null : existing?.weatherFetchedAt ?? null,
    weatherInputsChanged ? null : existing?.weatherAvailability,
  );

  const attractions = await ensureAttractions(
    analysis,
    existing?.attractions ?? [],
    existing?.attractionsFetchedAt ?? null,
    existing?.attractionsQuery ?? null,
    weather.days,
  );

  const draft = await TripModel.findOneAndUpdate(
    { ...ownerFilter(input.userId), status: "draft",
      ...(existing ? { _id: existing._id, updatedAt: existing.updatedAt } : input.draftId ? { _id: input.draftId } : {}) },
    {
      $set: {
        prompt: input.prompt,
        badges: input.badges,
        analysis: analysis,
        confirmedFields: [],
        missingFields: gaps,
        weather: weather.days,
        weatherFetchedAt: weather.fetchedAt,
        weatherAvailability: weather.availability ?? null,
        attractions: attractions.attractions,
        attractionsFetchedAt: attractions.fetchedAt,
        attractionsQuery: attractions.query,
        clustering: buildClustering(analysis, attractions.attractions),
      },
    },
    { new: true, upsert: !existing, setDefaultsOnInsert: true, runValidators: true },
  ).exec();

  if (!draft) {
    throw Object.assign(new Error("The trip changed while saving. Reload it and try again."), { status: 409, expose: true });
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
  validateGuestDuration(storedOwner(draft), merged);
  if (answers.location === undefined &&
      (merged.destination !== draft.analysis.destination || merged.country !== draft.analysis.country)) {
    merged.location = null;
  }
  const analysis = await ensureLocation(merged);
  const locationChanged = analysis.location?.lat !== draft.analysis.location?.lat ||
    analysis.location?.lng !== draft.analysis.location?.lng;
  const weatherInputsChanged = locationChanged || analysis.startDate !== draft.analysis.startDate ||
    analysis.endDate !== draft.analysis.endDate;
  const weather = await ensureWeather(
    analysis, locationChanged ? [] : draft.weather, locationChanged ? null : draft.weatherFetchedAt,
    weatherInputsChanged ? null : draft.weatherAvailability,
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
      ...ownerFilter(storedOwner(draft)),
      status: { $in: regenerate ? ["draft", "failed", "ready"] : ["draft", "failed"] },
      updatedAt: (draft as TripDocument & { updatedAt: Date }).updatedAt,
    },
    { $set: {
      analysis, weather: weather.days, weatherFetchedAt: weather.fetchedAt, weatherAvailability: weather.availability ?? null,
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
  // Legacy malformed locations must not prevent confirmation of otherwise complete requirements.
  trip.set("analysis.location", analysis.location ?? null);

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
    category: item.category ?? "other",
    packed: item.packed ?? false,
    source: item.source ?? "manual",
    ...(item.source === "ai" && item.reason ? { reason: item.reason } : {}),
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
    location: tripLocationSchema.safeParse(analysis.location).success ? analysis.location ?? null : null,
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
      routeStopOffset: day.routeStopOffset,
      routeReturnsToStart: day.routeReturnsToStart,
      travelMode: day.travelMode,
      routingSource: day.routingSource,
      date: day.date,
      timeZone: day.timeZone,
      activities: day.activities.map((activity) => ({
        ...activity,
        warnings: activity.warnings ? [...activity.warnings] : undefined,
      })),
      stops: day.stops.map((stop) => ({ ...stop, attractionKey: savedAttractionIdentity(savedAttractionPlace(stop, trip.attractions)).attractionKey })),
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
    quality: trip.itinerary ? assessTripQuality(trip.toObject()) : null,
    budgetData: budgetData(trip.toObject()),
    itineraryVersion: trip.itineraryVersion ?? 0,
    id: trip._id.toString(),
    status: trip.status,
    prompt: trip.prompt,
    badges: trip.badges,
    equipment: toTripEquipment(trip),
    weatherAvailability: describeWeather(trip.analysis, trip.weather, trip.weatherAvailability),
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
