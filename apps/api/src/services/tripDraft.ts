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
} from "@triply/shared";
import { Types } from "mongoose";
import { TripModel, type TripDocument } from "../models/Trip.js";

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

export async function upsertTripDraft(input: UpsertTripDraftInput): Promise<TripDocument> {
  const gaps = missingFields(input.analysis);

  const draft = await TripModel.findOneAndUpdate(
    { user: new Types.ObjectId(input.userId), status: "draft" },
    {
      $set: {
        prompt: input.prompt,
        badges: input.badges,
        analysis: input.analysis,
        confirmedFields: [],
        missingFields: gaps,
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
  const analysis = mergeRequirements(draft.analysis, answers);
  const confirmed = mergeConfirmedFields(draft.confirmedFields, confirmedFields, answers);

  draft.set("analysis", analysis);
  draft.confirmedFields = confirmed;
  draft.missingFields = missingFields(analysis, confirmed);

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