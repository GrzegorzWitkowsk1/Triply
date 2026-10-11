import { describe, expect, it } from "vitest";
import { decimalToMinor, expenseInputSchema, formatMoney, minorToDecimal } from "@triply/shared";
import { TripModel } from "../models/Trip.js";
import { summarizeBudget, reliableAdmissionCost } from "./budgetSummary.js";
import { budgetAwareCandidates, remainingAttractionBudget, selectBudgetCandidates } from "./budgetSelection.js";
import { normalizeAdmission } from "./admissionPricingService.js";
import { interpretBudgetRequest } from "./assistantBudget.js";

function fixture() {
  return new TripModel({ user: "507f1f77bcf86cd799439011", analysis: { budget: { amount: 100, currency: "EUR", type: "total" }, travelers: 2, durationDays: 2 },
    attractions: [{ placeId: "node/1", name: "Museum", category: "culture", lat: 1, lng: 1, admission: normalizeAdmission({ tourism: "museum", fee: "yes", charge: "15 EUR per person" }) }],
    itinerary: { timeZone: "UTC", routingSource: "unavailable", days: [{ dayIndex: 1, date: "2026-10-11", timeZone: "UTC", activities: [{ type: "attraction", placeId: "node/1", title: "Museum", startTime: "2026-10-11T09:00", endTime: "2026-10-11T10:00", durationMinutes: 60 }], stops: [], totalVisitMinutes: 60 }], unscheduled: [] },
  });
}
const expense = (input: Record<string, unknown> = {}) => ({ ...expenseInputSchema.parse({ title: "Lunch", category: "food_drinks", currency: "EUR", amountMinor: 2500, type: "planned", ...input }), id: "00000000-0000-4000-8000-000000000001", createdAt: "2026-10-11T12:00:00Z", updatedAt: "2026-10-11T12:00:00Z" });
describe("deterministic budget summaries", () => {
  it("supports currency precision without float accumulation", () => {
    expect(decimalToMinor("0.29", "EUR")).toBe(29);
    expect(decimalToMinor("25", "JPY")).toBe(25);
    expect(decimalToMinor("1.234", "KWD")).toBe(1234);
    expect(() => decimalToMinor("1.1", "JPY")).toThrow();
    expect(() => decimalToMinor("9007199254740992", "JPY")).toThrow();
    expect(minorToDecimal(Number.MAX_SAFE_INTEGER, "EUR")).toBe("90071992547409.91");
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "EUR")).toBe("€90,071,992,547,409.91");
    expect(formatMoney(-1, "EUR")).toBe("-€0.01");
  });
  it("separates actual, planned, automatic, category and unassigned/day spending", () => {
    const trip = fixture(); trip.expenses = [expense(), expense({ type: "actual", amountMinor: 1800, dayId: "1" })];
    const result = summarizeBudget(trip.toObject());
    expect(result.plannedSpendingMinor).toBe(5500); expect(result.actualSpendingMinor).toBe(1800);
    expect(result.plannedRemainingMinor).toBe(4500); expect(result.actualRemainingMinor).toBe(8200);
    expect(result.days.find(d => d.dayId === null)?.totals[0].plannedMinor).toBe(2500);
    expect(result.days[0].totals[0].actualMinor).toBe(1800);
    expect(result.categories.find(c => c.category === "food_drinks")?.totals[0].plannedMinor).toBe(2500);
  });
  it("reconciles only explicit admission replacements and preserves souvenir purchases", () => {
    const trip = fixture(); trip.expenses = [expense({ title: "Ticket", category: "attractions", attractionId: "node/1", dayId: "1", replacesAdmission: true, amountMinor: 1500 }), expense({ title: "Souvenir", category: "shopping", attractionId: "node/1", amountMinor: 2000 })];
    expect(summarizeBudget(trip.toObject()).plannedSpendingMinor).toBe(3500);
    trip.expenses[0].replacesAdmission = false;
    expect(summarizeBudget(trip.toObject()).plannedSpendingMinor).toBe(6500);
  });
  it("moves an expense from planned to actual without counting it in both buckets", () => {
    const trip = fixture(); trip.expenses = [expense({ category: "attractions", attractionId: "node/1", dayId: "1", replacesAdmission: true, amountMinor: 1500 })];
    trip.expenses[0].type = "actual";
    const summary = summarizeBudget(trip.toObject());
    expect(summary.plannedSpendingMinor).toBe(0); expect(summary.actualSpendingMinor).toBe(1500);
  });
  it("preserves recorded day/date and reconciliation when the attraction moves", () => {
    const trip = fixture(); trip.expenses = [expense({ dayId: "1", date: "2026-10-11", category: "attractions", attractionId: "node/1", replacesAdmission: true })];
    trip.itinerary!.days[0].dayIndex = 2;
    const summary = summarizeBudget(trip.toObject());
    expect(summary.plannedSpendingMinor).toBe(2500); expect(summary.days.find(d => d.dayId === "1")?.totals[0].plannedMinor).toBe(2500);
    expect(trip.expenses[0].date).toBe("2026-10-11");
  });
  it("preserves spending on removed attractions and removed days", () => {
    const trip = fixture(); trip.expenses = [expense({ type: "actual", attractionId: "node/1", dayId: "1" })]; trip.itinerary!.days = [];
    expect(summarizeBudget(trip.toObject()).actualSpendingMinor).toBe(2500);
  });
  it("never adds unknown pricing units or missing traveler counts as known costs", () => {
    const trip = fixture(); trip.analysis.travelers = null;
    expect(summarizeBudget(trip.toObject()).unknownAdmissionPriceCount).toBe(1);
    trip.attractions[0].admission!.price!.unit = "per_group";
    expect(summarizeBudget(trip.toObject()).plannedSpendingMinor).toBe(1500);
    trip.attractions[0].admission!.price!.unit = "unknown";
    expect(summarizeBudget(trip.toObject()).plannedSpendingMinor).toBe(0);
  });
  it("does not invent prices or treat unknown admission as free", () => {
    const trip = fixture(); trip.attractions[0].admission = normalizeAdmission({ tourism: "museum", fee: "yes" });
    expect(summarizeBudget(trip.toObject())).toMatchObject({ hasIncompletePricing: true, unknownAdmissionPriceCount: 1 });
    trip.attractions[0].admission = normalizeAdmission({ tourism: "museum", fee: "no" });
    expect(summarizeBudget(trip.toObject()).hasIncompletePricing).toBe(false);
  });
  it("returns separate currencies and disables cross-currency comparisons", () => {
    const trip = fixture(); trip.expenses = [expense({ currency: "JPY", amountMinor: 2500 })];
    expect(summarizeBudget(trip.toObject())).toMatchObject({ comparisonAvailable: false, plannedSpendingMinor: null, actualRemainingMinor: null });
    expect(summarizeBudget(trip.toObject()).totals.map(t => t.currency)).toEqual(["EUR", "JPY"]);
  });
  it("allocations reserve funds without increasing spending", () => {
    const trip = fixture(); trip.budgetAllocations = { attractions: 2000, food_drinks: 6000 };
    const summary = summarizeBudget(trip.toObject());
    expect(summary.plannedSpendingMinor).toBe(3000); expect(summary.warnings.join(" ")).toContain("allocation");
    expect(remainingAttractionBudget(trip.toObject())).toBe(0);
    expect(remainingAttractionBudget(trip.toObject(), 1)).toBe(2000);
  });
  it("supports per-person budgets, older trips and absent budgets", () => {
    const trip = fixture(); trip.analysis.budget.type = "per_person";
    expect(summarizeBudget(trip.toObject()).totalBudgetMinor).toBe(20000);
    trip.analysis.travelers = null;
    expect(summarizeBudget(trip.toObject()).totalBudgetMinor).toBeNull();
    trip.analysis.budget.amount = null; trip.itinerary = null;
    expect(summarizeBudget(trip.toObject()).totals).toEqual([]);
  });
  it("keeps allocation currencies stable after preferences change", () => {
    const trip = fixture(); trip.budgetAllocations = { attractions: 9000 }; trip.budgetAllocationCurrency = "EUR";
    trip.analysis.budget.currency = "JPY";
    const summary = summarizeBudget(trip.toObject());
    expect(summary.allocationCurrency).toBe("EUR"); expect(summary.warnings.join(" ")).toContain("different currency");
  });
  it("reserves actual spending as well as planned commitments during selection", () => {
    const trip = fixture(); trip.expenses = [expense({ type: "actual", amountMinor: 8000 })];
    expect(remainingAttractionBudget(trip.toObject(), 1)).toBe(2000);
  });
  it("rejects mismatched currency precision and overflowing per-person prices", () => {
    const trip = fixture(); const admission = trip.attractions[0].admission!;
    admission.price!.fractionDigits = 0;
    expect(reliableAdmissionCost(admission, 2, "EUR")).toBeNull();
    admission.price!.fractionDigits = 2; admission.price!.amountMinor = Number.MAX_SAFE_INTEGER;
    expect(reliableAdmissionCost(admission, 2, "EUR")).toBeNull();
  });
});
describe("budget-aware planning and assistant requests", () => {
  it("prefers affordable alternatives without rejecting unknown prices or named must-visits", () => {
    const trip = fixture(); trip.analysis.durationDays = 1; trip.analysis.budget.amount = 10; trip.itinerary = null;
    const paid = trip.toObject().attractions[0]; paid.score = 80;
    const free = { ...paid, name: "Garden", placeId: "node/2", admission: normalizeAdmission({ leisure: "garden", fee: "no" }) };
    const unknown = { ...paid, name: "Gallery", placeId: "node/3", admission: null };
    expect(budgetAwareCandidates([paid, free, unknown], trip.toObject()).map(p => p.score)).toEqual([55,80,80]);
    expect(selectBudgetCandidates([paid,free,unknown],trip.toObject()).map(p => p.name)).toContain("Gallery");
    expect(selectBudgetCandidates([paid,free,unknown],trip.toObject()).map(p => p.name)).not.toContain("Museum");
    trip.analysis.notes = "Must visit Museum";
    expect(selectBudgetCandidates([paid,free,unknown],trip.toObject()).map(p => p.name)).toContain("Museum");
  });
  it("uses literal amounts, distinguishes add/record and prepares mutations only", () => {
    const trip = fixture();
    expect(interpretBudgetRequest(trip,"Add €25 for lunch on day 1")?.operation).toMatchObject({ type: "create", expense: { amountMinor: 2500, dayId: "1", type: "planned" } });
    expect(interpretBudgetRequest(trip,"Record €18 for drinks")?.operation).toMatchObject({ type: "create", expense: { amountMinor: 1800, dayId: null, type: "actual" } });
    expect(trip.expenses).toHaveLength(0);
    expect(interpretBudgetRequest(trip,"Record some drinks")?.operation).toBeUndefined();
    expect(interpretBudgetRequest(trip,"Add a museum on day 1")).toBeNull();
    expect(interpretBudgetRequest(trip,"Add EUR 25 USD for lunch")?.operation).toBeUndefined();
    expect(interpretBudgetRequest(trip,"Can you make day 1 cheaper?")?.cheaperDay).toBe(1);
  });
  it("clarifies ambiguous titles and preserves historical dates in proposed moves", () => {
    const trip = fixture(); trip.expenses = [expense({ title: "Taxi", date: "2026-10-10" })];
    expect(interpretBudgetRequest(trip,"Move my Taxi expense to day 1")?.operation).toMatchObject({ type: "update", expense: { date: "2026-10-10", dayId: "1" } });
    trip.expenses.push(expense({ title: "Taxi" }));
    expect(interpretBudgetRequest(trip,"Delete the Taxi expense")?.operation).toBeUndefined();
  });
});
