import { INTEREST_OPTIONS, type AskableField, type BudgetType } from "@triply/shared";
import { HOME_BADGES } from "./home";
import { PREF_OPTIONS } from "./trip";

export interface FieldCopy {
  title: string;
  helper: string;
}

export const FIELD_COPY: Record<AskableField, FieldCopy> = {
  destination: {
    title: "Where are you going?",
    helper: "A city is perfect — Paris, Kyoto, the Algarve.",
  },
  country: {
    title: "Which country is that in?",
    helper: "We use it to keep the weather and currency right.",
  },
  startDate: {
    title: "When does the trip start?",
    helper: "Leave the dates empty if you don't know yet — just tell us how many days.",
  },
  endDate: {
    title: "When does the trip end?",
    helper: "The last day of the trip, counted inclusively.",
  },
  durationDays: {
    title: "How many days do you have?",
    helper: "Count both the arrival and departure day.",
  },
  travelers: {
    title: "How many people will travel?",
    helper: "Including yourself.",
  },
  budget: {
    title: "What's your budget?",
    helper: "Roughly what the whole trip can cost — you can refine it later.",
  },
  interests: {
    title: "What are you into?",
    helper: "Pick as many as you like, or add your own.",
  },
};

export const DATE_FIELDS_HINT =
  "No dates yet? Leave them empty and tell us how many days you're away for.";

export interface BudgetSuggestion {
  id: string;
  label: string;
  amount: number | null;
  currency: string | null;
}

export const FLEXIBLE_BUDGET_ID = "flexible";
export const CUSTOM_BUDGET_ID = "custom";

export const BUDGET_SUGGESTIONS: BudgetSuggestion[] = [
  { id: "budget-200-400", label: "€200–400", amount: 400, currency: "EUR" },
  { id: "budget-400-700", label: "€400–700", amount: 700, currency: "EUR" },
  { id: "budget-700-1000", label: "€700–1000", amount: 1000, currency: "EUR" },
  { id: FLEXIBLE_BUDGET_ID, label: "Flexible", amount: null, currency: null },
];

export const CUSTOM_BUDGET_OPTION: BudgetSuggestion = {
  id: CUSTOM_BUDGET_ID,
  label: "Something else",
  amount: null,
  currency: null,
};

export const CURRENCY_OPTIONS = [
  "EUR",
  "USD",
  "GBP",
  "PLN",
  "CHF",
  "CZK",
  "SEK",
  "NOK",
  "DKK",
  "JPY",
];

export const BUDGET_TYPE_OPTIONS: { value: BudgetType; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "per_person", label: "Per person" },
];

export const PACE_TITLE = "How do you like to travel?";
export const WALKING_TITLE = "Longest daily walk";
export const WALKING_HELPER = "Optional — leave empty if you're happy to walk any distance.";
export const NOTES_TITLE = "Any notes?";
export const NOTES_HELPER =
  "Must-see places, dietary needs, mobility limits, an early flight — anything that shapes the plan.";

const INTEREST_ICONS = new Map<string, (typeof PREF_OPTIONS)[number]["icon"]>(
  [...HOME_BADGES, ...PREF_OPTIONS].map((option) => [option.id, option.icon]),
);

export function interestIcon(id: string) {
  return INTEREST_ICONS.get(id);
}

export { INTEREST_OPTIONS };