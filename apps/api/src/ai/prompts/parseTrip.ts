import { BUDGET_TYPE_VALUES, interestLabel, PACE_VALUES } from "@triply/shared";
import { nullableSchema, type AIRequest, type AISchema, type AnalyzeTripInput } from "../types.js";

const INTEREST_SLUGS = ["food", "architecture", "beach", "nature", "culture", "shopping", "nightlife"];
const INTEREST_HINT = INTEREST_SLUGS.join(", ");

const BUDGET_TYPE_VALUES_WITH_PER_DAY = [...BUDGET_TYPE_VALUES, "per_day"] as const;

export const TRIP_ANALYSIS_SCHEMA: AISchema = {
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
          enum: [...BUDGET_TYPE_VALUES_WITH_PER_DAY],
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

export function buildSystemInstruction(): string {
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

export function buildPrompt(prompt: string, badges: string[]): string {
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

export function buildTripAnalysisRequest(input: AnalyzeTripInput): AIRequest {
  return {
    systemInstruction: buildSystemInstruction(),
    prompt: buildPrompt(input.prompt, input.badges),
    schema: TRIP_ANALYSIS_SCHEMA,
  };
}
