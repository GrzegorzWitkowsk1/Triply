import type { TripAttraction } from "@triply/shared";
import type { TripRecord } from "../models/Trip.js";
import { reliableAdmissionCost, summarizeBudget } from "./budgetSummary.js";

/** Missing allocations use remaining total as a ceiling, never an invented percentage. */
export function remainingAttractionBudget(trip: TripRecord, replacingDay?: number): number | null {
  const summary = summarizeBudget({ ...trip, itinerary: trip.itinerary ? { ...trip.itinerary, days: trip.itinerary.days.filter(d => d.dayIndex !== replacingDay) } : null });
  if (!summary.comparisonAvailable) return null;
  const category = summary.categories.find(c => c.category === "attractions")!.totals.find(t => t.currency === summary.currency);
  const allocation = summary.allocationCurrency === summary.currency ? summary.allocations.attractions : undefined;
  const own = summary.totals.find(t => t.currency === summary.currency);
  const available = BigInt(summary.totalBudgetMinor!) - BigInt(own?.plannedMinor ?? 0) - BigInt(own?.actualMinor ?? 0);
  const categoryAvailable = allocation === undefined ? available : BigInt(allocation) - BigInt(category?.plannedMinor ?? 0) - BigInt(category?.actualMinor ?? 0);
  const remaining = available < categoryAvailable ? available : categoryAvailable;
  return remaining > 0n ? Number(remaining) : 0;
}
/** Bounded penalty retains unknown-price choices and high relevance paid choices. */
export function budgetAwareCandidates<T extends TripAttraction>(pois: readonly T[], trip: TripRecord, dayIndex?: number, cheaper = false): T[] {
  const remaining = remainingAttractionBudget(trip, dayIndex);
  const currency = trip.analysis.budget.currency;
  if (remaining === null || !currency) return [...pois];
  const allowance = remaining / (dayIndex ? 4 : Math.max(1, (trip.analysis.durationDays ?? 1) * 4));
  return pois.map(poi => {
    const plain = "toObject" in poi && typeof poi.toObject === "function" ? poi.toObject() as T : poi;
    const replacement = dayIndex !== undefined && poi.placeId && trip.expenses?.some(e => e.replacesAdmission && e.attractionId === poi.placeId && e.dayId === String(dayIndex));
    const cost = replacement ? 0 : reliableAdmissionCost(poi.admission, trip.analysis.travelers, currency);
    const penalty = cost === null || cost === 0 ? 0 : cost > remaining ? 25 : cost > allowance ? Math.min(18, 6 * cost / Math.max(1, allowance)) : 0;
    return { ...plain, score: Math.max(0, (poi.score ?? 50) - penalty - (cheaper && cost !== null && cost > 0 ? 15 : 0)) };
  });
}

/** Select among similarly relevant alternatives, retaining explicit named requests and uncertainty. */
export function selectBudgetCandidates<T extends TripAttraction>(pois: readonly T[], trip: TripRecord): T[] {
  const remaining = remainingAttractionBudget(trip);
  const currency = trip.analysis.budget.currency;
  if (remaining === null || !currency) return [...pois];
  const ranked = budgetAwareCandidates(pois, trip).map((poi, index) => ({ poi, index })).sort((a,b) => (b.poi.score ?? 0) - (a.poi.score ?? 0) || a.index - b.index);
  const target = Math.max(1, (trip.analysis.durationDays ?? 1) * ({ relaxed: 3, balanced: 4, packed: 6 }[trip.analysis.pace ?? "balanced"]));
  const selected: T[] = [];
  let available = remaining;
  const notes = trip.analysis.notes?.toLowerCase() ?? "";
  const mandatory = ranked.filter(({ poi }) => poi.name.length > 3 && notes.includes(poi.name.toLowerCase()));
  for (const { poi } of mandatory) {
    selected.push(poi); available -= reliableAdmissionCost(poi.admission, trip.analysis.travelers, currency) ?? 0;
  }
  for (const { poi } of ranked) {
    if (selected.includes(poi) || selected.length >= Math.max(target, mandatory.length)) continue;
    const cost = reliableAdmissionCost(poi.admission, trip.analysis.travelers, currency);
    const fitting = ranked.some(candidate => candidate.poi !== poi && (candidate.poi.score ?? 0) >= (poi.score ?? 0) - 20 && (reliableAdmissionCost(candidate.poi.admission, trip.analysis.travelers, currency) ?? 0) <= available);
    if (cost !== null && cost > available && fitting) continue;
    selected.push(poi); available -= cost ?? 0;
  }
  return selected;
}
