import { randomUUID } from "node:crypto";
import type { ItineraryDay } from "@triply/shared";

/** Assign occurrence IDs without using titles, times or array positions as identity. */
export function ensureItemIdentities(days: ItineraryDay[]): boolean {
  let changed = false;
  const seen = new Set<string>();
  for (const day of days) {
    for (const item of day.activities.filter(item => item.type === "attraction")) {
      if (!item.itineraryItemId || seen.has(item.itineraryItemId)) {
        item.itineraryItemId = randomUUID();
        changed = true;
      }
      seen.add(item.itineraryItemId);
    }
    // Stops are editing carriers; only unambiguous provider matches are safe.
    for (const stop of day.stops) {
      const matches = day.activities.filter(item => item.type === "attraction" && item.placeId && item.placeId === stop.placeId);
      if (matches.length === 1) stop.itineraryItemId = matches[0].itineraryItemId;
    }
  }
  return changed;
}

/** Recalculation retains the explicitly carried stop identity. */
export function carryStopIdentities(day: ItineraryDay, stops: ItineraryDay["stops"]) {
  for (const item of day.activities.filter(item => item.type === "attraction")) {
    const matches = stops.filter(stop => stop.placeId && stop.placeId === item.placeId);
    item.itineraryItemId = matches.length === 1 ? matches[0].itineraryItemId : undefined;
  }
  ensureItemIdentities([day]);
}

/** Exact, unique provider identity within this day proves a retained logical visit. */
export function retainRegeneratedIdentities(original: ItineraryDay, proposed: ItineraryDay) {
  const old = original.activities.filter(item => item.type === "attraction");
  const next = proposed.activities.filter(item => item.type === "attraction");
  for (const item of next) {
    const matches = old.filter(candidate => candidate.placeId && candidate.placeId === item.placeId);
    if (matches.length === 1 && next.filter(candidate => candidate.placeId === item.placeId).length === 1) {
      item.itineraryItemId = matches[0].itineraryItemId;
    } else item.itineraryItemId = randomUUID();
  }
  ensureItemIdentities([proposed]);
}
