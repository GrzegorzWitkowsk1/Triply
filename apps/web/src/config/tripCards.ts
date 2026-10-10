import type { TripStatus, TripSummary } from "@triply/shared";

export type TripCardStatus = "Ready" | "Planning" | "Failed";

export interface TripCardModel {
  id: string;
  city: string;
  country: string;
  days: number;
  dateLabel: string;
  budgetUsed: number | null;
  status: TripCardStatus;
  isConfirmed: boolean;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatRange(startDate: string | null, endDate: string | null): string {
  if (!startDate) {
    return "Dates to be decided";
  }

  const start = new Date(`${startDate}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime())) {
    return "Dates to be decided";
  }

  const startLabel = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;

  if (!endDate) {
    return startLabel;
  }

  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(end.getTime()) || endDate === startDate) {
    return startLabel;
  }

  const endLabel =
    start.getUTCMonth() === end.getUTCMonth()
      ? String(end.getUTCDate())
      : `${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`;

  return `${startLabel}-${endLabel}`;
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
  };
}

export function buildHomeTripCards(summaries: TripSummary[]): HomeTripCardModel[] {
  return summaries.map(toHomeTripCard);
}