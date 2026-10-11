import type { ItineraryDay } from "@triply/shared";
import type { TripDocument } from "../models/Trip.js";
import { evaluateOpeningHours, resolvePoiTimeZone } from "./openingHoursService.js";
import { resolveVisit } from "./scheduling.js";
import { mergeSchedulingConfig } from "./schedulingConfig.js";

export function resolveDay(days: ItineraryDay[], reference: string | null, previous: number | null, selected?: string, now = new Date()): ItineraryDay[] {
  if (!reference) return days.filter(day => day.dayIndex === (previous ?? Number(selected)));
  const ref = reference.trim().toLowerCase().replace(/^on\s+/, "");
  const ordinal = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"].findIndex(word => ref.includes(word));
  const number = ref.match(/^(?:day\s*)?(\d+)$/)?.[1];
  const ordinalNumber = ref.match(/^(?:the\s+)?(\d+)(?:st|nd|rd|th) day$/)?.[1];
  if (number || ordinalNumber || ordinal >= 0) return days.filter(day => day.dayIndex === (number || ordinalNumber ? Number(number ?? ordinalNumber) : ordinal + 1));
  if (/^(that day|it|the day|current day|the current day|selected day)$/.test(ref)) return days.filter(day => day.dayIndex === (/current|selected/.test(ref) ? Number(selected) : previous));
  if (ref === "tomorrow" || ref === "today") {
    const zone = days[0]?.timeZone || "UTC";
    const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const read = (type: string) => parts.find(part => part.type === type)?.value;
    const date = new Date(`${read("year")}-${read("month")}-${read("day")}T12:00:00Z`);
    if (ref === "tomorrow") date.setUTCDate(date.getUTCDate() + 1);
    return days.filter(day => day.date === date.toISOString().slice(0, 10));
  }
  return days.filter(day => day.date === ref || (day.date && new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`)).toLowerCase() === ref));
}

export function resolveAttraction(trip: TripDocument, reference: string | null, day: ItineraryDay | undefined, previous: string | null, candidates = false, openingHours = false) {
  const scheduled = (day ? [day] : trip.itinerary!.days).flatMap(d => d.activities.filter(a => a.type === "attraction").map(a => ({ id: a.placeId, name: a.title, dayIndex: d.dayIndex })));
  const pool = openingHours ? trip.attractions.map(a => ({ id: a.placeId, name: a.name, dayIndex: scheduled.find(p => p.id === a.placeId)?.dayIndex ?? 0 }))
    : candidates ? trip.attractions.filter(a => a.placeId && !trip.itinerary!.days.some(d => d.activities.some(activity => activity.placeId === a.placeId))).map(a => ({ id: a.placeId, name: a.name, dayIndex: 0 })) : scheduled;
  if (!reference) return [];
  const ref = reference.toLowerCase().trim().replace(/^the\s+/, "");
  const exact = pool.filter(a => a.name.toLowerCase() === ref || a.id === reference);
  if (exact.length) return exact;
  if (/^(that|this|it|place we discussed earlier)/.test(ref)) {
    const matches = pool.filter(a => a.id === previous);
    const noun = ref.match(/^(?:that|this) (museum|park|restaurant|cafe)$/)?.[1];
    return noun ? matches.filter(a => a.name.toLowerCase().includes(noun) || trip.attractions.some(p => p.placeId === a.id && p.category === (noun === "park" ? "nature" : /restaurant|cafe/.test(noun) ? "food" : "museum"))) : matches;
  }
  const ordinal = ref.match(/^(first|second|third|\d+)(?:st|nd|rd|th)? attraction$/);
  if (ordinal && day) { const index = ["first", "second", "third"].indexOf(ordinal[1]); return pool.slice(index >= 0 ? index : Number(ordinal[1]) - 1, index >= 0 ? index + 1 : Number(ordinal[1])); }
  const category = /^(restaurant|cafe|market|food)$/.test(ref) ? "food" : /^(park|nature)$/.test(ref) ? "nature" : ref;
  return pool.filter(a => a.name.toLowerCase().includes(ref) || trip.attractions.some(p => p.placeId === a.id && p.category.toLowerCase() === category));
}

export function buildAssistantContext(trip: TripDocument, selected?: string) {
  return { destination: trip.analysis.destination, dates: [trip.analysis.startDate, trip.analysis.endDate], travelers: trip.analysis.travelers,
    interests: trip.analysis.interests, pace: trip.analysis.pace, maxWalkingDistanceKm: trip.analysis.maxWalkingDistanceKm, budget: trip.analysis.budget, selectedDay: selected,
    days: trip.itinerary!.days.map(day => ({ dayIndex: day.dayIndex, date: day.date, count: day.activities.filter(a => a.type === "attraction").length })),
    openingHours: trip.itinerary!.days.flatMap(day => day.activities.filter(a => a.type === "attraction").map(activity => ({ day, activity }))).slice(0, 40).map(({ day, activity }) => {
      const poi = trip.attractions.find(place => place.placeId === activity.placeId);
      return { id: activity.placeId, name: activity.title, date: day.date,
        metadata: poi?.openingHours ? { raw: poi.openingHours.raw?.slice(0, 500), source: poi.openingHours.source, checkedAt: poi.openingHours.checkedAt } : null,
        availability: evaluateOpeningHours({ metadata: poi?.openingHours, date: day.date,
          startMinutes: Number(activity.startTime.slice(11, 13)) * 60 + Number(activity.startTime.slice(14, 16)),
          durationMinutes: activity.durationMinutes, timeZone: resolvePoiTimeZone(poi ?? {}, day.timeZone) }) };
    }),
    relevantDays: trip.itinerary!.days.filter(day => day.dayIndex === Number(selected)).slice(0,1).map(day => ({
      dayIndex: day.dayIndex, date: day.date, timeZone: day.timeZone,
      activities: day.activities.slice(0,40).map(activity => ({ id: activity.placeId, title: activity.title, type: activity.type, startTime: activity.startTime, endTime: activity.endTime })),
      attractions: day.stops.slice(0,40).map(stop => ({ id: stop.placeId, name: stop.name, category: stop.category,
        environment: trip.attractions.find(place => place.placeId === stop.placeId)?.environment ?? null })),
      routeDistanceMeters: day.totalDistanceMeters, travelMinutes: day.totalTravelMinutes, estimated: day.partiallyEstimated, warnings: day.warnings.slice(0,10),
    })),
  };
}

export function factualAnswer(trip: TripDocument, question: string, day?: ItineraryDay, attractionId?: string, message = ""): string {
  const days = day ? [day] : trip.itinerary!.days;
  const activities = days.flatMap(d => d.activities.filter(a => a.type === "attraction"));
  if (question === "opening_hours") {
    const clock = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(message);
    const config = mergeSchedulingConfig();
    const lines = days.flatMap(d => trip.attractions.filter(poi => !attractionId || poi.placeId === attractionId).map(poi => {
      const activity = d.activities.find(a => a.type === "attraction" && a.placeId === poi.placeId);
      const duration = activity?.durationMinutes ?? resolveVisit({ name: poi.name, lat: poi.lat, lng: poi.lng,
        category: poi.category, visitDurationMinutes: poi.visitDurationMinutes }, config).minutes;
      const startMinutes = clock ? Number(clock[1]) * 60 + Number(clock[2]) : activity ? Number(activity.startTime.slice(11, 13)) * 60 + Number(activity.startTime.slice(14, 16)) : 0;
      const input = { metadata: poi.openingHours, date: d.date, startMinutes, durationMinutes: duration, timeZone: resolvePoiTimeZone(poi, d.timeZone) };
      let result = evaluateOpeningHours(input);
      if (!clock && !activity && result.nextAvailableStart) {
        result = evaluateOpeningHours({ ...input, startMinutes: Number(result.nextAvailableStart.slice(11,13)) * 60 + Number(result.nextAvailableStart.slice(14,16)) });
      }
      const hours = result.intervals.map(interval => `${interval.start.slice(11,16)}–${interval.end.slice(11,16)}${interval.unknown ? " (uncertain)" : ""}`).join(", ");
      return { result, text: `${poi.name} (${d.date}, ${result.timeZone ?? "timezone unknown"}): ${result.status} for ${activity || clock ? "the" : "a possible"} ${duration}-minute visit. ${result.reason}${hours ? ` Hours: ${hours}.` : ""}${result.nextAvailableStart && result.status === "closed" ? ` Suggested start: ${result.nextAvailableStart}.` : ""} Source: ${result.source ?? "unavailable"}.` };
    }));
    const filtered = /unknown|unavailable/i.test(message) ? lines.filter(line => line.result.status === "unknown")
      : /which.*closed/i.test(message) ? lines.filter(line => line.result.status === "closed" && !line.result.nextAvailableStart && !line.result.intervals.some(interval => interval.unknown)) : lines;
    return filtered.map(line => line.text).join("\n") || "No matching attractions have that confirmed opening-hours status.";
  }
  if (question === "budget") return `Your planned budget is ${trip.analysis.budget.amount ?? "unknown"} ${trip.analysis.budget.currency ?? ""}. Expense data is unavailable, so I cannot calculate your remaining budget.`;
  if (question === "count") return `${activities.length} scheduled attractions across ${days.length} itinerary day(s).`;
  if (question === "walking") {
    const known = days.filter(d => d.totalDistanceMeters !== null);
    if (!known.length) return "Route distances are unavailable.";
    const top = [...known].sort((a,b) => b.totalDistanceMeters! - a.totalDistanceMeters!)[0];
    return `Day ${top.dayIndex} has the longest known route: ${(top.totalDistanceMeters! / 1000).toFixed(1)} km${top.partiallyEstimated ? " (estimated)" : ""}. ${known.length < days.length ? "Some days have unavailable distances." : ""} Route distance represents the configured travel mode; it is not necessarily all walking.`;
  }
  if (question === "busiest") { const top = [...days].sort((a,b) => b.totalVisitMinutes - a.totalVisitMinutes)[0]; return `Day ${top.dayIndex} has the most visiting time: ${top.totalVisitMinutes} minutes. Travel time: ${top.totalTravelMinutes ?? "unavailable"} minutes.`; }
  if (question === "duration") return `${days.reduce((sum,d) => sum + d.activities.reduce((total,a) => total + a.durationMinutes, 0), 0)} scheduled minutes including travel and breaks; ${days.reduce((sum,d) => sum + d.totalVisitMinutes, 0)} visiting minutes. Estimated durations are not verified visit times.`;
  if (question === "outdoors") { const names = activities.filter(a => trip.attractions.some(p => p.placeId === a.placeId && p.environment === "outdoor")).map(a => a.title); return `Known outdoor attractions: ${names.join(", ") || "none classified"}. Unclassified places may also be outdoors.`; }
  if (question === "why") { const place = trip.attractions.find(p => p.placeId === attractionId); return place ? `${place.name} is categorized as ${place.category}, with saved score ${place.score ?? "unavailable"}. Your interests are ${trip.analysis.interests.join(", ")}. The planner balances preferences, proximity and schedule fit; a specific selection explanation was not saved.` : "Which attraction do you mean?"; }
  if (question === "first" || question === "last") { const all = days.flatMap(d => d.activities); const activity = question === "first" ? all[0] : all.at(-1); return activity ? `${activity.title}: ${activity.startTime} to ${activity.endTime} (destination local time).` : "No activities are scheduled."; }
  return days.map(d => `Day ${d.dayIndex}${d.date ? ` (${d.date})` : ""}: ${d.activities.filter(a => a.type === "attraction").map(a => `${a.title}, ${a.startTime.slice(11,16)}–${a.endTime.slice(11,16)}`).join("; ") || "no attractions"}.`).join("\n");
}
