import { z } from "zod";
import { addDays, diffDaysInclusive, isAfter, isIsoDate } from "./dates.js";

export const PACE_VALUES = ["relaxed", "balanced", "packed"] as const;
export type Pace = (typeof PACE_VALUES)[number];

export interface PaceOption {
  value: Pace;
  label: string;
}

export const PACE_OPTIONS: PaceOption[] = [
  { value: "relaxed", label: "Relaxed" },
  { value: "balanced", label: "Balanced" },
  { value: "packed", label: "Packed" },
];

export interface InterestOption {
  id: string;
  label: string;
}

export const INTEREST_OPTIONS: InterestOption[] = [
  { id: "food", label: "Food" },
  { id: "architecture", label: "Architecture" },
  { id: "beach", label: "Beach" },
  { id: "nature", label: "Nature" },
  { id: "culture", label: "Culture" },
  { id: "shopping", label: "Shopping" },
  { id: "nightlife", label: "Nightlife" },
];

export const BUDGET_TYPE_VALUES = ["total", "per_person"] as const;
export type BudgetType = (typeof BUDGET_TYPE_VALUES)[number];

export const LIMITS = {
  prompt: 2000,
  badges: 10,
  travelers: 50,
  durationDays: 365,
  maxWalkingDistanceKm: 100,
  interests: 24,
  notes: 2000,
} as const;

export const tripLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  city: z.string().trim().min(1).max(120).nullable().optional(),
  country: z.string().trim().min(1).max(120).nullable().optional(),
});

export type TripLocation = z.infer<typeof tripLocationSchema>;

const isoDateSchema = z.string().refine(isIsoDate, "Use the YYYY-MM-DD format");

export const tripBudgetSchema = z.object({
  amount: z.number().nonnegative().nullable(),
  currency: z.string().trim().min(1).max(8).nullable(),
  type: z.enum(BUDGET_TYPE_VALUES).nullable(),
});

export type TripBudget = z.infer<typeof tripBudgetSchema>;

export const tripAnalysisSchema = z.object({
  destination: z.string().trim().min(1).max(120).nullable(),
  country: z.string().trim().min(1).max(120).nullable(),
  startDate: isoDateSchema.nullable(),
  endDate: isoDateSchema.nullable(),
  durationDays: z.number().int().positive().max(LIMITS.durationDays).nullable(),
  travelers: z.number().int().positive().max(LIMITS.travelers).nullable(),
  budget: tripBudgetSchema,
  interests: z.array(z.string().trim().min(1).max(60)).max(LIMITS.interests),
  pace: z.enum(PACE_VALUES).nullable(),
  maxWalkingDistanceKm: z.number().nonnegative().max(LIMITS.maxWalkingDistanceKm).nullable(),
  notes: z.string().trim().max(LIMITS.notes).nullable(),
  location: tripLocationSchema.nullable().optional(),
});

export type TripAnalysis = z.infer<typeof tripAnalysisSchema>;

export const ASKABLE_FIELDS = [
  "destination",
  "country",
  "startDate",
  "endDate",
  "durationDays",
  "travelers",
  "budget",
  "interests",
] as const;

export type AskableField = (typeof ASKABLE_FIELDS)[number];

export const askableFieldSchema = z.enum(ASKABLE_FIELDS);

export const analyzeTripRequestSchema = z
  .object({
    prompt: z.string().trim().max(LIMITS.prompt).default(""),
    badges: z.array(z.string().trim().min(1).max(40)).max(LIMITS.badges).default([]),
  })
  .refine((value) => value.prompt.length > 0 || value.badges.length > 0, {
    message: "Describe your trip or pick at least one interest",
  });

export type AnalyzeTripRequest = z.infer<typeof analyzeTripRequestSchema>;

export const budgetAnswersSchema = z.object({
  amount: z.number().nonnegative().nullish(),
  currency: z.string().trim().min(1).max(8).nullish(),
  type: z.enum(BUDGET_TYPE_VALUES).nullish(),
});

export const tripRequirementsAnswersSchema = z.object({
  destination: z.string().trim().min(1).max(120).nullish(),
  country: z.string().trim().min(1).max(120).nullish(),
  startDate: isoDateSchema.nullish(),
  endDate: isoDateSchema.nullish(),
  durationDays: z.number().int().positive().max(LIMITS.durationDays).nullish(),
  travelers: z.number().int().positive().max(LIMITS.travelers).nullish(),
  budget: budgetAnswersSchema.optional(),
  interests: z.array(z.string().trim().min(1).max(60)).max(LIMITS.interests).nullish(),
  pace: z.enum(PACE_VALUES).nullish(),
  maxWalkingDistanceKm: z.number().nonnegative().max(LIMITS.maxWalkingDistanceKm).nullish(),
  notes: z.string().trim().max(LIMITS.notes).nullish(),
  location: tripLocationSchema.nullish(),
});

export type TripRequirementsAnswers = z.infer<typeof tripRequirementsAnswersSchema>;

export const updateTripRequirementsSchema = z.object({
  answers: tripRequirementsAnswersSchema.nullish().transform((answers) => answers ?? {}),
  confirmedFields: z.array(askableFieldSchema).max(ASKABLE_FIELDS.length).default([]),
});

export type UpdateTripRequirements = z.infer<typeof updateTripRequirementsSchema>;

export interface TripAnalysisResult {
  draftId: string;
  analysis: TripAnalysis;
  missingFields: AskableField[];
  requirementsComplete: boolean;
}

export function findInterestOption(id: string): InterestOption | undefined {
  const normalized = id.trim().toLowerCase();

  return INTEREST_OPTIONS.find((option) => option.id === normalized);
}

export function interestLabel(id: string): string {
  return findInterestOption(id)?.label ?? id;
}

export function deriveTripSchedule(analysis: TripAnalysis): TripAnalysis {
  const { startDate, endDate, durationDays } = analysis;

  if (startDate && endDate && !isAfter(startDate, endDate)) {
    return { ...analysis, durationDays: diffDaysInclusive(startDate, endDate) };
  }

  if (startDate && durationDays && !endDate) {
    return { ...analysis, endDate: addDays(startDate, durationDays - 1) };
  }

  return analysis;
}

export function missingFields(
  analysis: TripAnalysis,
  confirmedFields: readonly AskableField[] = [],
): AskableField[] {
  const confirmed = new Set(confirmedFields);
  const missing: AskableField[] = [];
  const collect = (field: AskableField): void => {
    if (!confirmed.has(field)) {
      missing.push(field);
    }
  };

  if (analysis.destination === null) {
    collect("destination");
  }

  if (analysis.country === null) {
    collect("country");
  }

  const hasFullRange = analysis.startDate !== null && analysis.endDate !== null;

  if (!hasFullRange) {
    if (analysis.startDate === null) {
      collect("startDate");
    }

    if (analysis.endDate === null) {
      collect("endDate");
    }

    if (analysis.durationDays === null) {
      collect("durationDays");
    }
  }

  if (analysis.travelers === null) {
    collect("travelers");
  }

  if (analysis.budget.amount === null) {
    collect("budget");
  }

  if (analysis.interests.length === 0) {
    collect("interests");
  }

  return missing;
}