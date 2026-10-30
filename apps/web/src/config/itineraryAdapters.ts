import { formatLocalTime } from "../i18n/format";
import i18n from "../i18n";
import type { ItineraryDay, ItineraryStop, TripItinerary, OpeningHoursCheck } from "@triply/shared";

export interface TimelineTravel {
  kind: "travel";
  key: string;
  minutes: number;
  toName: string;
  estimated?: boolean;
  unavailable?: boolean;
  mode?: import("@triply/shared").TravelMode;
  distanceMeters?: number | null;
}

export interface TimelineAttraction {
  attractionKey?: string;
  admission?: import("@triply/shared").AttractionAdmission | null;
  placeId?: string;
  kind: "attraction";
  key: string;
  stopIndex: number;
  time: string;
  endTime?: string;
  name: string;
  category: string;
  durationMinutes: number;
  openingHoursCheck?: OpeningHoursCheck;
}

export interface TimelineBreak {
  kind: "break";
  key: string;
  time: string;
  name: string;
  minutes: number;
  icon: "coffee" | "meal";
}

export type TimelineEntry = TimelineTravel | TimelineAttraction | TimelineBreak;

export function formatClock(iso: string): string {
  try { return formatLocalTime(iso); } catch { return iso; }
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) {
    return "—";
  }

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  const hourLabel = hours > 0 ? i18n.t("hours", { ns: "common", count: hours }) : "";
  const minLabel = mins > 0 ? i18n.t("minutes", { ns: "common", count: mins }) : "";

  return [hourLabel, minLabel].filter(Boolean).join(" ") || "—";
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

function breakIcon(title: string): "coffee" | "meal" {
  return /coffee|kawę/i.test(title) ? "coffee" : "meal";
}

/** Scheduled stops for a day, in route order — used for map markers. */
export function dayStops(day: ItineraryDay | undefined): [number, number][] {
  if (!day) {
    return [];
  }

  return scheduledStops(day).map((stop) => [stop.lat, stop.lng] as [number, number]);
}

function scheduledStops(day: ItineraryDay): ItineraryStop[] {
  const scheduled = new Set(
    day.activities
      .filter((activity) => activity.type === "attraction" && activity.placeId)
      .map((activity) => activity.placeId as string),
  );

  return day.stops.filter((stop) => stop.placeId !== null && scheduled.has(stop.placeId));
}

/** Turns a day's scheduled activities into an ordered timeline. */
export function buildDayTimeline(day: ItineraryDay): TimelineEntry[] {
  const stops = scheduledStops(day);
  const stopIndexByPlaceId = new Map(stops.map((stop, index) => [stop.placeId, index]));
  const stopByPlaceId = new Map(day.stops.map((stop) => [stop.placeId, stop]));

  return day.activities.map((activity, index) => {
    const key = `${day.dayIndex}-${index}`;

    if (activity.type === "travel") {
      return {
        kind: "travel",
        key,
        minutes: Math.round(activity.durationMinutes),
        toName: day.activities.slice(index + 1).find(next => next.type === "attraction")?.title ?? activity.title.replace(/^To\s+/i, ""),
        estimated: activity.travelDurationSource !== "provider",
        unavailable: activity.travelDurationSource === "unavailable",
        mode: day.travelMode,
        distanceMeters: activity.distanceMeters,
      } satisfies TimelineTravel;
    }

    if (activity.type === "attraction") {
      const stop = activity.placeId ? stopByPlaceId.get(activity.placeId) : undefined;
      const stopIndex = activity.placeId
        ? stopIndexByPlaceId.get(activity.placeId) ?? -1
        : -1;

      return {
        kind: "attraction",
        attractionKey: stop?.attractionKey,
        placeId: activity.placeId,
        key: activity.placeId ? `${day.dayIndex}:${activity.placeId}` : key,
        stopIndex,
        time: activity.schedulingStatus === "unresolved" ? i18n.t("unresolved", { ns: "itinerary/editor" }) : formatClock(activity.startTime),
        endTime: activity.schedulingStatus === "unresolved" || !activity.endTime ? undefined : formatClock(activity.endTime),
        name: activity.title,
        category: stop ? capitalize(stop.category) : i18n.t("sight", { ns: "itinerary/editor" }),
        durationMinutes: Math.round(activity.durationMinutes),
        openingHoursCheck: activity.openingHoursCheck,
        admission: stop?.admission,
      } satisfies TimelineAttraction;
    }

    return {
      kind: "break",
      key,
      time: formatClock(activity.startTime),
      name: activity.title,
      minutes: Math.round(activity.durationMinutes),
      icon: breakIcon(activity.title),
    } satisfies TimelineBreak;
  });
}

/** Route geometry for a day, converted from GeoJSON `[lng, lat]` to `[lat, lng]`. */
export function dayGeometry(day: ItineraryDay | undefined): [number, number][] | null {
  if (!day || !day.geometry || day.geometry.coordinates.length < 2) {
    return null;
  }

  return day.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
}

export function totalItineraryActivities(itinerary: TripItinerary): number {
  return itinerary.days.reduce(
    (sum, day) => sum + day.activities.filter((activity) => activity.type === "attraction").length,
    0,
  );
}

export function totalWalkingKm(itinerary: TripItinerary): number | null {
  const meters = itinerary.days.reduce<number | null>((sum, day) => {
    if (day.totalDistanceMeters === null) {
      return sum;
    }

    return (sum ?? 0) + day.totalDistanceMeters;
  }, null);

  if (meters === null || meters === 0) {
    return null;
  }

  return Math.round((meters / 1000) * 10) / 10;
}
