import { supportedLocaleSchema, type SupportedLocale } from "./locale.js";
import { z } from "zod";
import { destinationIdSchema } from "./saved.js";
import { attractionOpeningHoursSchema } from "./openingHours.js";
import { attractionAdmissionSchema, type AttractionAdmission, type AdmissionSummary } from "./admission.js";
import { addDays, diffDaysInclusive, isAfter, isIsoDate } from "./dates.js";
import type { GeoLineString, RouteSegment, RouteSource } from "./planner.js";
import type { ScheduledActivity, UnscheduledReason } from "./scheduling.js";

export const TRIP_STATUS_VALUES = ["draft", "generating", "ready", "failed"] as const;
export type TripStatus = (typeof TRIP_STATUS_VALUES)[number];

export const tripStatusSchema = z.enum(TRIP_STATUS_VALUES);

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
  equipment: 100,
  regenerationInstructions: 500,
} as const;

export const tripLocationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
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
  destinationId: destinationIdSchema.nullable().optional(),
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

export const tripDayWeatherSchema = z.object({
  date: isoDateSchema,
  weatherCode: z.number().int().min(0).max(99),
  temperatureMax: z.number(),
});

export type TripDayWeather = z.infer<typeof tripDayWeatherSchema>;

export const POI_ENVIRONMENT_SCHEMA_VALUES = ["indoor", "outdoor", "unknown"] as const;

export const tripAttractionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  score: z.number().min(0).max(100).nullish(),
  /** Stable upstream identifier (e.g. `node/12345`) used to keep POIs consistent. */
  placeId: z.string().trim().min(1).max(120).nullish(),
  /** Provider-classified indoor/outdoor environment, when known. */
  environment: z.enum(POI_ENVIRONMENT_SCHEMA_VALUES).nullish(),
  /** Known or provider-supplied visit duration in minutes, when available. */
  visitDurationMinutes: z.number().int().positive().max(1440).nullish(),
  openingHours: attractionOpeningHoursSchema.nullish(),
  admission: attractionAdmissionSchema.nullish(),
  source: z.enum(["overpass", "geoapify"]).optional(),
  sourceId: z.string().max(2000).optional(),
  address: z.string().max(2000).optional(),
  description: z.string().max(10000).optional(),
});

export type TripAttraction = z.infer<typeof tripAttractionSchema>;

/** A scheduled attraction as rendered on the timeline and map. */
export interface ItineraryStop {
  /** Server-derived global identity, independent of the itinerary item ID. */
  attractionKey?: string;
  admission?: AttractionAdmission | null;
  placeId: string | null;
  name: string;
  category: string;
  lat: number;
  lng: number;
  score: number | null;
}

export interface ItineraryDay {
  routeStopOffset?: number;
  routeReturnsToStart?: boolean;
  travelMode?: import("./planner.js").TravelMode;
  routingSource?: RouteSource;
  dayIndex: number;
  /** Destination-local calendar date (YYYY-MM-DD), or "" when unknown. */
  date: string;
  timeZone: string;
  activities: ScheduledActivity[];
  /** Ordered attractions for the day, used for map markers. */
  stops: ItineraryStop[];
  geometry: GeoLineString | null;
  segments: RouteSegment[];
  totalVisitMinutes: number;
  totalTravelMinutes: number | null;
  totalDistanceMeters: number | null;
  partiallyEstimated: boolean;
  warnings: string[];
}

export interface TripUnscheduledPlace {
  place: ItineraryStop;
  dayIndex: number | null;
  reason: UnscheduledReason;
  detail: string | null;
}

export interface TripGeneration {
  startedAt: string | null;
  generatedAt: string | null;
  error: string | null;
}

