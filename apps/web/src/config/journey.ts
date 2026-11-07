import type { ItineraryDay, ItineraryStop, SpendingTotal } from "@triply/shared";
import { formatMoney } from "../i18n/format";

export function validCoordinates(lat: unknown, lng: unknown): [number, number] | null {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

/** A normal anchor works without window.open/popup permissions; only a destination is sent. */
export function navigationUrl(stop: ItineraryStop | undefined): string | null {
  const point = validCoordinates(stop?.lat, stop?.lng);
  if (!point) return null;
  const params = new URLSearchParams({ api: "1", destination: point.join(",") });
  return `https://www.google.com/maps/dir/?${params}`;
}

export function destinationDate(timeZone: string, now = new Date()): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find(part => part.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch { return null; }
}

export function initialJourneyDay(days: readonly ItineraryDay[], timeZone: string, now = new Date()): number {
  const found = days.findIndex(day => day.date && day.date === (destinationDate(day.timeZone, now) ?? destinationDate(timeZone, now)));
  return Math.max(0, found);
}

/** Read authoritative Budget totals; never aggregate estimates as actual spending. */
export function actualSpending(totals: readonly SpendingTotal[], currency: string | null): string | null {
  const actual = totals.filter(total => total.actualMinor > 0);
  return actual.length ? actual.map(total => formatMoney(total.actualMinor, total.currency)).join(" · ") : currency ? formatMoney(0, currency) : null;
}

export function scheduledVisitStops(day: ItineraryDay) {
  return day.stops.filter(stop => day.activities.some(item => item.type === "attraction" &&
    (stop.itineraryItemId && item.itineraryItemId ? stop.itineraryItemId === item.itineraryItemId : stop.placeId && stop.placeId === item.placeId)));
}

export function journeyItems(day: ItineraryDay) {
  const scheduled = scheduledVisitStops(day);
  const used = new Set<number>();
  return day.activities.filter(item => item.type === "attraction").map(item => {
    // UUIDs are authoritative. Legacy stop carriers can be paired once in route order;
    // their activity UUID still supplies persistent identity, never the array position.
    const stopIndex = scheduled.findIndex((stop, index) => !used.has(index) && (stop.itineraryItemId && item.itineraryItemId
      ? stop.itineraryItemId === item.itineraryItemId : Boolean(item.placeId && stop.placeId === item.placeId)));
    if (stopIndex >= 0) used.add(stopIndex);
    return { item, stopIndex, stop: scheduled[stopIndex] };
  });
}
