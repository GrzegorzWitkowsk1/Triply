import type { QualityDimension, TripQualityReport } from "@triply/shared";
import type { TripRecord } from "../models/Trip.js";
import { validateItinerary, type ValidationOptions } from "./itineraryValidationService.js";
import { summarizeBudget } from "./budgetSummary.js";

/** Equal feasibility weights; errors subtract 30, warnings 10 (floor zero).
 * Overall unavailable when any evidence dimension is unavailable. Completeness
 * is reported separately and never increases the feasibility score.
 */
export function assessTripQuality(trip: TripRecord, options: ValidationOptions = {}): TripQualityReport {
  const validation = validateItinerary(trip, options);
  const days = (trip.itinerary?.days ?? []).filter(d => options.dayIndex === undefined || d.dayIndex === options.dayIndex);
  const visits = days.flatMap(d => d.activities.filter(a => a.type === "attraction"));
  const unavailable = (dimension: QualityDimension, codes: string[]) => validation.issues.some(i => i.dimension === dimension && codes.includes(i.code));
  const score = (dimension: QualityDimension, available: boolean) => !available ? null : Math.max(0, 100 - validation.issues.filter(i => i.dimension === dimension).reduce((sum, i) => sum + (i.severity === "error" ? 30 : i.severity === "warning" ? 10 : 0), 0));
  const knownScores = visits.map(a => trip.attractions.find(p => a.placeId ? p.placeId === a.placeId : p.name === a.title)?.score).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const budget = trip.itinerary ? summarizeBudget(trip) : null;
  const dimensions: TripQualityReport["dimensions"] = {
    schedule: score("schedule", visits.length > 0 && !unavailable("schedule", ["DAY_DATE_UNKNOWN", "ACTIVITY_TIME_INVALID"]) && !unavailable("dataCompleteness", ["TIMEZONE_UNKNOWN"])),
    routing: score("routing", visits.length > 0 && !unavailable("routing", ["ROUTE_MISSING", "ROUTE_UNKNOWN", "ROUTE_ESTIMATED"])),
    openingHours: score("openingHours", visits.length > 0 && !unavailable("openingHours", ["OPENING_HOURS_UNKNOWN", "OPENING_HOURS_INVALID"])),
    budget: score("budget", !!budget?.comparisonAvailable && !budget.hasIncompletePricing),
    relevance: knownScores.length === visits.length && visits.length > 0 ? Math.round(knownScores.reduce((sum, n) => sum + n, 0) / knownScores.length) : null,
    workload: score("workload", visits.length > 0 && !unavailable("schedule", ["ACTIVITY_DURATION_INVALID", "ACTIVITY_TIME_INVALID"])),
    dataCompleteness: null,
  };
  // Relative balance uses actual scheduled visiting + travel load, including
  // empty days. Penalize coefficient of variation; no universal day maximum.
  if (days.length > 1 && dimensions.schedule !== null && dimensions.workload !== null) {
    const loads = days.map(d => d.activities.reduce((n, a) => n + (a.type === "break" ? 0 : Math.max(0, a.durationMinutes)), 0));
    const mean = loads.reduce((n, v) => n + v, 0) / loads.length;
    const variation = mean ? Math.sqrt(loads.reduce((n, v) => n + (v - mean) ** 2, 0) / loads.length) / mean : 0;
    dimensions.workload = Math.min(dimensions.workload, Math.max(0, Math.round(100 - variation * 40)));
  }
  const evidence = [dimensions.schedule, dimensions.routing, dimensions.openingHours, dimensions.budget, dimensions.relevance, dimensions.workload];
  dimensions.dataCompleteness = visits.length ? Math.round(evidence.filter(n => n !== null).length / evidence.length * 100) : 0;
  return { ...validation, dimensions, score: evidence.every(n => n !== null) ? Math.round(evidence.reduce<number>((sum, n) => sum + n!, 0) / evidence.length) : null };
}
