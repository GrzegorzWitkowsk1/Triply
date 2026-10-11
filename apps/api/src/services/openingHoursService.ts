import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { TZDate } from "@date-fns/tz";
import tzLookup from "tz-lookup";
import type OpeningHours from "opening_hours";
import { isIsoDate, type AttractionOpeningHours, type OpeningHoursCheck } from "@triply/shared";
import { isValidTimeZone, offsetMinutes } from "./timeZone.js";

const require = createRequire(import.meta.url);
const parserPath = require.resolve("opening_hours");
const parserRequire = createRequire(parserPath);
// The upstream parser creates Dates internally. Bind only its isolated realm's
// Date constructor, including clones and calendar arithmetic, to the POI zone.
// Never mutate process.env.TZ or the global Date used by concurrent requests.
const parserScript = new Script(readFileSync(parserPath, "utf8"), { filename: parserPath });
const constructors = new Map<string, typeof OpeningHours>();
function constructorFor(zone: string): typeof OpeningHours {
  const cached = constructors.get(zone);
  if (cached) return cached;
  const BoundDate = function (...args: unknown[]) {
    return Reflect.construct(TZDate, [...(args.length ? args : [Date.now()]), zone]);
  };
  Object.setPrototypeOf(BoundDate, Date);
  Object.defineProperty(BoundDate, Symbol.hasInstance, { value: (value: unknown) => value instanceof Date });
  const module = { exports: {} };
  parserScript.runInNewContext({ module, exports: module.exports, require: parserRequire, Date: BoundDate }, { timeout: 5000 });
  const constructor = module.exports as typeof OpeningHours;
  if (constructors.size >= 8) constructors.delete(constructors.keys().next().value!);
  constructors.set(zone, constructor);
  return constructor;
}

export function resolvePoiTimeZone(poi: { lat?: number; lng?: number }, fallback?: string | null): string | null {
  if (typeof poi.lat === "number" && typeof poi.lng === "number" && Number.isFinite(poi.lat) && Number.isFinite(poi.lng)
    && Math.abs(poi.lat) <= 90 && Math.abs(poi.lng) <= 180) {
    try { const zone = tzLookup(poi.lat, poi.lng); if (isValidTimeZone(zone)) return zone; } catch { /* Unknown below. */ }
  }
  return isValidTimeZone(fallback) ? fallback : null;
}

function localDate(date: string, minutes: number, zone: string): TZDate {
  const [year, month, day] = date.split("-").map(Number);
  return new TZDate(year, month - 1, day, 0, minutes, 0, zone);
}
function localIso(instant: Date, zone: string): string {
  return new TZDate(instant.getTime(), zone).toISOString().slice(0, 19);
}

export function visitEndLocalIso(date: string, minutes: number, duration: number, zone: string): string {
  return localIso(new Date(localDate(date, minutes, zone).getTime() + duration * 60000), zone);
}

export interface OpeningHoursInput {
  metadata?: AttractionOpeningHours | null;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  endMinutes?: number;
  timeZone?: string | null;
}

/** Evaluate the entire visit and derive alternatives only from known intervals. */
export function evaluateOpeningHours(input: OpeningHoursInput): OpeningHoursCheck {
  const { metadata, date, startMinutes, durationMinutes } = input;
  const zone = isValidTimeZone(input.timeZone) ? input.timeZone : null;
  const base = { source: metadata?.source ?? null, timeZone: zone, intervals: [], warnings: [] };
  const unknown = (reason: string): OpeningHoursCheck => ({ ...base, status: "unknown", reason, warnings: [reason] });
  if (!metadata?.raw) return unknown("Opening hours are not available.");
  if (metadata.raw.length > 10000) return unknown("Opening-hours expression exceeds the supported length.");
  if (!metadata.source) return unknown("Opening-hours source is unverified.");
  if (!zone) return unknown("Attraction time zone is unavailable.");
  if (!isIsoDate(date) || !Number.isFinite(startMinutes) || !Number.isFinite(durationMinutes) || durationMinutes <= 0)
    return unknown("Visit date or duration is unavailable.");
  // No regional holiday address is provided by current Overpass discovery.
  // This is a context guard, not an expression parser.
  if (/\b(?:PH|SH)\b/.test(metadata.raw)) return unknown("Regional holiday context is unavailable for these opening hours.");
  if (/\b(?:sunrise|sunset|dawn|dusk)\b/.test(metadata.raw)) return unknown("Solar opening-hours rules require additional location context.");
  try {
    const Parser = constructorFor(zone);
    const parser = new Parser(metadata.raw);
    const start = localDate(date, startMinutes, zone);
    const end = new TZDate(start.getTime() + durationMinutes * 60000, zone);
    const windowEnd = localDate(date, input.endMinutes ?? 1440, zone);
    // Use real elapsed visit duration across DST; nonexistent/ambiguous requested
    // wall times remain uncertain rather than silently choosing an instant.
    if (start.getHours() * 60 + start.getMinutes() !== ((startMinutes % 1440) + 1440) % 1440)
      return unknown("Visit starts at a nonexistent local time during a daylight saving change.");
    const offsetChange = Math.abs(offsetMinutes(zone, +start - 86400000) - offsetMinutes(zone, +start + 86400000)) * 60000;
    const earlier = new TZDate(start.getTime() - offsetChange, zone);
    const later = new TZDate(start.getTime() + offsetChange, zone);
    if (offsetChange && [earlier, later].some(other => localIso(other, zone) === localIso(start, zone)))
      return unknown("Visit starts at an ambiguous local time during a daylight saving change.");
    const dayEnd = localDate(date, 1440, zone);
    // Extend the query through tomorrow so an overnight visit is not clipped
    // at midnight. Exclude intervals beginning after the requested local day.
    const intervals = parser.getOpenIntervals(localDate(date, 0, zone), localDate(date, Math.max(2880, input.endMinutes ?? 1440), zone))
      .filter(([from]) => +from < +dayEnd);
    const warnings = parser.getWarnings();
    const fits = intervals.find(([from, to, uncertain]) => !uncertain && +from <= +start && +to >= +end);
    const uncertain = intervals.some(([from, to, maybe]) => maybe && +from < +end && +to > +start);
    const alternative = intervals.find(([from, to, maybe]) => !maybe && Math.max(+from, +start) + durationMinutes * 60000 <= Math.min(+to, +windowEnd));
    const result: OpeningHoursCheck = {
      ...base, intervals: intervals.map(([from, to, maybe]) => ({ start: localIso(from, zone), end: localIso(to, zone), unknown: maybe })),
      status: fits ? "open" : uncertain ? "unknown" : "closed",
      reason: fits ? "The full visit fits within known opening hours." : uncertain ? "Opening hours are uncertain for this visit." : intervals.length ? "The full visit does not fit within known opening hours." : "Closed on the selected date.",
      warnings,
    };
    if (alternative) result.nextAvailableStart = localIso(new Date(Math.max(+alternative[0], +start)), zone);
    if (result.status === "unknown") result.warnings.push(result.reason);
    return result;
  } catch {
    return unknown("Opening-hours expression could not be evaluated.");
  }
}
