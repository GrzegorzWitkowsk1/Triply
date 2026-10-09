import type { Weekday } from "@triply/shared";
import { WEEKDAY_VALUES } from "@triply/shared";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export interface LocalTimeResolution {
  /** Local ISO 8601 date-time without offset, e.g. `2026-06-01T10:00:00`. */
  iso: string;
  /** True when the requested wall-clock time did not exist and was shifted. */
  adjusted: boolean;
  /** Minutes the time was shifted forward (0 when the time existed). */
  skippedMinutes: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  formatterCache.set(timeZone, formatter);

  return formatter;
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    return false;
  }

  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(timeZone: string, instantMs: number): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function wallClockToUtcMs(clock: WallClock): number {
  return Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
}

/** Offset of the given zone at the instant, in minutes east of UTC. */
export function offsetMinutes(timeZone: string, instantMs: number): number {
  const clock = wallClock(timeZone, instantMs);

  return Math.round((wallClockToUtcMs(clock) - instantMs) / MS_PER_MINUTE);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function formatClock(clock: WallClock): string {
  return (
    `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}` +
    `T${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`
  );
}

function parseDate(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    return null;
  }

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Resolves a destination-local calendar date plus minutes-from-midnight into an
 * unambiguous local ISO string. Nonexistent wall-clock times (spring-forward
 * gaps) are shifted forward and reported.
 */
export function resolveLocalIso(
  date: string,
  minutes: number,
  timeZone: string,
): LocalTimeResolution {
  const parsed = parseDate(date);
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";

  if (!parsed) {
    return { iso: "", adjusted: false, skippedMinutes: 0 };
  }

  const naiveMs = Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0) + minutes * MS_PER_MINUTE;
  const offsetBefore = offsetMinutes(zone, naiveMs - MS_PER_DAY);
  const offsetAfter = offsetMinutes(zone, naiveMs + MS_PER_DAY);
  const offsets = offsetBefore === offsetAfter ? [offsetBefore] : [offsetBefore, offsetAfter];

  let forward: { instant: number; localMs: number } | null = null;
  let backward: { instant: number; localMs: number } | null = null;

  for (const offset of offsets) {
    const instant = naiveMs - offset * MS_PER_MINUTE;
    const localMs = wallClockToUtcMs(wallClock(zone, instant));

    if (localMs === naiveMs) {
      return { iso: formatClock(wallClock(zone, instant)), adjusted: false, skippedMinutes: 0 };
    }

    if (localMs > naiveMs && (forward === null || localMs < forward.localMs)) {
      forward = { instant, localMs };
    }

    if (localMs < naiveMs && (backward === null || localMs > backward.localMs)) {
      backward = { instant, localMs };
    }
  }

  const chosen = forward ?? backward;

  if (!chosen) {
    return { iso: "", adjusted: false, skippedMinutes: 0 };
  }

  return {
    iso: formatClock(wallClock(zone, chosen.instant)),
    adjusted: true,
    skippedMinutes: Math.round((chosen.localMs - naiveMs) / MS_PER_MINUTE),
  };
}

/** Weekday key for a local calendar date, independent of time zone. */
export function weekdayForDate(date: string): Weekday {
  const parsed = parseDate(date);

  if (!parsed) {
    return "mon";
  }

  const day = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();

  return WEEKDAY_VALUES[day] ?? "mon";
}
