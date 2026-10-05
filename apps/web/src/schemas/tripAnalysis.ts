import {
  BUDGET_TYPE_VALUES,
  isIsoDate,
  PACE_VALUES,
  type AskableField,
  type BudgetType,
  type Pace,
  type TripAnalysis,
  type TripRequirementsAnswers,
  type UpdateTripRequirements,
} from "@triply/shared";
import { z } from "zod";
import {
  BUDGET_SUGGESTIONS,
  CUSTOM_BUDGET_ID,
  FLEXIBLE_BUDGET_ID,
} from "../config/tripAnalysis";

export interface TripRequirementsFormValues {
  destination: string;
  country: string;
  startDate: string;
  endDate: string;
  durationDays: string;
  travelers: string;
  budgetChoice: string;
  budgetAmount: string;
  budgetCurrency: string;
  budgetType: BudgetType;
  interests: string[];
  pace: Pace;
  maxWalkingDistanceKm: string;
  notes: string;
}

export const TRIP_REQUIREMENTS_DEFAULTS: TripRequirementsFormValues = {
  destination: "",
  country: "",
  startDate: "",
  endDate: "",
  durationDays: "",
  travelers: "",
  budgetChoice: "",
  budgetAmount: "",
  budgetCurrency: "EUR",
  budgetType: "total",
  interests: [],
  pace: "balanced",
  maxWalkingDistanceKm: "",
  notes: "",
};

const MAX_TRAVELERS = 50;
const MAX_DURATION_DAYS = 365;
const MAX_WALKING_KM = 100;

function isPositiveInteger(value: string, max: number): boolean {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return false;
  }

  const parsed = Number(trimmed);

  return parsed > 0 && parsed <= max;
}

function toNumber(value: string): number {
  return Number(value.trim());
}

function addIssue(
  ctx: z.RefinementCtx,
  path: keyof TripRequirementsFormValues,
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
}

export function createRequirementsSchema(missingFields: readonly AskableField[]) {
  const needs = (field: AskableField): boolean => missingFields.includes(field);

  return z
    .object({
      destination: z.string().trim().max(120),
      country: z.string().trim().max(120),
      startDate: z.string().trim(),
      endDate: z.string().trim(),
      durationDays: z.string().trim(),
      travelers: z.string().trim(),
      budgetChoice: z.string(),
      budgetAmount: z.string().trim(),
      budgetCurrency: z.string().trim(),
      budgetType: z.enum(BUDGET_TYPE_VALUES),
      interests: z.array(z.string()),
      pace: z.enum(PACE_VALUES),
      maxWalkingDistanceKm: z.string().trim(),
      notes: z.string().trim().max(2000),
    })
    .superRefine((values, ctx) => {
      if (needs("destination") && values.destination.length === 0) {
        addIssue(ctx, "destination", "Tell us where you want to go");
      }

      if (needs("country") && values.country.length === 0) {
        addIssue(ctx, "country", "Tell us the country");
      }

      if (needs("startDate") || needs("endDate") || needs("durationDays")) {
        const startProvided = values.startDate.length > 0;
        const endProvided = values.endDate.length > 0;
        const startValid = startProvided && isIsoDate(values.startDate);
        const endValid = endProvided && isIsoDate(values.endDate);
        const durationValid = isPositiveInteger(values.durationDays, MAX_DURATION_DAYS);

        if (startProvided && !startValid) {
          addIssue(ctx, "startDate", "Use the YYYY-MM-DD format");
        }

        if (endProvided && !endValid) {
          addIssue(ctx, "endDate", "Use the YYYY-MM-DD format");
        }

        const hasRange = startValid && endValid && values.endDate >= values.startDate;

        if (!hasRange && startValid && endValid) {
          addIssue(ctx, "endDate", "The end date can't be before the start date");
        }

        if (!hasRange) {
          if (values.durationDays.length > 0 && !durationValid) {
            addIssue(ctx, "durationDays", "Enter the number of days");
          }

          if (!durationValid) {
            if (needs("startDate") && !startValid) {
              addIssue(ctx, "startDate", "Add the start date, or how many days you'll be away");
            }

            if (needs("endDate") && !endValid) {
              addIssue(ctx, "endDate", "Add the end date, or how many days you'll be away");
            }

            if (needs("durationDays")) {
              addIssue(ctx, "durationDays", "Add the trip dates or the number of days");
            }
          }
        }
      }

      if (needs("travelers") && !isPositiveInteger(values.travelers, MAX_TRAVELERS)) {
        addIssue(ctx, "travelers", "Enter how many people are travelling");
      }

      if (needs("budget")) {
        if (values.budgetChoice.length === 0) {
          addIssue(ctx, "budgetChoice", "Pick a range or choose Flexible");
        } else if (values.budgetChoice === CUSTOM_BUDGET_ID) {
          if (!Number.isFinite(toNumber(values.budgetAmount)) || toNumber(values.budgetAmount) <= 0) {
            addIssue(ctx, "budgetAmount", "Enter the budget you have in mind");
          }

          if (values.budgetCurrency.length === 0) {
            addIssue(ctx, "budgetCurrency", "Pick a currency");
          }
        }
      }

      if (needs("interests") && values.interests.length === 0) {
        addIssue(ctx, "interests", "Pick at least one interest");
      }

      const walking = values.maxWalkingDistanceKm;

      if (
        walking.length > 0 &&
        (!Number.isFinite(toNumber(walking)) || toNumber(walking) < 0 || toNumber(walking) > MAX_WALKING_KM)
      ) {
        addIssue(ctx, "maxWalkingDistanceKm", "Enter a distance in km");
      }
    });
}

