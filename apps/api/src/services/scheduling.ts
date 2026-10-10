import {
  addDays,
  isIsoDate,
  type BreakRule,
  type DailySchedule,
  type DailySchedulingInput,
  type DailySchedulingResult,
  type DurationSource,
  type OpeningWindow,
  type RouteSegment,
  type SchedulablePoi,
  type ScheduledActivity,
  type SchedulingConfig,
  type TravelDurationSource,
  type TravelMode,
  type TripDayWeather,
  type UnscheduledPlace,
  type UnscheduledReason,
  type Weekday,
} from "@triply/shared";
import { isValidCoordinate } from "./geo.js";
import { isPrecipitationCode } from "./poiScoring.js";
import { mergeSchedulingConfig } from "./schedulingConfig.js";
import { isValidTimeZone, resolveLocalIso, weekdayForDate } from "./timeZone.js";

interface WeatherCondition {
  adverse: boolean;
  reasons: string[];
}

interface VisitResolution {
  minutes: number;
  source: DurationSource;
}

interface TravelResolution {
  minutes: number;
  source: TravelDurationSource;
  warning?: string;
}

const BREAKS: readonly { key: keyof SchedulingConfig["pace"]["balanced"]["breaks"]; title: string }[] = [
  { key: "lunch", title: "Lunch break" },
  { key: "coffee", title: "Coffee break" },
  { key: "dinner", title: "Dinner break" },
];

function weatherCondition(day: TripDayWeather, config: SchedulingConfig): WeatherCondition {
  const reasons: string[] = [];

  if (isPrecipitationCode(day.weatherCode)) {
    reasons.push("rain or precipitation is forecast");
  }

  if (day.temperatureMax >= config.weather.highTemperatureC) {
    reasons.push("high temperatures are forecast");
  }

  if (day.temperatureMax <= config.weather.lowTemperatureC) {
    reasons.push("cold weather is forecast");
  }

  return { adverse: reasons.length > 0, reasons };
}

function estimateVisitMinutes(category: string | undefined, config: SchedulingConfig): number {
  const estimate =
    (category ? config.durationEstimates[category] : undefined) ?? config.defaultDurationEstimate;

  return Math.round((estimate.minMinutes + estimate.maxMinutes) / 2);
}

function resolveVisit(poi: SchedulablePoi, config: SchedulingConfig): VisitResolution {
  const provided = poi.visitDurationMinutes;

  if (typeof provided === "number" && Number.isFinite(provided) && provided > 0) {
    return { minutes: Math.round(provided), source: "provided" };
  }

  return { minutes: estimateVisitMinutes(poi.category, config), source: "estimated" };
}

function resolveTravel(
  segment: RouteSegment,
  mode: TravelMode,
  config: SchedulingConfig,
): TravelResolution {
  const durationSeconds = segment.durationSeconds;

  if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    return { minutes: Math.round(durationSeconds / 60), source: "provider" };
  }

  const distance = segment.distanceMeters;
  const speed = config.modeSpeedMps[mode];

  if (typeof distance === "number" && Number.isFinite(distance) && distance >= 0 && speed > 0) {
    return { minutes: Math.round(distance / speed / 60), source: "approximation" };
  }

  return {
    minutes: config.unknownTravelFallbackMinutes,
    source: "unavailable",
    warning: "Travel time unavailable; using a configurable fallback estimate.",
  };
}

function windowsForDay(poi: SchedulablePoi, weekday: Weekday | null): OpeningWindow[] | null {
  const hours = poi.openingHours;

  if (!hours || !hours.weekly || weekday === null) {
    return null;
  }

  return hours.weekly[weekday] ?? null;
}

/**
 * Earliest local start at or after `cursor` where `duration` fits inside one of
 * the opening windows and before `dayEnd`. Returns null when it cannot fit.
 */
function findOpeningStart(
  windows: readonly OpeningWindow[],
  cursor: number,
  duration: number,
  dayEnd: number,
): number | null {
  let best: number | null = null;

  for (const window of windows) {
    const close =
      window.closeMinutes > window.openMinutes
        ? window.closeMinutes
        : window.closeMinutes + 24 * 60;
    const start = Math.max(cursor, window.openMinutes);

    if (start + duration <= close && start + duration <= dayEnd) {
      if (best === null || start < best) {
        best = start;
      }
    }
  }

  return best;
}

