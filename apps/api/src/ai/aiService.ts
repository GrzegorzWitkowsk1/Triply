import {
  BUDGET_TYPE_VALUES,
  deriveTripSchedule,
  isIsoDate,
  LIMITS,
  normalizeCurrencyCode,
  PACE_VALUES,
  tripAnalysisSchema,
  type BudgetType,
  type Pace,
  type TripAnalysis,
} from "@triply/shared";
import { AiError } from "./errors.js";
import { createAIProvider } from "./providers/factory.js";
import { buildTripAnalysisRequest } from "./prompts/parseTrip.js";
import type { AIProvider, AnalyzeTripInput } from "./types.js";

export type { AnalyzeTripInput } from "./types.js";

const PER_DAY_ALIASES = new Set(["per_day", "per day", "daily", "day", "dziennie", "dzienny"]);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asBoundedInt(value: unknown, min: number, max: number): number | null {
  const parsed = asNumber(value);

  if (parsed === null) {
    return null;
  }

  return Math.min(Math.max(Math.round(parsed), min), max);
}

function asDate(value: unknown): string | null {
  const text = asText(value);

  if (!text) {
    return null;
  }

  const candidate = text.slice(0, 10);

  return isIsoDate(candidate) ? candidate : null;
}

function asBoundedNumber(value: unknown, min: number, max: number): number | null {
  const parsed = asNumber(value);

  if (parsed === null) {
    return null;
  }

  return Math.min(Math.max(Math.round(parsed * 10) / 10, min), max);
}

function asPace(value: unknown): Pace | null {
  const text = asText(value)?.toLowerCase();

  return PACE_VALUES.find((pace) => pace === text) ?? null;
}

function asBudgetType(value: unknown): BudgetType | null {
  const text = asText(value);
  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase();
  return BUDGET_TYPE_VALUES.find((type) => type === normalized) ?? null;
}

function isPerDayBudget(value: unknown): boolean {
  const raw = asText(value);
  if (!raw) {
    return false;
  }

  const text = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return PER_DAY_ALIASES.has(text);
}

function resolveBudgetType(
  value: unknown,
  durationDays: number | null,
): BudgetType | null {
  const perDay = isPerDayBudget(value);

  if (!perDay) {
    return asBudgetType(value);
  }

  if (durationDays === null) {
    return null;
  }

  return "total";
}

function normalizeInterests(value: unknown, badges: string[]): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string): void => {
    const normalized = raw.trim().toLowerCase();

    if (!normalized || seen.has(normalized) || collected.length >= LIMITS.interests) {
      return;
    }

    seen.add(normalized);
    collected.push(normalized);
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        add(entry);
      }
    }
  }

  for (const badge of badges) {
    add(badge);
  }

  return collected;
}

function normalizeBudget(
  value: unknown,
  durationDays: number | null,
): TripAnalysis["budget"] {
  const raw = asRecord(value);
  const amount = asNumber(raw.amount);
  const perDay = isPerDayBudget(raw.type);
  const scaledAmount =
    perDay && amount !== null && durationDays !== null ? amount * durationDays : amount;
  const normalizedAmount =
    scaledAmount === null || scaledAmount < 0
      ? null
      : Math.round(scaledAmount * 100) / 100;

  if (normalizedAmount === null) {
    return { amount: null, currency: null, type: null };
  }

  return {
    amount: normalizedAmount,
    currency: normalizeCurrencyCode(raw.currency),
    type: resolveBudgetType(raw.type, durationDays),
  };
}

function normalizeAnalysis(raw: unknown, badges: string[]): TripAnalysis {
  const source = asRecord(raw);
  const durationDays = asBoundedInt(source.durationDays, 1, LIMITS.durationDays);
  const analysis: TripAnalysis = {
    destination: asText(source.destination),
    country: asText(source.country),
    startDate: asDate(source.startDate),
    endDate: asDate(source.endDate),
    durationDays,
    travelers: asBoundedInt(source.travelers, 1, LIMITS.travelers),
    budget: normalizeBudget(source.budget, durationDays),
    interests: normalizeInterests(source.interests, badges),
    pace: asPace(source.pace),
    maxWalkingDistanceKm: asBoundedNumber(
      source.maxWalkingDistanceKm,
      0,
      LIMITS.maxWalkingDistanceKm,
    ),
    notes: asText(source.notes),
  };

  const result = tripAnalysisSchema.safeParse(deriveTripSchedule(analysis));

  if (!result.success) {
    console.error(
      "[ai] trip analysis failed validation:",
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
    throw new AiError("The AI service returned an unreadable response.", 502, {
      code: "invalid_response",
    });
  }

  return result.data;
}

export interface AiService {
  parseTrip(input: AnalyzeTripInput): Promise<TripAnalysis>;
}

export function createAiService(provider: AIProvider): AiService {
  return {
    async parseTrip(input: AnalyzeTripInput): Promise<TripAnalysis> {
      const raw = await provider.generate(buildTripAnalysisRequest(input));

      return normalizeAnalysis(raw, input.badges);
    },
  };
}

export const aiService: AiService = createAiService(createAIProvider());
