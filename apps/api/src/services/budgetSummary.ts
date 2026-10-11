import { currencyPrecision, decimalToMinor, expenseCurrencySchema, EXPENSE_CATEGORIES, type AttractionAdmission, type BudgetSummary, type ExpenseCategory, type SpendingTotal, type TripBudgetData } from "@triply/shared";
import type { TripRecord } from "../models/Trip.js";

export function reliableAdmissionCost(admission: AttractionAdmission | null | undefined, travelers: number | null, currency: string): number | null {
  if (admission?.rawFeeConditional || admission?.rawChargeConditional) return null;
  if (admission?.status === "free") return 0;
  const price = admission?.price;
  if (admission?.status !== "paid" || !price || price.currency !== currency || price.fractionDigits !== currencyPrecision(currency) || price.unit === "unknown") return null;
  if (price.unit === "per_person" && (!Number.isSafeInteger(travelers) || travelers! < 1)) return null;
  const amount = price.amountMinor * (price.unit === "per_person" ? travelers! : 1);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}
export function totalBudgetMinor(trip: Pick<TripRecord, "analysis">): number | null {
  const { budget, travelers } = trip.analysis;
  if (budget.amount === null || !expenseCurrencySchema.safeParse(budget.currency).success) return null;
  if (budget.type === "per_person" && (!Number.isSafeInteger(travelers) || travelers! < 1)) return null;
  try {
    const value = decimalToMinor(String(budget.amount), budget.currency!) * (budget.type === "per_person" ? travelers! : 1);
    return Number.isSafeInteger(value) ? value : null;
  } catch { return null; }
}
function add(totals: SpendingTotal[], currency: string, field: "automaticMinor" | "manualPlannedMinor" | "actualMinor", amount: number) {
  let row = totals.find(t => t.currency === currency);
  if (!row) { row = { currency, plannedMinor: 0, actualMinor: 0, automaticMinor: 0, manualPlannedMinor: 0 }; totals.push(row); }
  const next = row[field] + amount;
  if (!Number.isSafeInteger(next)) throw new RangeError("Combined expenses exceed the supported money range");
  row[field] = next;
  row.plannedMinor = row.automaticMinor + row.manualPlannedMinor;
  if (!Number.isSafeInteger(row.plannedMinor)) throw new RangeError("Combined expenses exceed the supported money range");
}
/** Authoritative read-time summary: itinerary mutations need no denormalized cost writes. */
export function summarizeBudget(trip: TripRecord): BudgetSummary {
  const currency = expenseCurrencySchema.safeParse(trip.analysis.budget.currency).success ? trip.analysis.budget.currency : null;
  const total = totalBudgetMinor(trip);
  const allocationCurrency = trip.budgetAllocationCurrency ?? currency;
  const totals: SpendingTotal[] = [];
  const categories = EXPENSE_CATEGORIES.map(category => ({ category, totals: [] as SpendingTotal[] }));
  const days: BudgetSummary["days"] = (trip.itinerary?.days ?? []).map(day => ({ dayId: String(day.dayIndex), totals: [], categories: EXPENSE_CATEGORIES.map(category => ({ category, totals: [] })) }));
  const record = (dayId: string | null, category: ExpenseCategory, code: string, field: "automaticMinor" | "manualPlannedMinor" | "actualMinor", amount: number) => {
    add(totals, code, field, amount); add(categories.find(c => c.category === category)!.totals, code, field, amount);
    let day = days.find(d => d.dayId === dayId);
    if (!day) { day = { dayId, totals: [], categories: EXPENSE_CATEGORIES.map(category => ({ category, totals: [] })) }; days.push(day); }
    add(day.totals, code, field, amount); add(day.categories.find(c => c.category === category)!.totals, code, field, amount);
  };
  const expenses = trip.expenses ?? [];
  let unknown = 0;
  for (const day of trip.itinerary?.days ?? []) {
    const seen = new Set<string>();
    for (const activity of day.activities) {
      if (activity.type !== "attraction") continue;
      const key = `${activity.placeId ?? activity.title}:${activity.startTime}:${activity.endTime}`;
      if (seen.has(key)) continue; seen.add(key);
      const stop = day.stops.find(s => activity.placeId ? s.placeId === activity.placeId : s.name === activity.title);
      const matches = trip.attractions.filter(p => activity.placeId ? p.placeId === activity.placeId : p.name === activity.title && p.lat === stop?.lat && p.lng === stop?.lng);
      const admission = matches.length === 1 ? matches[0].admission : stop?.admission;
      const occurrences = activity.placeId ? (trip.itinerary?.days ?? []).flatMap(d => d.activities.filter(a => a.type === "attraction" && a.placeId === activity.placeId)) : [];
      // A unique moved admission keeps its explicit replacement; historical expense day/date stay fixed.
      const replacement = activity.placeId && expenses.some(e => e.replacesAdmission && e.attractionId === activity.placeId && (e.dayId === String(day.dayIndex) || occurrences.length === 1));
      if (replacement) continue;
      const code = admission?.price?.currency;
      if (admission?.status === "free" && !admission.rawFeeConditional && !admission.rawChargeConditional) continue;
      const cost = code && expenseCurrencySchema.safeParse(code).success ? reliableAdmissionCost(admission, trip.analysis.travelers, code) : null;
      if (cost === null) { unknown++; continue; }
      if (!Number.isSafeInteger((totals.find(t => t.currency === code)?.plannedMinor ?? 0) + cost)) { unknown++; continue; }
      record(String(day.dayIndex), "attractions", code!, "automaticMinor", cost);
    }
  }
  for (const expense of expenses) record(expense.dayId, expense.category, expense.currency, expense.type === "actual" ? "actualMinor" : "manualPlannedMinor", expense.amountMinor);
  const comparisonAvailable = currency !== null && total !== null && totals.every(t => t.currency === currency);
  const own = totals.find(t => t.currency === currency);
  const planned = comparisonAvailable ? own?.plannedMinor ?? 0 : null;
  const actual = comparisonAvailable ? own?.actualMinor ?? 0 : null;
  const warnings: string[] = [];
  if (unknown) warnings.push(`${unknown} admission cost(s) are unconfirmed. Known spending is a partial estimate.`);
  if (!comparisonAvailable) warnings.push("Budget comparison unavailable: budget, traveler count or a common currency is missing. Currency totals are shown separately.");
  if (planned !== null && planned > total!) warnings.push("Known planned spending exceeds your trip budget.");
  if (actual !== null && actual > total!) warnings.push("Actual spending exceeds your trip budget.");
  if (Object.keys(trip.budgetAllocations ?? {}).length && allocationCurrency !== currency) warnings.push("Allocations use a different currency from your current budget. Edit allocations to reserve funds in the new currency.");
  const allocated = Object.values(trip.budgetAllocations ?? {}).reduce((sum, value) => sum + BigInt(value!), 0n);
  if (total !== null && allocationCurrency === currency && allocated > BigInt(total)) warnings.push("Saved allocations exceed your current budget. Review allocations.");
  for (const category of categories) {
    const allocation = trip.budgetAllocations?.[category.category];
    const spending = category.totals.find(t => t.currency === allocationCurrency)?.plannedMinor ?? 0;
    if (allocation !== undefined && spending > allocation) warnings.push(`${category.category}: known planned spending exceeds its allocation.`);
  }
  return { currency, totalBudgetMinor: total, allocations: trip.budgetAllocations ?? {}, allocationCurrency, totals, categories, days,
    plannedSpendingMinor: planned, actualSpendingMinor: actual, plannedRemainingMinor: planned === null ? null : total! - planned,
    actualRemainingMinor: actual === null ? null : total! - actual, unknownAdmissionPriceCount: unknown,
    hasIncompletePricing: unknown > 0, comparisonAvailable, plannedOverBudget: planned !== null && planned > total!, actualOverBudget: actual !== null && actual > total!, warnings };
}
export function budgetData(trip: TripRecord): TripBudgetData {
  return { expenses: (trip.expenses ?? []).map(e => ({ ...e })), revision: trip.budgetRevision ?? 0, summary: summarizeBudget(trip) };
}
