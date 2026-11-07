import type { ItineraryDay } from "@triply/shared";
import type { TripDocument } from "../models/Trip.js";

/** Share the existing budget CAS with every itinerary write. No spending data is removed. */
export function expenseLinksForItinerary(trip: TripDocument, days: readonly ItineraryDay[]) {
  const ids = new Set(days.flatMap(day => day.activities.filter(item => item.type === "attraction").map(item => item.itineraryItemId)));
  let changed = false;
  const expenses = (trip.toObject().expenses ?? []).map(expense => {
    if (!expense.itineraryItemId || ids.has(expense.itineraryItemId)) return expense;
    changed = true;
    return { ...expense, itineraryItemId: null };
  });
  const revision = trip.budgetRevision ?? 0;
  return {
    filter: { $or: [{ budgetRevision: revision }, ...(revision === 0 ? [{ budgetRevision: { $exists: false } }] : [])] },
    set: changed ? { expenses } : {},
    increment: changed ? { budgetRevision: 1 } : {},
  };
}
