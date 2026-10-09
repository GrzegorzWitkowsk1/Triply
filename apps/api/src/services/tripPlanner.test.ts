import { describe, expect, it, vi } from "vitest";
import type { Coordinates, SchedulablePoi } from "@triply/shared";
import type { RouteResult, RoutingProvider, TravelMatrix } from "../routing/types.js";
import { distanceMeters } from "./geo.js";
import { planTrip } from "./tripPlanner.js";

function poi(name: string, lat: number, lng: number, score?: number): SchedulablePoi {
  return { name, category: "attraction", lat, lng, score };
}

const SPEED_MPS = 1.4;

function matrixFrom(coords: readonly Coordinates[]): TravelMatrix {
  const distancesMeters: number[][] = [];
  const durationsSeconds: number[][] = [];

  for (let from = 0; from < coords.length; from += 1) {
    distancesMeters.push([]);
    durationsSeconds.push([]);

    for (let to = 0; to < coords.length; to += 1) {
      const value =
        from === to ? 0 : distanceMeters(coords[from].lat, coords[from].lng, coords[to].lat, coords[to].lng);

      distancesMeters[from].push(value);
      durationsSeconds[from].push(value / SPEED_MPS);
    }
  }

  return { distancesMeters, durationsSeconds };
}

function routeFor(coords: readonly Coordinates[]): RouteResult {
  const legs = coords.slice(0, -1).map((point, index) => {
    const next = coords[index + 1];
    const distance = distanceMeters(point.lat, point.lng, next.lat, next.lng);

    return {
      fromIndex: index,
      toIndex: index + 1,
      distanceMeters: distance,
      durationSeconds: distance / SPEED_MPS,
    };
  });

  return {
    distanceMeters: legs.reduce((total, leg) => total + (leg.distanceMeters ?? 0), 0),
    durationSeconds: legs.reduce((total, leg) => total + (leg.durationSeconds ?? 0), 0),
    geometry: { type: "LineString", coordinates: coords.map((point) => [point.lng, point.lat]) },
    legs,
  };
}

function createFakeProvider(): RoutingProvider {
  return {
    name: "fake",
    supportedModes: ["walking", "driving"],
    supportsMode: (mode) => mode === "walking" || mode === "driving",
    getTravelMatrix: vi.fn(async (coords: readonly Coordinates[]) => matrixFrom(coords)),
    getRoute: vi.fn(async (coords: readonly Coordinates[]) => routeFor(coords)),
  };
}

function spread(count: number): SchedulablePoi[] {
  return Array.from({ length: count }, (_, index) =>
    poi(`P${index}`, 41.38 + index * 0.002, 2.16 + index * 0.002, 90 - index),
  );
}

describe("planTrip", () => {
  it("runs the full pipeline and returns one schedule per day", async () => {
    const provider = createFakeProvider();

    const result = await planTrip({
      pois: spread(6),
      durationDays: 2,
      pace: "balanced",
      startDate: "2026-06-01",
      timeZone: "Europe/Warsaw",
      routing: { mode: "walking", provider },
    });

    expect(result.days).toHaveLength(2);
    expect(result.clusters).toHaveLength(2);
    expect(result.routing.mode).toBe("walking");
    expect(result.days.every((day) => day.activities.length > 0)).toBe(true);

    const scheduledNames = new Set(
      result.days.flatMap((day) =>
        day.activities.filter((activity) => activity.type === "attraction").map((activity) => activity.title),
      ),
    );
    const unscheduledNames = new Set(result.unscheduledPlaces.map((entry) => entry.place.name));

    for (const name of scheduledNames) {
      expect(unscheduledNames.has(name)).toBe(false);
    }
  });

  it("preserves every POI across scheduled and unscheduled results", async () => {
    const provider = createFakeProvider();
    const pois = spread(5);

    const result = await planTrip({
      pois,
      durationDays: 2,
      pace: "packed",
      startDate: "2026-06-01",
      routing: { mode: "walking", provider },
    });

    const scheduled = result.days.flatMap((day) =>
      day.activities.filter((activity) => activity.type === "attraction").map((activity) => activity.title),
    );
    const unscheduled = result.unscheduledPlaces.map((entry) => entry.place.name);
    const combined = [...scheduled, ...unscheduled].sort();

    expect(combined).toEqual(pois.map((entry) => entry.name).sort());
  });

  it("surfaces clustering-unassigned places as unscheduled", async () => {
    const provider = createFakeProvider();
    const pois = [...spread(4), poi("", 41.42, 2.2, 40)];

    const result = await planTrip({
      pois,
      durationDays: 2,
      startDate: "2026-06-01",
      routing: { mode: "walking", provider },
    });

    expect(result.unscheduledPlaces.some((entry) => entry.reason === "unassigned-cluster")).toBe(true);
  });

  it("falls back to approximations when no provider is configured", async () => {
    const result = await planTrip({
      pois: spread(4),
      durationDays: 1,
      startDate: "2026-06-01",
      routing: { mode: "walking", provider: null },
    });

    expect(result.routing.source).toBe("approximation");
    expect(result.days[0].partiallyEstimated).toBe(true);
    expect(result.days[0].totalTravelMinutes).not.toBeNull();
  });

  it("is deterministic across runs", async () => {
    const run = () =>
      planTrip({
        pois: spread(6),
        durationDays: 3,
        pace: "balanced",
        startDate: "2026-06-01",
        timeZone: "Europe/Warsaw",
        routing: { mode: "walking", provider: createFakeProvider() },
      });

    const first = await run();
    const second = await run();

    expect(first).toEqual(second);
  });
});
