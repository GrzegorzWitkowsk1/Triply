import { isIsoDate, type ItineraryDay, type ItineraryIssue, type ItineraryValidationResult, type DayWindowOverride, type SchedulingConfig } from "@triply/shared";
import { TZDate } from "@date-fns/tz";
import type { TripRecord } from "../models/Trip.js";
import { evaluateOpeningHours, resolvePoiTimeZone } from "./openingHoursService.js";
import { isValidTimeZone } from "./timeZone.js";
import { mergeSchedulingConfig } from "./schedulingConfig.js";
import { summarizeBudget } from "./budgetSummary.js";
import { distanceMeters, isValidCoordinate } from "./geo.js";
import { weatherIssues } from "./weatherDiagnostics.js";

export interface ValidationOptions {
  dayIndex?: number;
  activityId?: string;
  allowDuplicates?: boolean;
  config?: Partial<SchedulingConfig>;
  dayWindows?: readonly DayWindowOverride[];
}
export function planningWindow(trip: TripRecord, day: ItineraryDay, options: ValidationOptions = {}) {
  const config = mergeSchedulingConfig(options.config);
  const profile = config.pace[trip.analysis.pace ?? config.defaultPace];
  const override = options.dayWindows?.find(w => w.dayIndex === day.dayIndex);
  return { startMinutes: override?.startMinutes ?? profile.startMinutes, endMinutes: override?.endMinutes ?? profile.endMinutes };
}
export function localMinutes(value: string): number { return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16)); }
/** Strict local timestamp parsing. No host timezone assumptions. */
export function scheduledInstant(value: string, zone: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value) || !isIsoDate(value.slice(0, 10))) return null;
  const parts = value.split(/[-T:]/).map(Number);
  const date = new TZDate(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] ?? 0, zone);
  return date.toISOString().slice(0, value.length) === value ? date.getTime() : null;
}

