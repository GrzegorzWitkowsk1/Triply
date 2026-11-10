import type { TripBudgetData, TripDetail } from "@triply/shared";

export const ITEM_ID = "00000000-0000-4000-8000-000000000001";
export function recoveryBudget(revision = 0, amountMinor = 0): TripBudgetData {
  const totals = [{ currency: "EUR", plannedMinor: 0, actualMinor: amountMinor, automaticMinor: 0, manualPlannedMinor: 0 }];
  return { revision, expenses: amountMinor ? [{ id: "expense", title: "Ticket", category: "attractions", amountMinor,
    currency: "EUR", type: "actual", date: null, dayId: "1", attractionId: null, replacesAdmission: false,
    note: null, createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:00:00Z" }] : [],
  summary: { currency: "EUR", totalBudgetMinor: 10000, allocations: {}, allocationCurrency: "EUR", totals,
    categories: [], days: [], plannedSpendingMinor: 0, actualSpendingMinor: amountMinor,
    plannedRemainingMinor: 10000, actualRemainingMinor: 10000 - amountMinor, unknownAdmissionPriceCount: 0,
    hasIncompletePricing: false, comparisonAvailable: true, plannedOverBudget: false, actualOverBudget: false, warnings: [] } };
}
export function recoveryTrip(): TripDetail {
  return { id: "trip", draftId: "trip", status: "ready", prompt: "Paris", badges: [],
    analysis: { destination: "Paris", country: "France", startDate: null, endDate: null, durationDays: 1,
      travelers: 1, budget: { amount: 100, currency: "EUR", type: "total" }, interests: ["culture"],
      pace: "balanced", maxWalkingDistanceKm: null, notes: null, location: null },
    missingFields: [], requirementsComplete: true, equipment: [], weather: [],
    itineraryVersion: 1, visitRevision: 0, visits: [], budgetData: recoveryBudget(),
    itinerary: { timeZone: "Europe/Paris", routingSource: "unavailable", generatedAt: null, unscheduled: [], days: [{
      dayIndex: 1, date: "", timeZone: "Europe/Paris", activities: [{ itineraryItemId: ITEM_ID, type: "attraction", title: "Museum",
        placeId: "node/1", startTime: "2026-11-07T09:00:00", endTime: "2026-11-07T10:00:00", durationMinutes: 60 }],
      stops: [{ itineraryItemId: ITEM_ID, placeId: "node/1", name: "Museum", category: "culture", lat: 48.85, lng: 2.35, score: null }],
      segments: [], geometry: null, totalVisitMinutes: 60, totalTravelMinutes: null, totalDistanceMeters: null, partiallyEstimated: true, warnings: [],
    }] }, generation: { startedAt: null, generatedAt: null, error: null }, fixtureKey: null, createdAt: null, updatedAt: null };
}