function resolveDate(input: DailySchedulingInput, dayIndex: number): string {
  const explicit = input.dates?.[dayIndex - 1];

  if (typeof explicit === "string" && isIsoDate(explicit)) {
    return explicit;
  }

  if (typeof input.startDate === "string" && isIsoDate(input.startDate)) {
    return addDays(input.startDate, dayIndex - 1);
  }

  return "";
}

function resolveWindow(
  input: DailySchedulingInput,
  config: SchedulingConfig,
  dayIndex: number,
  totalDays: number,
): { startMinutes: number; endMinutes: number } {
  const profile = config.pace[input.pace ?? config.defaultPace] ?? config.pace[config.defaultPace];
  let startMinutes = profile.startMinutes;
  let endMinutes = profile.endMinutes;

  if (input.arrivalTimeMinutes != null && dayIndex === 1) {
    startMinutes = Math.max(startMinutes, input.arrivalTimeMinutes);
  }

  if (input.departureTimeMinutes != null && dayIndex === totalDays) {
    endMinutes = Math.min(endMinutes, input.departureTimeMinutes);
  }

  const override = input.dayWindows?.find((window) => window.dayIndex === dayIndex);

  if (override?.startMinutes != null) {
    startMinutes = override.startMinutes;
  }

  if (override?.endMinutes != null) {
    endMinutes = override.endMinutes;
  }

  return { startMinutes, endMinutes };
}