export function createRequirementsDefaultValues(analysis: TripAnalysis): TripRequirementsFormValues {
  const { budget } = analysis;
  let budgetChoice = "";
  let budgetAmount = "";
  let budgetType: BudgetType = budget.type === "per_person" ? "per_person" : "total";

  if (budget.amount !== null) {
    budgetChoice = CUSTOM_BUDGET_ID;
    budgetAmount = String(budget.amount);
  } else {
    budgetChoice = "";
  }

  return {
    ...TRIP_REQUIREMENTS_DEFAULTS,
    destination: analysis.destination ?? "",
    country: analysis.country ?? "",
    startDate: analysis.startDate ?? "",
    endDate: analysis.endDate ?? "",
    durationDays: analysis.durationDays !== null ? String(analysis.durationDays) : "",
    travelers: analysis.travelers !== null ? String(analysis.travelers) : "",
    budgetChoice,
    budgetAmount,
    budgetCurrency: budget.currency ?? TRIP_REQUIREMENTS_DEFAULTS.budgetCurrency,
    budgetType,
    interests: [...analysis.interests],
    pace: analysis.pace ?? TRIP_REQUIREMENTS_DEFAULTS.pace,
    maxWalkingDistanceKm:
      analysis.maxWalkingDistanceKm !== null ? String(analysis.maxWalkingDistanceKm) : "",
    notes: analysis.notes ?? "",
  };
}

export function buildRequirementsPayload(
  values: TripRequirementsFormValues,
  missingFields: readonly AskableField[],
): UpdateTripRequirements {
  const needs = (field: AskableField): boolean => missingFields.includes(field);
  const answers: TripRequirementsAnswers = {};
  const confirmedFields: AskableField[] = [];

  if (needs("destination") && values.destination.length > 0) {
    answers.destination = values.destination;
    confirmedFields.push("destination");
  }

  if (needs("country") && values.country.length > 0) {
    answers.country = values.country;
    confirmedFields.push("country");
  }

  if (needs("startDate") || needs("endDate") || needs("durationDays")) {
    const startDate = isIsoDate(values.startDate) ? values.startDate : null;
    const endDate = isIsoDate(values.endDate) ? values.endDate : null;
    const durationDays = isPositiveInteger(values.durationDays, MAX_DURATION_DAYS)
      ? toNumber(values.durationDays)
      : null;

    if (startDate) {
      answers.startDate = startDate;
    }

    if (endDate) {
      answers.endDate = endDate;
    }

    if (durationDays) {
      answers.durationDays = durationDays;
    }

    if ((startDate && endDate) || durationDays) {
      confirmedFields.push("startDate", "endDate", "durationDays");
    }
  }

  if (needs("travelers") && isPositiveInteger(values.travelers, MAX_TRAVELERS)) {
    answers.travelers = toNumber(values.travelers);
    confirmedFields.push("travelers");
  }

  if (needs("budget") && values.budgetChoice.length > 0) {
    if (values.budgetChoice === FLEXIBLE_BUDGET_ID) {
      answers.budget = { amount: null, currency: null, type: null };
      confirmedFields.push("budget");
    } else if (values.budgetChoice === CUSTOM_BUDGET_ID) {
      const amount = toNumber(values.budgetAmount);

      if (Number.isFinite(amount) && amount > 0) {
        answers.budget = {
          amount,
          currency: values.budgetCurrency,
          type: values.budgetType,
        };
        confirmedFields.push("budget");
      }
    } else {
      const suggestion = BUDGET_SUGGESTIONS.find(
        (option) => option.id === values.budgetChoice,
      );

      if (suggestion?.amount !== null && suggestion?.amount !== undefined) {
        answers.budget = {
          amount: suggestion.amount,
          currency: suggestion.currency,
          type: values.budgetType,
        };
        confirmedFields.push("budget");
      }
    }
  }

  if (needs("interests") && values.interests.length > 0) {
    answers.interests = values.interests.map((interest) => interest.trim().toLowerCase());
    confirmedFields.push("interests");
  }

  answers.pace = values.pace;
  answers.maxWalkingDistanceKm =
    values.maxWalkingDistanceKm.length > 0 ? toNumber(values.maxWalkingDistanceKm) : null;
  answers.notes = values.notes.length > 0 ? values.notes : null;

  return { answers, confirmedFields };
}