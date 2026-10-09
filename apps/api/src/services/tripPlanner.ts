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

  const unscheduledPlaces = [...schedules.unscheduledPlaces];

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
