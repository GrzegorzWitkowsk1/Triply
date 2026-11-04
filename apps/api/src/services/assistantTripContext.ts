import { addDays, currencyPrecision, type AssistantMessage } from "@triply/shared";
import type { TripDocument } from "../models/Trip.js";
import { summarizeBudget } from "./budgetSummary.js";
import { evaluateOpeningHours, resolvePoiTimeZone } from "./openingHoursService.js";

export const ASSISTANT_CONTEXT_CHARACTERS = 28000;
const clip = (value: string | null | undefined, max = 350) => value ? value.slice(0, max) : null;
function validZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone; } catch { return null; }
}
export function localDate(now: Date, zone: string | null): string | null {
  if (!zone) return null;
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** No external calls. Only authorized, current persisted fields enter this projection. */
export function buildConversationContext(trip: TripDocument, input: {
  message: string; selectedDayId?: string; history: readonly AssistantMessage[];
  lastDay?: number | null; lastAttraction?: string | null; timeZone?: string; now?: Date;
}, limit = ASSISTANT_CONTEXT_CHARACTERS) {
  const days = trip.itinerary?.days ?? [];
  const zone = validZone(trip.itinerary?.timeZone) ?? validZone(days[0]?.timeZone);
  const today = localDate(input.now ?? new Date(), zone);
  const message = input.message.toLowerCase();
  const recent = input.history.filter(m => m.role === "user" && !m.failed).slice(-6).map(m => m.text).join(" ").toLowerCase();
  const dayMentions = (text: string) => [...text.matchAll(/(?:\bday|dzie[nń]|dnia)\s*(\d{1,3})\b/gi)].map(m => Number(m[1]));
  const explicitDays = dayMentions(message);
  const ordinals = [/first day|pierwsz(?:y|ego) (?:dzień|dnia)/, /second day|drugi(?:ego)? (?:dzień|dnia)/,
    /third day|trzeci(?:ego)? (?:dzień|dnia)/, /fourth day|czwart(?:y|ego) (?:dzień|dnia)/,
    /fifth day|piąt(?:y|ego) (?:dzień|dnia)/, /sixth day|szóst(?:y|ego) (?:dzień|dnia)/, /seventh day|siódm(?:y|ego) (?:dzień|dnia)/];
  const ordinal = ordinals.findIndex(pattern => pattern.test(message)) + 1;
  if (ordinal) explicitDays.push(ordinal);
  const requestedDates = [...message.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(match => match[0]);
  explicitDays.push(...days.filter(d => requestedDates.includes(d.date)).map(d => d.dayIndex));
  const selectedReference = /(?:selected|current) day|wybran(?:y|ego) (?:dzień|dnia)|bieżąc(?:y|ego) (?:dzień|dnia)/.test(message);
  const relative = /tomorrow|jutro/.test(message) ? today ? addDays(today, 1) : null : /\btoday\b|dzisiaj|\bdziś\b/.test(message) ? today : null;
  const relativeDay = relative ? days.find(d => d.date === relative)?.dayIndex : undefined;
  const named = trip.attractions.filter(p => message.includes(p.name.toLowerCase()) || (p.placeId && message.includes(p.placeId.toLowerCase())));
  const matchedDays = days.filter(d => d.activities.some(a => named.some(p => p.placeId === a.placeId))).map(d => d.dayIndex);
  const referent = explicitDays.at(-1) ?? relativeDay ?? matchedDays[0] ?? (selectedReference ? Number(input.selectedDayId) : undefined) ?? input.lastDay ?? dayMentions(recent).at(-1) ?? Number(input.selectedDayId);
  const priority = [...new Set([...explicitDays, ...(relativeDay ? [relativeDay] : []), ...matchedDays, referent, Number(input.selectedDayId), ...days.map(d => d.dayIndex)])];
  const financial = /cost|price|budget|money|spen|cheaper|expens|koszt|cen|budżet|pieni|wyda|taniej/.test(message + " " + recent.slice(-2000));
  const clock = message.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const meridiem = message.match(/\b(1[0-2]|[1-9])\s*(am|pm)\b/);
  const requestedMinutes = clock ? Number(clock[1]) * 60 + Number(clock[2]) : meridiem ? (Number(meridiem[1]) % 12 + (meridiem[2] === "pm" ? 12 : 0)) * 60 : null;
  const summary = financial ? summarizeBudget(trip.toObject()) : null;
  const context = {
    trip: { destination: clip(trip.analysis.destination, 200), startDate: trip.analysis.startDate ?? null,
      endDate: trip.analysis.endDate ?? null, durationDays: trip.analysis.durationDays ?? days.length,
      contentLocale: trip.contentLocale ?? "en", travelers: trip.analysis.travelers ?? null,
      interests: trip.analysis.interests.slice(0, 15), pace: trip.analysis.pace ?? null,
      maxWalkingDistanceKm: trip.analysis.maxWalkingDistanceKm ?? null },
    clock: { now: (input.now ?? new Date()).toISOString(), destinationTimeZone: zone, destinationToday: today,
      userTimeZone: validZone(input.timeZone), relativeDate: relative,
      relativeDatePolicy: "today/tomorrow refer to destination timezone; ask if missing or user means another timezone" },
    referents: { dayIndex: Number.isFinite(referent) ? referent : null, attractionId: named[0]?.placeId ?? input.lastAttraction ?? null, selectedDayId: input.selectedDayId ?? null },
    overview: days.map(d => ({ dayIndex: d.dayIndex, date: d.date ?? null, attractionCount: d.activities.filter(a => a.type === "attraction").length })),
    budget: summary ? { currency: summary.currency, totalBudgetMinor: summary.totalBudgetMinor,
      currencyPrecision: summary.currency ? currencyPrecision(summary.currency) : null,
      plannedSpendingMinor: summary.plannedSpendingMinor, actualSpendingMinor: summary.actualSpendingMinor,
      plannedRemainingMinor: summary.plannedRemainingMinor, actualRemainingMinor: summary.actualRemainingMinor,
      currencyTotals: summary.totals, unknownAdmissionPriceCount: summary.unknownAdmissionPriceCount,
      categories: summary.categories, allocations: summary.allocations, allocationCurrency: summary.allocationCurrency,
      comparisonAvailable: summary.comparisonAvailable,
      hasIncompletePricing: summary.hasIncompletePricing, warnings: summary.warnings.map(w => clip(w)),
      days: summary.days.filter(d => d.dayId === String(referent)), amountUnit: "integer minor units, currency precision applies" } : null,
    days: [] as { dayIndex: number; date: string | null; timeZone: string | null; weather: unknown; weatherFetchedAt: Date | null;
      route: unknown; warnings: (string | null)[]; activities: unknown[]; omittedActivities: number }[],
    coverage: { totalDays: days.length, omittedDayDetails: [] as number[], overviewOmitted: 0, descriptionsShortened: true },
  };
  // Preserve financial totals and referents; trim only overview when a legacy/large trip needs it.
  while (JSON.stringify(context).length > limit / 2 && context.overview.length > 1) { context.overview.pop(); context.coverage.overviewOmitted++; }
  for (const index of priority) {
    const day = days.find(d => d.dayIndex === index);
    if (!day) continue;
    const detail: (typeof context.days)[number] = { dayIndex: day.dayIndex, date: day.date ?? null, timeZone: validZone(day.timeZone) ?? zone,
      weather: trip.weather.find(w => w.date === day.date) ? (() => { const w = trip.weather.find(w => w.date === day.date)!; return { date: w.date, weatherCode: w.weatherCode, temperatureMax: w.temperatureMax }; })() : null,
      weatherFetchedAt: trip.weatherFetchedAt ?? null,
      route: { distanceMeters: day.totalDistanceMeters ?? null, travelMinutes: day.totalTravelMinutes ?? null,
        estimated: day.partiallyEstimated, source: trip.itinerary?.routingSource ?? null },
      warnings: day.warnings.slice(0, 10).map(w => clip(w)), activities: [], omittedActivities: day.activities.length };
    context.days.push(detail);
    for (const activity of day.activities) {
      const poi = trip.attractions.find(p => p.placeId && p.placeId === activity.placeId);
      const startClock = activity.startTime.match(/T([01]\d|2[0-3]):([0-5]\d)/);
      const startMinutes = startClock && activity.schedulingStatus !== "unresolved" ? Number(startClock[1]) * 60 + Number(startClock[2]) : null;
      detail.activities.push({ id: activity.placeId ?? null, title: clip(activity.title, 200), type: activity.type,
        startTime: activity.startTime, endTime: activity.endTime, durationMinutes: activity.durationMinutes,
        schedulingStatus: activity.schedulingStatus ?? null, durationSource: activity.durationSource ?? null,
        travelDurationSource: activity.travelDurationSource ?? null, distanceMeters: activity.distanceMeters ?? null,
        warnings: activity.warnings?.slice(0, 5).map(w => clip(w)) ?? [],
        description: clip(poi?.description), category: poi?.category ?? null, environment: poi?.environment ?? null,
        admission: poi?.admission ? JSON.parse(JSON.stringify(poi.admission)) as unknown : null,
        openingHours: poi?.openingHours ? { raw: clip(poi.openingHours.raw, 500), source: poi.openingHours.source, checkedAt: poi.openingHours.checkedAt } : null,
        requestedVisit: poi?.openingHours && day.date && requestedMinutes !== null ? { startMinutes: requestedMinutes, durationMinutes: activity.durationMinutes,
          availability: evaluateOpeningHours({ metadata: poi.openingHours, date: day.date, startMinutes: requestedMinutes, durationMinutes: activity.durationMinutes, timeZone: resolvePoiTimeZone(poi, day.timeZone) }) } : null,
        availability: poi?.openingHours && day.date && startMinutes !== null ? evaluateOpeningHours({ metadata: poi.openingHours, date: day.date,
          startMinutes, durationMinutes: activity.durationMinutes, timeZone: resolvePoiTimeZone(poi, day.timeZone) }) : null });
      detail.omittedActivities--;
      if (JSON.stringify(context).length > limit - 1500) { detail.activities.pop(); detail.omittedActivities++; break; }
    }
    if (JSON.stringify(context).length > limit - 1500) { context.days.pop(); break; }
  }
  context.days.sort((a, b) => a.dayIndex - b.dayIndex);
  context.coverage.omittedDayDetails = days.filter(d => !context.days.some(detail => detail.dayIndex === d.dayIndex)).map(d => d.dayIndex);
  if (JSON.stringify(context).length > limit) throw new RangeError("Assistant context budget exceeded");
  return context;
}
