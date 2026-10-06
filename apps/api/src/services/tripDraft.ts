import {
  deriveTripSchedule,
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
  type TripDetail,
  type TripSummary,
} from "@triply/shared";
import { Types } from "mongoose";
import { geocodeLocation } from "./location.js";
import { coversForecastRange, fetchDailyWeather } from "./weather.js";
import { TripModel, type TripDocument } from "../models/Trip.js";

const WEATHER_TTL_MS = 24 * 60 * 60 * 1000;

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
): Promise<TripDocument> {
  const merged = mergeRequirements(draft.analysis, answers);
  const analysis = await ensureLocation(merged);
  const weather = await ensureWeather(analysis, draft.weather, draft.weatherFetchedAt);

  const confirmed = mergeConfirmedFields(draft.confirmedFields, confirmedFields, answers);

  draft.set("analysis", analysis);
  draft.set("weather", weather.days);
  draft.set("weatherFetchedAt", weather.fetchedAt);
  const gaps = missingFields(analysis, confirmed);
  draft.confirmedFields = confirmed;
  draft.missingFields = gaps;

  if (gaps.length === 0) {
    draft.status = "confirmed";
  }

  return draft.save();
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

export function toTripDetail(trip: TripDocument): TripDetail {
  const result = toTripAnalysisResult(trip);

  return {
    ...result,
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
    fixtureKey: trip.fixtureKey ?? null,
    createdAt: (trip as any).createdAt ? (trip as any).createdAt.toISOString() : null,
    updatedAt: (trip as any).updatedAt ? (trip as any).updatedAt.toISOString() : null,
  };
}