export interface TripItinerary {
  timeZone: string;
  routingSource: RouteSource;
  generatedAt: string | null;
  days: ItineraryDay[];
  unscheduled: TripUnscheduledPlace[];
}

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
    locale: supportedLocaleSchema.optional(),
    destinationId: destinationIdSchema.optional(),
    prompt: z.string().trim().max(LIMITS.prompt).default(""),
    badges: z.array(z.string().trim().min(1).max(40)).max(LIMITS.badges).default([]),
    // Explicit editable selections; omitted by legacy prompt-only callers.
    interests: z.array(z.string().trim().min(1).max(60)).max(LIMITS.interests).optional(),
    pace: z.enum(PACE_VALUES).optional(),
    maxWalkingDistanceKm: z.number().nonnegative().max(LIMITS.maxWalkingDistanceKm).optional(),
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
  regenerate: z.boolean().optional(),
  answers: tripRequirementsAnswersSchema.nullish().transform((answers) => answers ?? {}),
  confirmedFields: z.array(askableFieldSchema).max(ASKABLE_FIELDS.length).default([]),
});

export type UpdateTripRequirements = z.infer<typeof updateTripRequirementsSchema>;

export interface TripAnalysisResult {
  contentLocale?: SupportedLocale;
  draftId: string;
  analysis: TripAnalysis;
  missingFields: AskableField[];
  requirementsComplete: boolean;
}

export const EQUIPMENT_CATEGORIES = ["documents", "clothing", "toiletries", "electronics", "health", "other"] as const;
export const equipmentCategorySchema = z.enum(EQUIPMENT_CATEGORIES);
export type EquipmentCategory = z.infer<typeof equipmentCategorySchema>;

export const tripEquipmentItemSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  count: z.number().int().positive().max(999),
  category: equipmentCategorySchema.default("other"),
  packed: z.boolean().default(false),
  source: z.enum(["manual", "ai"]).optional(),
  reason: z.string().trim().max(240).optional(),
});

export type TripEquipmentItem = z.infer<typeof tripEquipmentItemSchema>;

export const tripEquipmentSchema = z.array(tripEquipmentItemSchema);

export type TripEquipment = z.infer<typeof tripEquipmentSchema>;

export const createTripEquipmentItemSchema = z.object({
  name: tripEquipmentItemSchema.shape.name,
  count: tripEquipmentItemSchema.shape.count.default(1),
  category: equipmentCategorySchema.optional(),
});

export type CreateTripEquipmentItem = z.infer<typeof createTripEquipmentItemSchema>;

export const updateTripEquipmentItemSchema = z
  .object({
    name: tripEquipmentItemSchema.shape.name.optional(),
    count: tripEquipmentItemSchema.shape.count.optional(),
    category: equipmentCategorySchema.optional(),
    packed: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Provide an item field to update",
  });

export type UpdateTripEquipmentItem = z.infer<typeof updateTripEquipmentItemSchema>;

export const tripEquipmentResponseSchema = z.object({
  equipment: tripEquipmentSchema,
});

export type TripEquipmentResponse = z.infer<typeof tripEquipmentResponseSchema>;

export const tripListQuerySchema = z.object({
  status: tripStatusSchema.optional(),
});

export type TripListQuery = z.infer<typeof tripListQuerySchema>;

export interface TripSummary {
  contentLocale?: SupportedLocale;
  id: string;
  status: TripStatus;
  prompt: string;
  badges: string[];
  destination: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  travelers: number | null;
  budget: TripBudget;
  location: TripLocation | null;
  fixtureKey: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TripDetail extends TripAnalysisResult {
  weatherAvailability?: import("./weather.js").WeatherAvailability;
  quality?: import("./quality.js").TripQualityReport | null;
  budgetData?: import("./budget.js").TripBudgetData;
  admissionSummary?: AdmissionSummary;
  /** Persisted itinerary revision; optional for compatibility with older clients. */
  itineraryVersion?: number;
  id: string;
  status: TripStatus;
  prompt: string;
  badges: string[];
  equipment: TripEquipmentItem[];
  weather: TripDayWeather[];
  itinerary: TripItinerary | null;
  generation: TripGeneration;
  fixtureKey: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
