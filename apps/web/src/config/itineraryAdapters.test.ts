import { describe, expect, it } from "vitest";
import type { ItineraryDay, TripItinerary } from "@triply/shared";
import {
  buildDayTimeline,
  dayGeometry,
  dayStops,
  totalItineraryActivities,
  totalWalkingKm,
} from "./itineraryAdapters";

function makeDay(): ItineraryDay {
  return {
    dayIndex: 0,
    date: "2026-06-01",
    timeZone: "Europe/Paris",
    activities: [
      {
        type: "attraction",
        startTime: "2026-06-01T09:00:00",
        endTime: "2026-06-01T10:00:00",
        placeId: "node/1",
        title: "Museum",
        durationMinutes: 60,
      },
      {
        type: "travel",
        startTime: "2026-06-01T10:00:00",
        endTime: "2026-06-01T10:15:00",
        title: "To Park",
        durationMinutes: 15,
      },
      {
        type: "attraction",
        startTime: "2026-06-01T10:15:00",
        endTime: "2026-06-01T11:15:00",
        placeId: "node/2",
        title: "Park",
        durationMinutes: 60,
      },
      {
        type: "break",
        startTime: "2026-06-01T11:15:00",
        endTime: "2026-06-01T11:45:00",
        title: "Coffee break",
        durationMinutes: 30,
      },
    ],
    stops: [
      { placeId: "node/1", name: "Museum", category: "museum", lat: 48.86, lng: 2.34, score: 80 },
      { placeId: "node/2", name: "Park", category: "park", lat: 48.87, lng: 2.35, score: 70 },
      { placeId: "node/3", name: "Dropped", category: "culture", lat: 48.88, lng: 2.36, score: 50 },
    ],
    geometry: {
      type: "LineString",
      coordinates: [
        [2.34, 48.86],
        [2.35, 48.87],
      ],
    },
    segments: [],
    totalVisitMinutes: 120,
    totalTravelMinutes: 15,
    totalDistanceMeters: 1500,
    partiallyEstimated: false,
    warnings: [],
  };
}

function makeItinerary(): TripItinerary {
  return {
    timeZone: "Europe/Paris",
    routingSource: "approximation",
    generatedAt: "2026-06-01T08:00:00.000Z",
    days: [makeDay()],
    unscheduled: [],
  };
}

describe("buildDayTimeline", () => {
  it("maps scheduled activities to ordered timeline entries", () => {
    const entries = buildDayTimeline(makeDay());

    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      kind: "attraction",
      time: "09:00",
      name: "Museum",
      category: "Museum",
      durationMinutes: 60,
      stopIndex: 0,
    });
    expect(entries[1]).toMatchObject({ kind: "travel", minutes: 15, toName: "Park" });
    expect(entries[2]).toMatchObject({ kind: "attraction", stopIndex: 1, category: "Park" });
    expect(entries[3]).toMatchObject({
      kind: "break",
      time: "11:15",
      name: "Coffee break",
      minutes: 30,
      icon: "coffee",
    });
  });

  it("classifies meal breaks and falls back to Sight with no stop", () => {
    const day = makeDay();
    day.activities[3] = {
      type: "break",
      startTime: "2026-06-01T11:15:00",
      endTime: "2026-06-01T11:45:00",
      title: "Lunch break",
      durationMinutes: 45,
    };
    day.stops = [];

    const entries = buildDayTimeline(day);

    expect(entries[3]).toMatchObject({ kind: "break", icon: "meal", minutes: 45 });
    expect(entries[0]).toMatchObject({ kind: "attraction", category: "Sight", stopIndex: -1 });
  });
});

describe("dayStops", () => {
  it("returns only scheduled stops as Leaflet [lat, lng] pairs", () => {
    expect(dayStops(makeDay())).toEqual([
      [48.86, 2.34],
      [48.87, 2.35],
    ]);
    expect(dayStops(undefined)).toEqual([]);
  });
});

describe("dayGeometry", () => {
  it("converts GeoJSON [lng, lat] to [lat, lng]", () => {
    expect(dayGeometry(makeDay())).toEqual([
      [48.86, 2.34],
      [48.87, 2.35],
    ]);
  });

  it("returns null for missing or single-point geometry", () => {
    const day = makeDay();
    day.geometry = { type: "LineString", coordinates: [[2.34, 48.86]] };

    expect(dayGeometry(day)).toBeNull();
    expect(dayGeometry(undefined)).toBeNull();
  });
});

describe("totals", () => {
  it("counts attraction activities and walking distance", () => {
    const itinerary = makeItinerary();

    expect(totalItineraryActivities(itinerary)).toBe(2);
    expect(totalWalkingKm(itinerary)).toBe(1.5);
  });

  it("returns null walking distance when unknown", () => {
    const itinerary = makeItinerary();
    itinerary.days[0]!.totalDistanceMeters = null;

    expect(totalWalkingKm(itinerary)).toBeNull();
  });
});