export function buildDailySchedules<T extends SchedulablePoi = SchedulablePoi>(
  input: DailySchedulingInput<T>,
): DailySchedulingResult<T> {
  const config = mergeSchedulingConfig(input.config);
  const requestedZone = input.timeZone ?? null;
  const timeZone = isValidTimeZone(requestedZone) ? requestedZone : config.defaultTimeZone;
  const zoneWarning =
    requestedZone === null
      ? `Destination time zone unknown; treating times as ${timeZone}.`
      : requestedZone !== timeZone
        ? `Unknown time zone "${requestedZone}"; using ${timeZone}.`
        : null;

  const hasStart =
    input.start !== null &&
    input.start !== undefined &&
    isValidCoordinate(input.start.lat, input.start.lng);

  const weatherByDate = new Map<string, TripDayWeather>();

  for (const day of input.weather ?? []) {
    weatherByDate.set(day.date, day);
  }

  const weatherProvided = (input.weather?.length ?? 0) > 0;
  const totalDays = input.dayRoutes.length;
  const days: DailySchedule<T>[] = [];
  const unscheduledPlaces: UnscheduledPlace<T>[] = [];

  for (let position = 0; position < input.dayRoutes.length; position += 1) {
    const route = input.dayRoutes[position];
    const dayIndex = route.dayIndex;
    const date = resolveDate(input, dayIndex);
    const warnings: string[] = [];

    if (zoneWarning) {
      warnings.push(zoneWarning);
    }

    if (date === "") {
      warnings.push("Date unknown; schedule uses the day index only.");
    }

    const weatherDay = date ? weatherByDate.get(date) : undefined;

    if (weatherProvided && date && !weatherDay) {
      warnings.push(`Weather forecast unavailable for ${date}.`);
    }

    const condition = weatherDay ? weatherCondition(weatherDay, config) : null;
    const places = route.orderedPlaces as readonly T[];
    let firstInvalid = places.length;

    for (let index = 0; index < places.length; index += 1) {
      if (!isValidCoordinate(places[index].lat, places[index].lng)) {
        firstInvalid = index;
        break;
      }
    }

    const validPlaces = places.slice(0, firstInvalid);
    const invalidPlaces = places.slice(firstInvalid);

    for (const place of invalidPlaces) {
      unscheduledPlaces.push({
        place,
        dayIndex,
        reason: "invalid-location",
        detail: "Coordinates are not usable for scheduling.",
      });
    }

    const { startMinutes, endMinutes } = resolveWindow(input, config, dayIndex, totalDays);

    if (validPlaces.length === 0 || endMinutes <= startMinutes) {
      if (endMinutes <= startMinutes) {
        warnings.push("Daily time window is invalid; no activities scheduled.");
      }

      days.push({
        dayIndex,
        date,
        timeZone,
        activities: [],
        totalVisitMinutes: 0,
        totalTravelMinutes: 0,
        totalDistanceMeters: 0,
        partiallyEstimated: false,
        warnings,
      });

      continue;
    }

    const profile = config.pace[input.pace ?? config.defaultPace] ?? config.pace[config.defaultPace];
    const activities: ScheduledActivity[] = [];
    const addedBreaks = new Set<keyof SchedulingConfig["pace"]["balanced"]["breaks"]>();

    let cursor = startMinutes;
    let totalVisitMinutes = 0;
    let travelMinutes = 0;
    let totalDistanceMeters = 0;
    let travelKnown = true;
    let distanceKnown = true;
    let legs = 0;
    let partiallyEstimated = false;
    let unverifiedOpeningCount = 0;
    let stopped = false;

    const insertDueBreaks = (at: number): number => {
      let current = at;
      const rules = BREAKS.map((entry) => ({
        ...entry,
        rule: profile.breaks[entry.key] as BreakRule,
      })).sort((a, b) => a.rule.windowStartMinutes - b.rule.windowStartMinutes);

      for (const { key, title, rule } of rules) {
        if (!rule.enabled || addedBreaks.has(key)) {
          continue;
        }

        if (current < rule.windowStartMinutes || current > rule.windowEndMinutes) {
          continue;
        }

        if (current + rule.durationMinutes > endMinutes) {
          continue;
        }

        const breakStart = resolveLocalIso(date, current, timeZone);
        const breakEnd = resolveLocalIso(date, current + rule.durationMinutes, timeZone);

        activities.push({
          type: "break",
          startTime: breakStart.iso,
          endTime: breakEnd.iso,
          title,
          durationMinutes: rule.durationMinutes,
        });

        current += rule.durationMinutes;
        addedBreaks.add(key);
      }

      return current;
    };

    /**
     * Inserts a meal break *before* an activity that would otherwise swallow the
     * entire meal window. The activity is delayed until after the break, so the
     * break never overlaps the activity.
     */
    const insertCoveringBreak = (at: number, nextVisitMinutes: number): number => {
      let current = at;
      const rules = BREAKS.map((entry) => ({
        ...entry,
        rule: profile.breaks[entry.key] as BreakRule,
      })).sort((a, b) => a.rule.windowStartMinutes - b.rule.windowStartMinutes);

      for (const { key, title, rule } of rules) {
        if (!rule.enabled || addedBreaks.has(key)) {
          continue;
        }

        if (current > rule.windowStartMinutes) {
          continue;
        }

        if (current + nextVisitMinutes <= rule.windowEndMinutes) {
          continue;
        }

        if (rule.windowStartMinutes + rule.durationMinutes > endMinutes) {
          continue;
        }

        const start = Math.max(current, rule.windowStartMinutes);
        const breakStart = resolveLocalIso(date, start, timeZone);
        const breakEnd = resolveLocalIso(date, start + rule.durationMinutes, timeZone);

        activities.push({
          type: "break",
          startTime: breakStart.iso,
          endTime: breakEnd.iso,
          title,
          durationMinutes: rule.durationMinutes,
        });

        addedBreaks.add(key);
        current = start + rule.durationMinutes;
      }

      return current;
    };

    const commitTravel = (segment: RouteSegment, title: string, placeId: string | undefined): void => {
      const travel = resolveTravel(segment, input.travelMode, config);
      const travelStart = resolveLocalIso(date, cursor, timeZone);
      const travelEnd = resolveLocalIso(date, cursor + travel.minutes, timeZone);

      activities.push({
        type: "travel",
        startTime: travelStart.iso,
        endTime: travelEnd.iso,
        placeId,
        title,
        durationMinutes: travel.minutes,
        distanceMeters: segment.distanceMeters ?? null,
        travelDurationSource: travel.source,
        warnings: travel.warning ? [travel.warning] : undefined,
      });

      legs += 1;

      if (travel.source === "unavailable") {
        travelKnown = false;
        partiallyEstimated = true;
      } else {
        travelMinutes += travel.minutes;

        if (travel.source === "approximation") {
          partiallyEstimated = true;
        }
      }

      if (typeof segment.distanceMeters === "number" && Number.isFinite(segment.distanceMeters)) {
        totalDistanceMeters += segment.distanceMeters;
      } else {
        distanceKnown = false;
      }

      cursor += travel.minutes;
    };

    const dropTrailing = (from: number, reason: UnscheduledReason): void => {
      for (let index = from; index < validPlaces.length; index += 1) {
        unscheduledPlaces.push({
          place: validPlaces[index],
          dayIndex,
          reason,
          detail:
            reason === "opening-hours-conflict"
              ? "Opening hours prevent scheduling this attraction."
              : "The attraction does not fit inside the daily time window.",
        });
      }

      stopped = true;
    };

    const firstPlaceIndex = hasStart ? 1 : 0;

    for (let placeIndex = 0; placeIndex < validPlaces.length; placeIndex += 1) {
      const place = validPlaces[placeIndex];
      const stopIndex = firstPlaceIndex + placeIndex;
      const segment = stopIndex - 1 >= 0 ? route.segments[stopIndex - 1] : undefined;
      const visit = resolveVisit(place, config);

      cursor = insertDueBreaks(cursor);

      const travel = segment ? resolveTravel(segment, input.travelMode, config) : null;
      const anticipatedArrival = cursor + (travel?.minutes ?? 0);
      const weekday = date ? weekdayForDate(date) : null;
      const windows = windowsForDay(place, weekday);

      if (windows !== null) {
        if (windows.length === 0) {
          dropTrailing(placeIndex, "opening-hours-conflict");
          break;
        }

        const fit = findOpeningStart(windows, anticipatedArrival, visit.minutes, endMinutes);

        if (fit === null) {
          dropTrailing(placeIndex, "opening-hours-conflict");
          break;
        }
      } else {
        unverifiedOpeningCount += 1;
      }

      if (anticipatedArrival + visit.minutes > endMinutes) {
        dropTrailing(placeIndex, "insufficient-time");
        break;
      }

      if (segment) {
        commitTravel(segment, `To ${place.name}`, place.placeId);
      }

      cursor = insertCoveringBreak(cursor, visit.minutes);
      cursor = insertDueBreaks(cursor);

      let activityStart = cursor;

      if (windows !== null) {
        const refit = findOpeningStart(windows, cursor, visit.minutes, endMinutes);

        if (refit === null) {
          dropTrailing(placeIndex, "opening-hours-conflict");
          break;
        }

        activityStart = refit;
      }

      if (activityStart + visit.minutes > endMinutes) {
        dropTrailing(placeIndex, "insufficient-time");
        break;
      }

      const activityWarnings: string[] = [];
      let weatherAdjusted = false;

      if (condition?.adverse && place.environment === "outdoor") {
        weatherAdjusted = true;
        activityWarnings.push(
          `Outdoor activity may be affected: ${condition.reasons.join("; ")}.`,
        );
      }

      const activityStartIso = resolveLocalIso(date, activityStart, timeZone);
      const activityEndIso = resolveLocalIso(date, activityStart + visit.minutes, timeZone);

      if (activityStartIso.adjusted || activityEndIso.adjusted) {
        activityWarnings.push("Scheduled across a daylight saving time change.");
      }

      activities.push({
        type: "attraction",
        startTime: activityStartIso.iso,
        endTime: activityEndIso.iso,
        placeId: place.placeId,
        title: place.name,
        durationMinutes: visit.minutes,
        durationSource: visit.source,
        warnings: activityWarnings.length > 0 ? activityWarnings : undefined,
        weatherAdjusted: weatherAdjusted || undefined,
      });

      totalVisitMinutes += visit.minutes;
      cursor = activityStart + visit.minutes;
    }

    if (!stopped && hasStart && route.returnsToStart && route.segments.length > 0) {
      const segment = route.segments[route.segments.length - 1];
      const travel = resolveTravel(segment, input.travelMode, config);

      cursor = insertDueBreaks(cursor);

      if (cursor + travel.minutes <= endMinutes) {
        commitTravel(segment, "Return to start", undefined);
      } else {
        warnings.push("Return travel does not fit within the daily time window.");
      }
    }

    if (!stopped) {
      insertDueBreaks(cursor);
    }

    if (unverifiedOpeningCount > 0) {
      warnings.push(
        `Opening hours unverified for ${unverifiedOpeningCount} attraction(s). Schedule is tentative.`,
      );
    }

    days.push({
      dayIndex,
      date,
      timeZone,
      activities,
      totalVisitMinutes,
      totalTravelMinutes: legs === 0 ? 0 : travelKnown ? travelMinutes : null,
      totalDistanceMeters: legs === 0 ? 0 : distanceKnown ? totalDistanceMeters : null,
      partiallyEstimated,
      warnings,
    });
  }

  return { timeZone, days, unscheduledPlaces };
}
