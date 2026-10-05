import {
  BUDGET_TYPE_VALUES,
  deriveTripSchedule,
  interestLabel,
  isIsoDate,
  LIMITS,
  normalizeCurrencyCode,
  PACE_VALUES,
  tripAnalysisSchema,
  type BudgetType,
  type Pace,
  type TripAnalysis,
} from "@triply/shared";
import { generateJson, nullableSchema, type GeminiJsonSchema } from "./gemini.js";

const INTEREST_SLUGS = ["food", "architecture", "beach", "nature", "culture", "shopping", "nightlife"];
const INTEREST_HINT = INTEREST_SLUGS.join(", ");

const GEMINI_BUDGET_TYPE_VALUES = [...BUDGET_TYPE_VALUES, "per_day"] as const;
const PER_DAY_ALIASES = new Set(["per_day", "per day", "daily", "day", "dziennie", "dzienny"]);

const ANALYSIS_SCHEMA: GeminiJsonSchema = {
  type: "object",
  properties: {
    destination: nullableSchema({
      type: "string",
      description: "City, town or region to travel to, e.g. \"Barcelona\". Null when unknown.",
    }),
    country: nullableSchema({
      type: "string",
      description: "Country of the destination, e.g. \"Spain\". Null when unknown.",
    }),
    startDate: nullableSchema({
      type: "string",
      description: "Trip start date as YYYY-MM-DD. Null when unknown.",
    }),
    endDate: nullableSchema({
      type: "string",
      description: "Trip end date as YYYY-MM-DD, inclusive. Null when unknown.",
    }),
    durationDays: nullableSchema({
      type: "integer",
      description:
        "Number of days of the trip, counting the start date as day 1. Derive it from startDate and endDate when both are known, otherwise from an explicit duration. Null when unknown.",
    }),
    travelers: nullableSchema({
      type: "integer",
      description: "Number of people travelling. Null when unknown.",
    }),
    budget: {
      type: "object",
      properties: {
        amount: nullableSchema({
          type: "number",
          description:
            "Budget amount in the given currency. Always extract a stated amount, even when the currency word is not English. Null only when no amount is mentioned at all.",
        }),
        currency: nullableSchema({
          type: "string",
          description:
            "ISO 4217 currency code. Translate every currency word and symbol, in any language, so \"złoty\" and \"zł\" become \"PLN\", \"euro\" and \"€\" become \"EUR\", \"dolar\" becomes \"USD\". Null only when no currency is mentioned.",
        }),
        type: nullableSchema({
          type: "string",
          enum: [...GEMINI_BUDGET_TYPE_VALUES],
          description:
            "\"total\" when the amount covers the whole trip, \"per_person\" when it is per traveller, \"per_day\" when the traveller quotes a daily amount and the trip length is unknown.",
        }),
      },
      required: ["amount", "currency", "type"],
    },
    interests: {
      type: "array",
      items: { type: "string" },
      description: `Lowercase interests, preferring these slugs when they fit: ${INTEREST_HINT}. Empty array when unknown.`,
    },
    pace: nullableSchema({
      type: "string",
      enum: [...PACE_VALUES],
      description:
        "relaxed for slow days with few stops, balanced for a mix, packed for many stops per day. Null when unknown.",
    }),
    maxWalkingDistanceKm: nullableSchema({
      type: "number",
      description:
        "Longest daily walking distance in kilometres. Only set it when the traveller states a limit. Null otherwise.",
    }),
    notes: nullableSchema({
      type: "string",
      description:
        "Anything else worth keeping: must-see places, dietary needs, mobility limits, flight times. Null when there is nothing extra.",
    }),
  },
  required: [
    "destination",
    "country",
    "startDate",
    "endDate",
    "durationDays",
    "travelers",
    "budget",
    "interests",
    "pace",
    "maxWalkingDistanceKm",
    "notes",
  ],
};

function buildSystemInstruction(): string {
  return [
    "You extract structured trip requirements from a traveller's free-form request.",
    "You are precise and never invent details the traveller did not give or clearly imply.",
    "Rules:",
    "- Use null for anything unknown. An empty guess is worse than null because the app asks the traveller to fill gaps.",
    "- Resolve relative dates such as \"next Friday\" or \"in two weeks\" against today's date, and always return YYYY-MM-DD.",
    "- When both startDate and endDate are known, set durationDays to the inclusive day count.",
    "- Interpret \"€500\", \"500 euros\" and \"$1,200\" style amounts. Never set amount to null just because the currency word is not English — extract the number regardless.",
    "- currency must be an ISO 4217 code translated from any language: \"złoty\", \"zł\" and \"zloty\" are \"PLN\"; \"euro\" and \"€\" are \"EUR\"; \"dolar\" is \"USD\"; \"corona\" is \"SEK\" or \"NOK\" depending on the country.",
    "- When the traveller quotes an amount per day, multiply it by durationDays and report the trip total with type \"total\". Use type \"per_day\" only when the trip length is unknown.",
    "- Use \"total\" for the whole trip and \"per_person\" for per-traveller budgets.",
    "- Map travel style to pace: relaxed for slow days with few stops, balanced for a mix, packed for many stops per day.",
    "- Keep interests lowercase and prefer the suggested slugs.",
    "- maxWalkingDistanceKm stays null unless the traveller mentions a walking limit.",
    "- notes holds details that do not fit the other fields, and null when there are none.",
    "- Return only the JSON object described by the response schema.",
  ].join("\n");
}

function buildPrompt(prompt: string, badges: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const badgeLine =
    badges.length > 0
      ? `Interests selected from badges: ${badges.map((badge) => interestLabel(badge)).join(", ")}.`
      : "No interests were selected from badges.";

  return [
    `Today's date is ${today}.`,
    badgeLine,
    `Traveller request: ${prompt}`,
  ].join("\n\n");
}

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

  return tripAnalysisSchema.parse(deriveTripSchedule(analysis));
}

export interface AnalyzeTripInput {
  prompt: string;
  badges: string[];
}

export async function analyzeTrip(input: AnalyzeTripInput): Promise<TripAnalysis> {
  const raw = await generateJson({
    systemInstruction: buildSystemInstruction(),
    prompt: buildPrompt(input.prompt, input.badges),
    schema: ANALYSIS_SCHEMA,
  });

  return normalizeAnalysis(raw, input.badges);
}