/** Pure, request-local validation using structured metadata; never calls providers. */
export function validateItinerary(trip: TripRecord, options: ValidationOptions = {}): ItineraryValidationResult {
  const issues: ItineraryIssue[] = [];
  const add = (code: string, severity: ItineraryIssue["severity"], dimension: ItineraryIssue["dimension"], message: string, day?: ItineraryDay, activityId?: string, details?: Record<string, unknown>) =>
    issues.push({ code, severity, dimension, message, ...(day ? { dayId: String(day.dayIndex) } : {}), ...(activityId ? { activityId } : {}), ...(details ? { details } : {}) });
  const allDays = trip.itinerary?.days ?? [];
  const days = allDays.filter(d => options.dayIndex === undefined || d.dayIndex === options.dayIndex);
  const weatherDiagnostics = weatherIssues(trip);
  const pool = new Map(trip.attractions.filter(p => p.placeId).map(p => [p.placeId!, p]));
  const seen = new Set<string>();
  let previousDay = -1;
  let previousDate = "";
  for (const day of allDays) {
    const included = days.includes(day);
    if (included && (!Number.isInteger(day.dayIndex) || day.dayIndex <= previousDay || (day.date && previousDate && day.date <= previousDate)))
      add("DAY_ORDER_INVALID", "error", "schedule", "Itinerary days are out of order.", day);
    previousDay = day.dayIndex; previousDate = day.date;
    for (const activity of day.activities.filter(a => a.type === "attraction")) {
      const key = activity.placeId ?? `${activity.title}:${day.stops.find(p => p.name === activity.title)?.lat}:${day.stops.find(p => p.name === activity.title)?.lng}`;
      if (included && seen.has(key) && !options.allowDuplicates) add("ATTRACTION_DUPLICATE", "error", "schedule", "This attraction is scheduled more than once.", day, activity.placeId);
      seen.add(key);
    }
    if (!included) continue;
    if (!isIsoDate(day.date)) add("DAY_DATE_UNKNOWN", day.date ? "error" : "warning", "schedule", "A valid calendar date is needed to verify this day.", day);
    else if ((trip.analysis.startDate && day.date < trip.analysis.startDate) || (trip.analysis.endDate && day.date > trip.analysis.endDate))
      add("DATE_OUTSIDE_TRIP", "error", "schedule", "This day falls outside the trip dates.", day);
    const zoneKnown = isValidTimeZone(day.timeZone) && !day.warnings.some(w => /time zone unknown|Unknown time zone/i.test(w));
    if (!zoneKnown) add("TIMEZONE_UNKNOWN", "warning", "dataCompleteness", "Destination timezone is unavailable. Timing is uncertain.", day);
    const window = planningWindow(trip, day, options);
    if (day.travelMode && !["walking", "cycling", "driving"].includes(day.travelMode)) add("ROUTE_MODE_INVALID", "error", "routing", "Route travel mode is unsupported.", day);
    let previousEnd: number | null = null;
    let load = 0;
    for (const [index, activity] of day.activities.entries()) {
      const id = activity.placeId ?? `${day.dayIndex}:${index}`;
      if (activity.schedulingStatus === "unresolved") {
        add("SCHEDULE_UNRESOLVED", "error", "schedule", "This visit has no feasible scheduled time. Adjust or remove it and recalculate.", day, id);
        if (activity.type !== "attraction" || activity.startTime || activity.endTime)
          add("UNRESOLVED_ACTIVITY_INVALID", "error", "schedule", "An unresolved visit must be an attraction without scheduled times.", day, id);
      }
      if (!Number.isFinite(activity.durationMinutes) || activity.durationMinutes < 0 || (activity.type !== "travel" && activity.durationMinutes === 0))
        add("ACTIVITY_DURATION_INVALID", "error", "schedule", "Activity duration must be valid and positive for visits and breaks.", day, id);
      const zone = zoneKnown ? day.timeZone : "UTC";
      const start = scheduledInstant(activity.startTime, zone), end = scheduledInstant(activity.endTime, zone);
      if (start === null || end === null) {
        add("ACTIVITY_TIME_INVALID", day.date && activity.startTime && activity.endTime ? "error" : "warning", "schedule", "Activity times are missing or invalid.", day, id);
        continue;
      }
      if (Number.isFinite(activity.durationMinutes) && activity.durationMinutes >= 0 && (end < start || (zoneKnown && Math.abs((end - start) / 60000 - activity.durationMinutes) > 0.02)))
        add("ACTIVITY_DURATION_INVALID", "error", "schedule", "Activity duration does not match its scheduled interval.", day, id);
      if (previousEnd !== null && start < previousEnd) add("ACTIVITY_OVERLAP", "error", "schedule", "Activities overlap. Adjust their times.", day, id);
      previousEnd = Math.max(previousEnd ?? end, end);
      if (day.date && (activity.startTime.slice(0, 10) !== day.date || activity.endTime.slice(0, 10) !== day.date))
        add("ACTIVITY_DATE_INVALID", "error", "schedule", "Activity timestamps do not belong to this day.", day, id);
      if (localMinutes(activity.startTime) < window.startMinutes || localMinutes(activity.endTime) > window.endMinutes)
        add("DAILY_WINDOW_EXCEEDED", "error", "schedule", "Activity falls outside the daily planning window.", day, id);
      load += Math.max(0, activity.durationMinutes);
      if (activity.type === "travel" && activity.travelDurationSource !== "provider")
        add(activity.travelDurationSource === "approximation" ? "ROUTE_ESTIMATED" : "ROUTE_UNKNOWN", "warning", "routing", "Travel timing is estimated or unavailable. Verify the route.", day, id);
      if (activity.type !== "attraction") continue;
      const poi = activity.placeId ? pool.get(activity.placeId) : trip.attractions.find(p => p.name === activity.title);
      const stop = day.stops.find(p => activity.placeId ? p.placeId === activity.placeId : p.name === activity.title);
      if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng) || Math.abs(stop.lat) > 90 || Math.abs(stop.lng) > 180)
        add("COORDINATES_INVALID", "error", "routing", "Attraction coordinates are missing or invalid.", day, id);
      if (stop && isValidCoordinate(stop.lat, stop.lng) && trip.analysis.location && trip.analysis.maxWalkingDistanceKm !== null && day.travelMode === "walking" && distanceMeters(trip.analysis.location.lat, trip.analysis.location.lng, stop.lat, stop.lng) > trip.analysis.maxWalkingDistanceKm * 1000)
        add("GEOGRAPHIC_OUTLIER", "warning", "routing", "This attraction is farther from your destination than your preferred walking distance. Consider transport.", day, id);
      const check = evaluateOpeningHours({ metadata: poi?.openingHours, date: day.date, startMinutes: localMinutes(activity.startTime), durationMinutes: activity.durationMinutes, timeZone: resolvePoiTimeZone(poi ?? stop ?? {}, zoneKnown ? day.timeZone : null) });
      if (check.status === "closed") add("OPENING_HOURS_CONFLICT", "error", "openingHours", "The full visit does not fit known opening hours.", day, id, { reason: check.reason, nextAvailableStart: check.nextAvailableStart });
      else if (check.status === "unknown") add(check.reason.includes("expression") ? "OPENING_HOURS_INVALID" : "OPENING_HOURS_UNKNOWN", "warning", "openingHours", "Opening hours cannot be confirmed. Check before visiting.", day, id, { reason: check.reason });
    }
    if (load > window.endMinutes - window.startMinutes) add("DAILY_LOAD_EXCESSIVE", "warning", "workload", "Scheduled activity load exceeds this pace's daily window.", day);
    if (day.travelMode === "walking" && trip.analysis.maxWalkingDistanceKm !== null && day.totalDistanceMeters !== null && day.totalDistanceMeters > trip.analysis.maxWalkingDistanceKm * 1000)
      add("WALKING_PREFERENCE_EXCEEDED", "warning", "routing", "This day's route exceeds your preferred walking distance.", day);
    if (day.totalTravelMinutes !== null && day.totalVisitMinutes > 0 && day.totalTravelMinutes > day.totalVisitMinutes)
      add("TRAVEL_LOAD_HIGH", "warning", "routing", "This day spends more time traveling than visiting attractions.", day);
    issues.push(...weatherDiagnostics.filter(issue => issue.dayId === String(day.dayIndex)));
    const visits = day.activities.filter(a => a.type === "attraction");
    for (let i = 1; i < visits.length; i++) {
      const from = day.stops.findIndex(p => p.placeId ? p.placeId === visits[i - 1].placeId : p.name === visits[i - 1].title);
      const to = day.stops.findIndex(p => p.placeId ? p.placeId === visits[i].placeId : p.name === visits[i].title);
      const inferredOffset = day.routeStopOffset ?? (day.segments.length && trip.analysis.location ? 1 : 0);
      const segment = day.segments.find(s => s.fromIndex === from + inferredOffset && s.toIndex === to + inferredOffset);
      if (!segment || segment.durationSeconds === null) add("ROUTE_MISSING", "warning", "routing", "Travel between these attractions cannot be verified.", day, visits[i].placeId);
      else {
        const start = scheduledInstant(visits[i].startTime, zoneKnown ? day.timeZone : "UTC");
        const end = scheduledInstant(visits[i - 1].endTime, zoneKnown ? day.timeZone : "UTC");
        if (start !== null && end !== null && (start - end) / 1000 + 30 < segment.durationSeconds)
          add("TRAVEL_WINDOW_IMPOSSIBLE", "error", "routing", "Travel does not fit between these visits.", day, visits[i].placeId);
      }
    }
    for (const segment of day.segments) {
      if ((segment.durationSeconds !== null && (!Number.isFinite(segment.durationSeconds) || segment.durationSeconds < 0)) || (segment.distanceMeters !== null && (!Number.isFinite(segment.distanceMeters) || segment.distanceMeters < 0)))
        add("ROUTE_VALUES_INVALID", "error", "routing", "Route duration or distance is invalid.", day);
      const offset = day.routeStopOffset ?? (trip.analysis.location ? 1 : 0);
      const endIndex = day.stops.length + offset - 1 + (day.routeReturnsToStart ?? (trip.analysis.location ? true : false) ? 1 : 0);
      if (![segment.fromIndex, segment.toIndex].every(i => Number.isInteger(i) && i >= 0 && i <= endIndex))
        add("ROUTE_SEGMENT_INVALID", "error", "routing", "Route endpoints do not match this day's stops.", day);
    }
    if (day.partiallyEstimated && !issues.some(i => i.dayId === String(day.dayIndex) && i.code === "ROUTE_ESTIMATED")) add("ROUTE_ESTIMATED", "warning", "routing", "Route uses fallback estimates rather than confirmed travel times.", day);
  }
  if (trip.itinerary) {
    const budget = summarizeBudget(trip);
    if (budget.plannedOverBudget) add("BUDGET_PLANNED_EXCEEDED", "warning", "budget", "Known planned spending exceeds the trip budget.");
    if (budget.actualOverBudget) add("BUDGET_ACTUAL_EXCEEDED", "warning", "budget", "Actual spending exceeds the trip budget.");
    if (budget.hasIncompletePricing) add("ADMISSION_PRICE_UNKNOWN", "warning", "budget", "Some admission prices are unknown. Spending estimates are incomplete.");
    if (budget.totals.some(t => t.currency !== budget.currency) || budget.allocationCurrency !== budget.currency) add("BUDGET_CURRENCY_MISMATCH", "warning", "budget", "Budget currencies differ. Totals cannot be directly compared.");
    if (!budget.comparisonAvailable) add("BUDGET_COMPARISON_UNKNOWN", "warning", "budget", "Budget alignment cannot be evaluated with the available data.");
    if (budget.totalBudgetMinor !== null && budget.allocationCurrency === budget.currency && Object.values(budget.allocations).reduce((sum, n) => sum + BigInt(n ?? 0), 0n) > BigInt(budget.totalBudgetMinor))
      add("BUDGET_ALLOCATION_EXCEEDED", "warning", "budget", "Reserved allocations exceed the trip budget.");
    for (const category of budget.categories) {
      const allocation = budget.allocations[category.category];
      const planned = category.totals.find(t => t.currency === budget.allocationCurrency)?.plannedMinor;
      if (allocation !== undefined && planned !== undefined && planned > allocation) add("BUDGET_CATEGORY_ALLOCATION_EXCEEDED", "warning", "budget", "Known spending exceeds a category allocation.", undefined, undefined, { category: category.category });
    }
  }
  const selected = options.activityId ? issues.filter(i => !i.activityId || i.activityId === options.activityId) : issues;
  return { valid: !selected.some(i => i.severity === "error"), issues: selected };
}
