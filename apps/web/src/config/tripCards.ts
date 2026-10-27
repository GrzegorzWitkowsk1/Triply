import { formatDateRange } from "../i18n/format";
import i18n from "../i18n";
import type { TripStatus, TripSummary } from "@triply/shared";

export type TripCardStatus = "Ready" | "Planning" | "Failed";

export interface TripCardModel {
  id: string;
  city: string;
  country: string;
  days: number;
  dateLabel: string;
  budgetUsed: number | null;
  currency?: string | null;
  status: TripCardStatus;
  isConfirmed: boolean;
}

function formatRange(startDate: string | null, endDate: string | null): string {
  if (!startDate) return i18n.t("datesToBeDecided", { ns: "trips" });
  try { return formatDateRange(startDate, endDate ?? startDate); }
  catch { return i18n.t("datesToBeDecided", { ns: "trips" }); }
}

export function toCardStatus(status: TripStatus): TripCardStatus {
  if (status === "ready") {
    return "Ready";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Planning";
}

export function toTripCardModel(summary: TripSummary): TripCardModel {
  return {
    id: summary.id,
    city: summary.destination ?? "Untitled trip",
    country: summary.country ?? "",
    days: summary.durationDays ?? 0,
    dateLabel: formatRange(summary.startDate, summary.endDate),
    budgetUsed: summary.budget.amount ?? null,
    currency: summary.budget.currency ?? null,
    status: toCardStatus(summary.status),
    isConfirmed: summary.status === "ready",
  };
}

export function buildTripCards(summaries: TripSummary[]): TripCardModel[] {
  return summaries.map(toTripCardModel);
}

export interface HomeTripCardModel {
  id: string;
  city: string;
  country: string;
  days: number;
  dateLabel: string;
  budgetUsed: number | null;
  currency?: string | null;
  activities?: number;
  completed?: number;
  budgetExpected?: number;
}

export function toHomeTripCard(summary: TripSummary): HomeTripCardModel {
  return {
    id: summary.id,
    city: summary.destination ?? "Untitled trip",
    country: summary.country ?? "",
    days: summary.durationDays ?? 0,
    dateLabel: formatRange(summary.startDate, summary.endDate),
    budgetUsed: summary.budget.amount ?? null,
    currency: summary.budget.currency ?? null,
  };
}

export function buildHomeTripCards(summaries: TripSummary[]): HomeTripCardModel[] {
  return summaries.map(toHomeTripCard);
}