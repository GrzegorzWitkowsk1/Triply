import type {
  DailySchedulingInput,
  DailySchedulingResult,
  Pace,
  PoiCluster,
  SchedulablePoi,
  SchedulingConfig,
  TripDayWeather,
} from "@triply/shared";
import { clusterPois } from "./poiClustering.js";
import {
  buildTripRouting,
  type BuildTripRoutingOptions,
  type TripRoutingResult,
} from "./routePlanning.js";
import { buildDailySchedules } from "./scheduling.js";
import { improveOpeningHoursRoute } from "./openingHoursPlanning.js";
import { createRoutingProvider } from "../routing/index.js";

export interface PlanTripInput<T extends SchedulablePoi = SchedulablePoi> {
  pois: readonly T[];
  durationDays: number | null | undefined;
  pace?: Pace | null;
  weather?: readonly TripDayWeather[] | null;
  startDate?: string | null;
  dates?: readonly (string | null)[] | null;
  timeZone?: string | null;
  routing?: BuildTripRoutingOptions;
  config?: Partial<SchedulingConfig>;
  dayWindows?: DailySchedulingInput<T>["dayWindows"];
  arrivalTimeMinutes?: number | null;
  departureTimeMinutes?: number | null;
}

export interface PlanTripResult<T extends SchedulablePoi = SchedulablePoi>
  extends DailySchedulingResult<T> {
  clusters: PoiCluster<T>[];
  routing: TripRoutingResult<T>;
}

/**
 * Deterministic planner orchestration that connects the existing stages:
 * scored POIs -> clustering -> buildTripRouting -> buildDailySchedules.
 *
 * This is intentionally not wired into the live trip draft endpoints.
 */
export async function planTrip<T extends SchedulablePoi = SchedulablePoi>(
  input: PlanTripInput<T>,
): Promise<PlanTripResult<T>> {
  const clustering = clusterPois<T>(input.pois, {
    days: input.durationDays,
    pace: input.pace,
  });

  const routing = await buildTripRouting<T>(clustering, input.routing ?? {});
  const openingConflicts: DailySchedulingResult<T>["unscheduledPlaces"] = [];
  for (let index = 0; index < routing.dayRoutes.length; index++) {
    const improved = await improveOpeningHoursRoute(routing.dayRoutes[index], {
      ...input, travelMode: routing.mode, start: input.routing?.start,
    }, { ...input.routing, mode: routing.mode, returnToStart: input.routing?.returnToStart ?? routing.dayRoutes[index].returnsToStart,
      provider: input.routing?.provider !== undefined ? input.routing.provider : createRoutingProvider() });
    routing.dayRoutes[index] = improved.route;
    openingConflicts.push(...improved.conflicts);
  }
  if (routing.dayRoutes.some(route => route.routingSource === "approximation")) routing.source = "approximation";

  const schedules = buildDailySchedules<T>({
    dayRoutes: routing.dayRoutes,
    travelMode: routing.mode,
    pace: input.pace,
    weather: input.weather,
    timeZone: input.timeZone,
    startDate: input.startDate,
    dates: input.dates,
    start: input.routing?.start ?? null,
    config: input.config,
    dayWindows: input.dayWindows,
    arrivalTimeMinutes: input.arrivalTimeMinutes,
    departureTimeMinutes: input.departureTimeMinutes,
  });

  const unscheduledPlaces = [...schedules.unscheduledPlaces, ...openingConflicts];
  for (const conflict of openingConflicts) {
    schedules.days.find(day => day.dayIndex === conflict.dayIndex)?.warnings.push(`${conflict.place.name}: ${conflict.detail}`);
  }

  for (const place of clustering.unassigned) {
    unscheduledPlaces.push({
      place,
      dayIndex: null,
      reason: "unassigned-cluster",
      detail: "The place could not be assigned to a cluster for scheduling.",
    });
  }

  return {
    ...schedules,
    unscheduledPlaces,
    clusters: clustering.clusters,
    routing,
  };
}
