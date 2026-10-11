import type { DailySchedulingInput, OptimizedDayRoute, SchedulablePoi, UnscheduledPlace } from "@triply/shared";
import { addDays } from "@triply/shared";
import { evaluateOpeningHours, resolvePoiTimeZone } from "./openingHoursService.js";
import { mergeSchedulingConfig } from "./schedulingConfig.js";
import { buildDailySchedules, resolveVisit } from "./scheduling.js";
import { optimizeClusterRoute, type OptimizeClusterOptions } from "./routeOptimizer.js";

export function planningAvailability(poi: SchedulablePoi, date: string, input: Omit<DailySchedulingInput, "dayRoutes">, dayIndex: number) {
  const config = mergeSchedulingConfig(input.config);
  const profile = config.pace[input.pace ?? config.defaultPace];
  const override = input.dayWindows?.find(window => window.dayIndex === dayIndex);
  return evaluateOpeningHours({ metadata: poi.openingHours && "raw" in poi.openingHours ? poi.openingHours : null,
    date, startMinutes: override?.startMinutes ?? profile.startMinutes, endMinutes: override?.endMinutes ?? profile.endMinutes,
    durationMinutes: resolveVisit(poi, config).minutes, timeZone: resolvePoiTimeZone(poi, input.timeZone) });
}

/** Automatic planning only: keep geographic groups, retry their order once.
 * Manual edits deliberately bypass this helper and retain the requested order.
 */
export async function improveOpeningHoursRoute<T extends SchedulablePoi>(route: OptimizedDayRoute<T>,
  input: Omit<DailySchedulingInput<T>, "dayRoutes">, options: OptimizeClusterOptions) {
  const date = input.dates?.[route.dayIndex - 1] ?? (input.startDate ? addDays(input.startDate, route.dayIndex - 1) : "");
  const conflicts: UnscheduledPlace<T>[] = [];
  const availability = new Map(route.orderedPlaces.map(poi => [poi, planningAvailability(poi, date ?? "", input, route.dayIndex)]));
  const feasible = route.orderedPlaces.filter(poi => {
    const check = availability.get(poi)!;
    if (check.status !== "closed" || check.nextAvailableStart || check.intervals.some(interval => interval.unknown)) return true;
    conflicts.push({ place: poi, dayIndex: route.dayIndex, reason: "opening-hours-conflict", detail: check.reason });
    return false;
  });
  const baseline = buildDailySchedules({ ...input, dayRoutes: [route] });
  if (!conflicts.length && !baseline.unscheduledPlaces.some(place => place.reason === "opening-hours-conflict"))
    return { route, conflicts };
  // Earliest closing constraints first; unconstrained places retain route order.
  const ordered = [...feasible].sort((a, b) => {
    const deadline = (poi: T) => availability.get(poi)!.intervals.find(interval => !interval.unknown)?.end ?? "9999";
    return deadline(a).localeCompare(deadline(b));
  });
  const candidate = await optimizeClusterRoute({ day: route.dayIndex, pois: ordered, center: null,
    medoid: null, count: ordered.length, avgScore: 0, spreadMeters: 0 }, { ...options, preserveOrder: true });
  const proposed = buildDailySchedules({ ...input, dayRoutes: [candidate] });
  const count = (result: typeof baseline) => result.days[0].activities.filter(activity => activity.type === "attraction").length;
  return count(proposed) >= count(baseline) ? { route: candidate, conflicts } : { route, conflicts: [] };
}
