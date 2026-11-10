import { z } from "zod";
import {
  askableFieldSchema, budgetAllocationsSchema, EXPENSE_CATEGORIES, expenseCurrencySchema,
  expenseInputSchema, moneyMinorSchema, regenerationPreferencesSchema, supportedLocaleSchema,
  tripAnalysisSchema, tripBudgetSchema, tripDayWeatherSchema, tripEquipmentItemSchema,
  tripLocationSchema, tripStatusSchema, visitProgressSchema, attractionAdmissionSchema, weatherAvailabilitySchema,
} from "@triply/shared";

// Response envelopes reuse domain schemas. Passthrough preserves forward-compatible metadata;
// request() returns the original JSON, never Zod defaults or transformed/fabricated state.
const text = z.string();
const nullableText = text.nullable();
const strings = z.array(text);
const revision = moneyMinorSchema;
const signedMoney = z.number().int().safe().nullable();
const currency = expenseCurrencySchema;
const total = z.object({ currency, plannedMinor: moneyMinorSchema, actualMinor: moneyMinorSchema,
  automaticMinor: moneyMinorSchema, manualPlannedMinor: moneyMinorSchema });
const categories = z.array(z.object({ category: z.enum(EXPENSE_CATEGORIES), totals: z.array(total) }));
export const budgetResponseSchema = z.object({
  revision,
  expenses: z.array(expenseInputSchema.safeExtend({ id: text.min(1), createdAt: text, updatedAt: text,
    automaticSource: z.object({ type: z.literal("visit_admission"), itineraryItemId: text,
      unit: z.enum(["per_person", "per_group"]), participants: z.number().int().positive().nullable(),
      unitAmountMinor: moneyMinorSchema, postedAmountMinor: moneyMinorSchema, currency }).optional(),
  })),
  summary: z.object({
    currency: currency.nullable(), totalBudgetMinor: moneyMinorSchema.nullable(), allocations: budgetAllocationsSchema,
    allocationCurrency: currency.nullable(), totals: z.array(total), categories,
    days: z.array(z.object({ dayId: nullableText, totals: z.array(total), categories })),
    plannedSpendingMinor: signedMoney, actualSpendingMinor: signedMoney,
    plannedRemainingMinor: signedMoney, actualRemainingMinor: signedMoney,
    unknownAdmissionPriceCount: revision, hasIncompletePricing: z.boolean(), comparisonAvailable: z.boolean(),
    plannedOverBudget: z.boolean(), actualOverBudget: z.boolean(), warnings: strings,
  }),
}).refine(data => new Set(data.expenses.map(expense => expense.id)).size === data.expenses.length);

const stop = z.object({ itineraryItemId: z.uuid().optional(), attractionKey: text.optional(),
  admission: attractionAdmissionSchema.nullish(), placeId: nullableText, name: text, category: text,
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), score: z.number().nullable(),
}).passthrough();
const activity = z.object({ itineraryItemId: z.uuid().optional(), type: z.enum(["attraction", "travel", "break"]),
  startTime: text, endTime: text, title: text, durationMinutes: z.number().nonnegative(),
  placeId: text.optional(), warnings: strings.optional(), schedulingStatus: z.literal("unresolved").optional(),
}).passthrough();
const geometry = z.object({ type: z.literal("LineString"), coordinates: z.array(z.tuple([z.number(), z.number()])) });
const segment = z.object({ fromIndex: z.number().int(), toIndex: z.number().int(),
  distanceMeters: z.number().nullable(), durationSeconds: z.number().nullable(), geometry: geometry.nullable(),
}).passthrough();
const day = z.object({ dayIndex: z.number().int().positive(), date: text, timeZone: text,
  activities: z.array(activity), stops: z.array(stop), geometry: geometry.nullable(), segments: z.array(segment),
  totalVisitMinutes: z.number(), totalTravelMinutes: z.number().nullable(), totalDistanceMeters: z.number().nullable(),
  partiallyEstimated: z.boolean(), warnings: strings,
}).passthrough();
const unscheduled = z.array(z.object({ place: stop, dayIndex: z.number().int().nullable(),
  reason: z.enum(["insufficient-time", "opening-hours-conflict", "invalid-location", "unassigned-cluster"]), detail: nullableText }));
const itinerary = z.object({ timeZone: text, routingSource: z.enum(["provider", "approximation", "unavailable"]),
  generatedAt: nullableText, days: z.array(day), unscheduled }).passthrough();
export const analysisResponseSchema = z.object({ contentLocale: supportedLocaleSchema.optional(), draftId: text.min(1),
  analysis: tripAnalysisSchema, missingFields: z.array(askableFieldSchema), requirementsComplete: z.boolean() }).passthrough();
export const tripResponseSchema = analysisResponseSchema.extend({
  id: text.min(1), status: tripStatusSchema, prompt: text, badges: strings,
  equipment: z.array(tripEquipmentItemSchema), weather: z.array(tripDayWeatherSchema), itinerary: itinerary.nullable(),
  generation: z.object({ startedAt: nullableText, generatedAt: nullableText, error: nullableText }),
  fixtureKey: nullableText, createdAt: nullableText, updatedAt: nullableText,
  itineraryVersion: revision.optional(), visitRevision: revision.optional(), visits: z.array(visitProgressSchema).optional(),
  pendingVisitExpenseItemIds: z.array(z.uuid()).optional(), budgetData: budgetResponseSchema.optional(),
  weatherAvailability: weatherAvailabilitySchema.optional(),
  expensePromptItemId: z.uuid().optional(), automaticExpense: z.discriminatedUnion("status", [
    z.object({ itemId: z.uuid(), status: z.literal("posted"), amountMinor: moneyMinorSchema, currency }),
    z.object({ itemId: z.uuid(), status: z.literal("failed") }),
  ]).optional(),
});
export const tripListResponseSchema = z.array(z.object({ id: text.min(1), status: tripStatusSchema, prompt: text, badges: strings,
  destination: nullableText, country: nullableText, startDate: nullableText, endDate: nullableText,
  durationDays: z.number().nullable(), travelers: z.number().nullable(), budget: tripBudgetSchema,
  location: tripLocationSchema.nullable(), fixtureKey: nullableText, createdAt: nullableText, updatedAt: nullableText,
}).passthrough());
export const editResponseSchema = z.object({ trip: tripResponseSchema, itineraryVersion: revision,
  affectedDayIndices: z.array(z.number().int()), warnings: strings });
const metrics = z.object({ attractionCount: revision, walkingMeters: z.number().nullable(), travelMinutes: z.number().nullable(), visitMinutes: z.number() });
export const previewResponseSchema = z.object({ previewId: text.min(1), tripId: text.min(1), dayIndex: z.number().int(),
  baseItineraryVersion: revision, expiresAt: z.iso.datetime(), day, warnings: strings, unscheduled,
  comparison: z.object({ original: metrics, proposed: metrics, added: z.array(stop), removed: z.array(stop) }),
  appliedPreferences: regenerationPreferencesSchema, customInstructions: nullableText,
});
