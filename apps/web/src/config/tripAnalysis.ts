import { interestLabel } from "../i18n/labels";
import i18n from "../i18n";
import { INTEREST_OPTIONS as SHARED_INTEREST_OPTIONS, type AskableField, type BudgetType } from "@triply/shared";
import { HOME_BADGES } from "./home";
import { PREF_OPTIONS } from "./trip";

export interface FieldCopy {
  title: string;
  helper: string;
}

export const FIELD_COPY: Record<AskableField, FieldCopy> = {
  destination: {
    get title() { return i18n.t("whereAreYouGoing", { ns: "tripCreator/fields" }); },
    get helper() { return i18n.t("aCityIsPerfectParisKyotoTheAlgarve", { ns: "tripCreator/fields" }); },
  },
  country: {
    get title() { return i18n.t("whichCountryIsThatIn", { ns: "tripCreator/fields" }); },
    get helper() { return i18n.t("weUseItToKeepTheWeatherAnd", { ns: "tripCreator/fields" }); },
  },
  startDate: {
    get title() { return i18n.t("whenDoesTheTripStart", { ns: "tripCreator/fields" }); },
    get helper() { return i18n.t("leaveTheDatesEmptyIfYouDonT", { ns: "tripCreator/fields" }); },
  },
  endDate: {
    get title() { return i18n.t("whenDoesTheTripEnd", { ns: "tripCreator/fields" }); },
    get helper() { return i18n.t("theLastDayOfTheTripCountedInclusively", { ns: "tripCreator/fields" }); },
  },
  durationDays: {
    get title() { return i18n.t("howManyDaysDoYouHave", { ns: "tripCreator/fields" }); },
    get helper() { return i18n.t("countBothTheArrivalAndDepartureDay", { ns: "tripCreator/fields" }); },
  },
  travelers: {
    get title() { return i18n.t("howManyPeopleWillTravel", { ns: "tripCreator/fields" }); },
    get helper() { return i18n.t("includingYourself", { ns: "tripCreator/fields" }); },
  },
  budget: {
    get title() { return i18n.t("whatSYourBudget", { ns: "tripCreator/fields" }); },
    get helper() { return i18n.t("roughlyWhatTheWholeTripCanCostYou", { ns: "tripCreator/fields" }); },
  },
  interests: {
    get title() { return i18n.t("whatAreYouInto", { ns: "tripCreator/fields" }); },
    get helper() { return i18n.t("pickAsManyAsYouLikeOrAdd", { ns: "tripCreator/fields" }); },
  },
};

export const DATE_FIELDS_HINT = "tripCreator/fields:dateFieldsHint";

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
  { id: FLEXIBLE_BUDGET_ID, get label() { return i18n.t("flexible", { ns: "tripCreator/fields" }); }, amount: null, currency: null },
];

export const CUSTOM_BUDGET_OPTION: BudgetSuggestion = {
  id: CUSTOM_BUDGET_ID,
  get label() { return i18n.t("somethingElse", { ns: "tripCreator/fields" }); },
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
  { value: "total", get label() { return i18n.t("total", { ns: "tripCreator/fields" }); } },
  { value: "per_person", get label() { return i18n.t("perPerson", { ns: "tripCreator/fields" }); } },
];

export const PACE_TITLE = "tripCreator/fields:paceTitle";
export const WALKING_TITLE = "tripCreator/fields:walkingTitle";
export const WALKING_HELPER = "tripCreator/fields:walkingHelper";
export const NOTES_TITLE = "tripCreator/fields:notesTitle";
export const NOTES_HELPER = "tripCreator/fields:notesHelper";

const INTEREST_ICONS = new Map<string, (typeof PREF_OPTIONS)[number]["icon"]>(
  [...HOME_BADGES, ...PREF_OPTIONS].map((option) => [option.id, option.icon]),
);

export function interestIcon(id: string) {
  return INTEREST_ICONS.get(id);
}

export const INTEREST_OPTIONS = SHARED_INTEREST_OPTIONS.map(option => ({ ...option, get label() { return interestLabel(option.id); } }));