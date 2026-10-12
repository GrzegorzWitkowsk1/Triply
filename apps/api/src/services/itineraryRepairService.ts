import type { TripRecord } from "../models/Trip.js";
import { validateItinerary, scheduledInstant, planningWindow, localMinutes, type ValidationOptions } from "./itineraryValidationService.js";
import { evaluateOpeningHours, resolvePoiTimeZone, visitEndLocalIso } from "./openingHoursService.js";
import { isValidTimeZone } from "./timeZone.js";

/** Bounded transactional time shifting. Retains every activity, order, route,
 * preference and expense. No provider calls and no invented travel durations.
 * Each candidate must reduce blocking errors without adding new issue identities.
 */
export function repairItinerary(input: TripRecord, options: ValidationOptions & { maxAttempts?: number } = {}) {
  let trip = input;
  let validation = validateItinerary(trip, options);
  let attempts = 0;
  const requestedLimit = options.maxAttempts ?? 2;
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(3, Math.floor(requestedLimit))) : 2;
  for (let attempt = 0; attempt < limit && !validation.valid; attempt++) {
    attempts++;
    const candidate = { ...trip, itinerary: trip.itinerary ? { ...trip.itinerary, days: trip.itinerary.days.map(day => ({ ...day, activities: day.activities.map(activity => ({ ...activity })) })) } : null };
    let changed = false;
    for (const day of candidate.itinerary?.days ?? []) {
      if (options.dayIndex !== undefined && day.dayIndex !== options.dayIndex) continue;
      if (!isValidTimeZone(day.timeZone) || day.partiallyEstimated || validation.issues.some(i => i.dayId === String(day.dayIndex) && ["ROUTE_MISSING", "ROUTE_UNKNOWN", "ROUTE_ESTIMATED", "TIMEZONE_UNKNOWN", "ACTIVITY_TIME_INVALID", "ACTIVITY_DURATION_INVALID"].includes(i.code))) continue;
      const window = planningWindow(candidate, day, options);
      let cursor = window.startMinutes;
      for (const activity of day.activities) {
        const original = scheduledInstant(activity.startTime, day.timeZone);
        if (original === null) break;
        let start = Math.max(localMinutes(activity.startTime), cursor);
        if (activity.type === "attraction") {
          const poi = candidate.attractions.find(p => activity.placeId ? p.placeId === activity.placeId : p.name === activity.title);
          const check = evaluateOpeningHours({ metadata: poi?.openingHours, date: day.date, startMinutes: start, durationMinutes: activity.durationMinutes, endMinutes: window.endMinutes, timeZone: resolvePoiTimeZone(poi ?? {}, day.timeZone) });
          if (check.status === "unknown" || (check.status === "closed" && !check.nextAvailableStart)) break;
          if (check.status === "closed") start = localMinutes(check.nextAvailableStart!);
        }
        if (start !== localMinutes(activity.startTime)) {
          const startIso = visitEndLocalIso(day.date, start, 0, day.timeZone);
          const endIso = visitEndLocalIso(day.date, start, activity.durationMinutes, day.timeZone);
          if (endIso.slice(0, 10) !== day.date || localMinutes(endIso) > window.endMinutes) break;
          activity.startTime = startIso; activity.endTime = endIso; changed = true;
        }
        cursor = localMinutes(activity.endTime);
      }
    }
    if (!changed) break;
    const next = validateItinerary(candidate, options);
    const key = (i: typeof next.issues[number]) => `${i.code}:${i.dayId}:${i.activityId}`;
    const existing = new Set(validation.issues.map(key));
    if (next.issues.filter(i => i.severity === "error").length >= validation.issues.filter(i => i.severity === "error").length || next.issues.some(i => !existing.has(key(i)))) break;
    trip = candidate; validation = next;
  }
  return { trip, validation, attempts, repaired: trip !== input };
}
