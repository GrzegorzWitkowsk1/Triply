import type { ItineraryDay } from "@triply/shared";
import type { TripDocument } from "../models/Trip.js";

export class VisitedItemLockedError extends Error {
  readonly status = 409;
  readonly expose = true;
  constructor() { super("Visited attractions are locked. Reset them to planned before changing their itinerary."); }
}

export function visitRevisionGuard(trip: TripDocument) {
  const revision = trip.visitRevision ?? 0;
  return { $or: [{ visitRevision: revision }, ...(revision === 0 ? [{ visitRevision: { $exists: false } }] : [])] };
}

export function assertNoVisited(trip: TripDocument, dayIndex?: number) {
  const locked = new Set((trip.visits ?? []).filter(v => v.status === "visited").map(v => v.itineraryItemId));
  if (trip.itinerary?.days.some(day => (dayIndex === undefined || day.dayIndex === dayIndex) &&
    day.activities.some(item => item.itineraryItemId && locked.has(item.itineraryItemId)))) throw new VisitedItemLockedError();
}

/** Compare the final schedule, including indirect shifts caused by other edits. */
export function assertVisitedUnchanged(trip: TripDocument, days: readonly ItineraryDay[]) {
  const snapshot = (values: readonly ItineraryDay[], id: string) => {
    for (const day of values) {
      const visits = day.activities.filter(item => item.type === "attraction");
      const position = visits.findIndex(item => item.itineraryItemId === id);
      if (position < 0) continue;
      const item = visits[position];
      const stop = day.stops.find(stop => stop.itineraryItemId === id);
      return JSON.stringify([day.dayIndex, day.date, day.timeZone, position, item.placeId, item.title,
        item.startTime, item.endTime, item.durationMinutes, item.schedulingStatus, stop?.lat, stop?.lng]);
    }
    return null;
  };
  for (const visit of trip.visits ?? []) {
    if (visit.status !== "visited") continue;
    const before = snapshot(trip.itinerary?.days ?? [], visit.itineraryItemId);
    if (before && before !== snapshot(days, visit.itineraryItemId)) throw new VisitedItemLockedError();
  }
}
