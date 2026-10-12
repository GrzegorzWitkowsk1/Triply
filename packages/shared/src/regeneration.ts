import { z } from "zod";
import {
  LIMITS,
  type ItineraryDay,
  type ItineraryStop,
  type TripUnscheduledPlace,
} from "./trip.js";

export const regenerationPreferencesSchema = z.object({
  lessWalking: z.boolean().default(false),
  moreFood: z.boolean().default(false),
  relaxedPace: z.boolean().default(false),
  preferIndoor: z.boolean().default(false),
  surpriseMe: z.boolean().default(false),
});

export type RegenerationPreferences = z.infer<typeof regenerationPreferencesSchema>;

export interface RegenerationOption {
  id: keyof RegenerationPreferences;
  label: string;
  description: string;
}

export const REGENERATION_OPTIONS: RegenerationOption[] = [
  {
    id: "lessWalking",
    label: "Less walking",
    description: "Prefer closer attractions to shorten the route.",
  },
  {
    id: "moreFood",
    label: "More food & local experiences",
    description: "Favour markets, restaurants and local spots.",
  },
  {
    id: "relaxedPace",
    label: "More relaxed pace",
    description: "Fewer stops with more breathing room.",
  },
  {
    id: "preferIndoor",
    label: "Prefer indoor attractions",
    description: "Favour museums, galleries and other indoor stops.",
  },
  {
    id: "surpriseMe",
    label: "Surprise me",
    description: "Try something different from the current day.",
  },
];

export function hasRegenerationPreferences(
  preferences: RegenerationPreferences,
): boolean {
  return Object.values(preferences).some(Boolean);
}

export const regenerateDayRequestSchema = z
  .object({
    preferences: regenerationPreferencesSchema.prefault({}),
    customInstructions: z
      .string()
      .trim()
      .max(LIMITS.regenerationInstructions)
      .optional(),
    variation: z.number().int().min(0).max(50).optional(),
  })
  .refine(
    (value) =>
      hasRegenerationPreferences(value.preferences) ||
      (value.customInstructions?.length ?? 0) > 0,
    { message: "Choose at least one preference or describe what you'd like to change." },
  );

export type RegenerateDayRequest = z.infer<typeof regenerateDayRequestSchema>;

export const applyRegenerationRequestSchema = z.object({
  previewId: z.string().trim().min(1).max(80),
});

export type ApplyRegenerationRequest = z.infer<typeof applyRegenerationRequestSchema>;

export interface DayComparisonMetrics {
  attractionCount: number;
  /** Total route distance in metres, or null when any leg is unreliable. */
  walkingMeters: number | null;
  /** Total travel time in minutes, or null when any leg is unreliable. */
  travelMinutes: number | null;
  /** Total time spent at attractions in minutes. */
  visitMinutes: number;
}

export interface RegeneratedDayComparison {
  original: DayComparisonMetrics;
  proposed: DayComparisonMetrics;
  added: ItineraryStop[];
  removed: ItineraryStop[];
}

export interface RegenerateDayPreview {
  quality?: import("./quality.js").TripQualityReport;
  previewId: string;
  tripId: string;
  dayIndex: number;
  baseItineraryVersion: number;
  expiresAt: string;
  day: ItineraryDay;
  warnings: string[];
  unscheduled: TripUnscheduledPlace[];
  comparison: RegeneratedDayComparison;
  appliedPreferences: RegenerationPreferences;
  customInstructions: string | null;
}
