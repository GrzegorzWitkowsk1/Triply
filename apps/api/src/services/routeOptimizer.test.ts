import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Coordinates,
  PoiCluster,
  TravelMode,
  TripAttraction,
} from "@triply/shared";
import type { RouteResult, RoutingProvider, TravelMatrix } from "../routing/types.js";
import { distanceMeters } from "./geo.js";
import { nearestNeighborOrder, optimizeClusterRoute, twoOpt } from "./routeOptimizer.js";
import { buildTripRouting } from "./routePlanning.js";

function poi(name: string, lat: number, lng: number, score?: number | null): TripAttraction {
  return { name, category: "attraction", lat, lng, score };
}

function cluster(pois: TripAttraction[], day = 1): PoiCluster<TripAttraction> {
  return {
    day,
    pois,
    center: null,
    medoid: pois[0] ?? null,
    count: pois.length,
    avgScore: 0,
    spreadMeters: 0,
  };
}

function matrixFrom(coords: readonly Coordinates[], speedMps = 1.4): TravelMatrix {
  const distancesMeters: number[][] = [];
  const durationsSeconds: number[][] = [];

  for (let i = 0; i < coords.length; i += 1) {
    distancesMeters.push([]);
    durationsSeconds.push([]);

    for (let j = 0; j < coords.length; j += 1) {
      const value =
        i === j
          ? 0
          : distanceMeters(coords[i].lat, coords[i].lng, coords[j].lat, coords[j].lng);

      distancesMeters[i].push(value);
      durationsSeconds[i].push(value / speedMps);
    }
  }

  return { distancesMeters, durationsSeconds };
}

function defaultRoute(coords: readonly Coordinates[]): RouteResult {
  return {
    distanceMeters: 0,
    durationSeconds: 0,
    geometry: { type: "LineString", coordinates: coords.map((point) => [point.lng, point.lat]) },
    legs: coords.slice(0, -1).map((_, index) => ({
      fromIndex: index,
      toIndex: index + 1,
      distanceMeters: 0,
      durationSeconds: 0,
    })),
  };
}

interface FakeProviderOptions {
  supportedModes?: TravelMode[];
  onMatrix?: (coords: readonly Coordinates[]) => TravelMatrix;
  onRoute?: (coords: readonly Coordinates[]) => RouteResult;
  failMatrix?: boolean;
}

function createFakeProvider(options: FakeProviderOptions = {}): RoutingProvider {
  const supported = options.supportedModes ?? ["walking", "driving"];

  return {
    name: "fake",
    supportedModes: supported,
    supportsMode: (mode: TravelMode) => supported.includes(mode),
    getTravelMatrix: vi.fn(async (coords: readonly Coordinates[]): Promise<TravelMatrix> => {
      if (options.failMatrix) {
        throw new Error("provider is down");
      }

      return (options.onMatrix ?? ((items) => matrixFrom(items)))(coords);
    }),
    getRoute: vi.fn(async (coords: readonly Coordinates[]): Promise<RouteResult> => {
      return (options.onRoute ?? defaultRoute)(coords);
    }),
  };
}

function matrixSpy(provider: RoutingProvider) {
  return provider.getTravelMatrix as unknown as ReturnType<typeof vi.fn>;
}

function routeSpy(provider: RoutingProvider) {
  return provider.getRoute as unknown as ReturnType<typeof vi.fn>;
}

function names(pois: readonly TripAttraction[]): string[] {
  return pois.map((item) => item.name);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nearestNeighborOrder", () => {
  const cost = [
    [0, 10, 20, 30],
    [10, 0, 5, 25],
    [20, 5, 0, 15],
    [30, 25, 15, 0],
  ];

  it("visits the nearest unvisited node each step", () => {
    expect(nearestNeighborOrder(cost, 0)).toEqual([0, 1, 2, 3]);
  });

  it("honours the requested start", () => {
    expect(nearestNeighborOrder(cost, 2)).toEqual([2, 1, 0, 3]);
  });
});

describe("twoOpt", () => {
  const square = [
    [0, 1, Math.SQRT2, 1],
    [1, 0, 1, Math.SQRT2],
    [Math.SQRT2, 1, 0, 1],
    [1, Math.SQRT2, 1, 0],
  ];

  it("removes a crossing from an open route", () => {
    const result = twoOpt([0, 2, 1, 3], square, { fixedStart: true });

    expect(result.improved).toBe(true);
    expect(result.order).toEqual([0, 1, 2, 3]);
  });

  it("leaves an already optimal route untouched", () => {
    const result = twoOpt([0, 1, 2, 3], square, { fixedStart: true });

    expect(result.improved).toBe(false);
    expect(result.order).toEqual([0, 1, 2, 3]);
  });
});

describe("optimizeClusterRoute", () => {
  const places = [
    poi("A", 41.39, 2.17, 90),
    poi("B", 41.4, 2.18, 80),
    poi("C", 41.405, 2.175, 70),
  ];

  it("preserves every place and its metadata while routing", async () => {
    const provider = createFakeProvider();

    const route = await optimizeClusterRoute(cluster(places), { mode: "walking", provider });

    expect(route.orderedPlaces).toHaveLength(3);
    expect([...names(route.orderedPlaces)].sort()).toEqual(["A", "B", "C"]);
    expect(route.orderedPlaces.every((place) => place.category === "attraction")).toBe(true);
    expect(route.segments).toHaveLength(2);
    expect(route.routingSource).toBe("provider");
    expect(route.travelMode).toBe("walking");
    expect(matrixSpy(provider)).toHaveBeenCalledTimes(1);
    expect(routeSpy(provider)).toHaveBeenCalledTimes(1);
  });

  it("is deterministic across runs", async () => {
    const provider = createFakeProvider();

    const first = await optimizeClusterRoute(cluster(places), { mode: "walking", provider });
    const second = await optimizeClusterRoute(cluster(places), { mode: "walking", provider });

    expect(first).toEqual(second);
  });

  it("supports an optional starting point without including it as a place", async () => {
    const provider = createFakeProvider();
    const start: Coordinates = { lat: 41.38, lng: 2.16 };

    const route = await optimizeClusterRoute(cluster(places), {
      mode: "walking",
      provider,
      start,
    });

    expect(route.orderedPlaces).toHaveLength(3);
    expect(names(route.orderedPlaces)).not.toContain("start");
    expect(route.segments).toHaveLength(3);
    expect(route.returnsToStart).toBe(false);
  });

  it("adds a closing segment when returning to start", async () => {
    const provider = createFakeProvider();
    const start: Coordinates = { lat: 41.38, lng: 2.16 };

    const route = await optimizeClusterRoute(cluster(places), {
      mode: "walking",
      provider,
      start,
      returnToStart: true,
    });

    expect(route.returnsToStart).toBe(true);
    expect(route.segments).toHaveLength(4);
    expect(matrixSpy(provider)).toHaveBeenCalledTimes(1);
  });

  it("skips routing for an empty cluster", async () => {
    const provider = createFakeProvider();

    const route = await optimizeClusterRoute(cluster([]), { mode: "walking", provider });

    expect(route.orderedPlaces).toEqual([]);
    expect(route.segments).toEqual([]);
    expect(route.totalDistanceMeters).toBe(0);
    expect(route.totalDurationSeconds).toBe(0);
    expect(route.routingSource).toBe("unavailable");
    expect(matrixSpy(provider)).not.toHaveBeenCalled();
    expect(routeSpy(provider)).not.toHaveBeenCalled();
  });

  it("skips routing for a single attraction", async () => {
    const provider = createFakeProvider();
    const only = poi("Only", 41.39, 2.17, 88);

    const route = await optimizeClusterRoute(cluster([only]), { mode: "walking", provider });

    expect(route.orderedPlaces).toEqual([only]);
    expect(route.segments).toEqual([]);
    expect(route.totalDistanceMeters).toBe(0);
    expect(route.routingSource).toBe("provider");
    expect(matrixSpy(provider)).not.toHaveBeenCalled();
    expect(routeSpy(provider)).not.toHaveBeenCalled();
  });

  it("falls back to Haversine approximation when the provider fails", async () => {
    const provider = createFakeProvider({ failMatrix: true });

    const route = await optimizeClusterRoute(cluster(places), { mode: "walking", provider });

    expect(route.routingSource).toBe("approximation");
    expect(route.geometry).toBeNull();
    expect(route.totalDistanceMeters).toBeGreaterThan(0);
    expect(route.totalDurationSeconds).toBeNull();
    expect(route.segments.every((segment) => segment.durationSeconds === null)).toBe(true);
  });

  it("approximates instead of substituting another mode when unsupported", async () => {
    const provider = createFakeProvider({ supportedModes: ["driving"] });

    const route = await optimizeClusterRoute(cluster(places), { mode: "walking", provider });

    expect(route.routingSource).toBe("approximation");
    expect(matrixSpy(provider)).not.toHaveBeenCalled();
    expect(routeSpy(provider)).not.toHaveBeenCalled();
  });

  it("keeps GeoJSON geometry from the provider", async () => {
    const provider = createFakeProvider({
      onRoute: () => ({
        distanceMeters: 42,
        durationSeconds: 7,
        geometry: {
          type: "LineString",
          coordinates: [
            [2.17, 41.39],
            [2.18, 41.4],
          ],
        },
        legs: [],
      }),
    });

    const route = await optimizeClusterRoute(cluster(places), { mode: "walking", provider });

    expect(route.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [2.17, 41.39],
        [2.18, 41.4],
      ],
    });
  });

  it("does not invent values for unreachable segments", async () => {
    const provider = createFakeProvider({
      onMatrix: () => ({
        durationsSeconds: [
          [0, 100, null],
          [100, 0, null],
          [null, null, 0],
        ],
        distancesMeters: [
          [0, null, null],
          [null, 0, null],
          [null, null, 0],
        ],
      }),
      onRoute: () => ({
        distanceMeters: null,
        durationSeconds: null,
        geometry: null,
        legs: [],
      }),
    });

    const route = await optimizeClusterRoute(cluster(places), { mode: "walking", provider });

    expect(route.routingSource).toBe("provider");
    expect(route.totalDurationSeconds).toBeNull();
    expect(route.totalDistanceMeters).toBeNull();
    expect(route.segments.some((segment) => segment.durationSeconds === null)).toBe(true);
  });

  it("handles identical coordinates deterministically", async () => {
    const provider = createFakeProvider();
    const same = [poi("A", 41.39, 2.17, 90), poi("B", 41.39, 2.17, 80)];

    const route = await optimizeClusterRoute(cluster(same), { mode: "walking", provider });

    expect(route.orderedPlaces).toHaveLength(2);
    expect(route.totalDistanceMeters).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(route.totalDistanceMeters)).toBe(false);
  });

  it("preserves invalid-coordinate places without routing them", async () => {
    const provider = createFakeProvider();
    const withInvalid = [poi("A", 41.39, 2.17, 90), poi("Broken", 999, 2.18, 80), poi("C", 41.4, 2.18, 70)];

    const route = await optimizeClusterRoute(cluster(withInvalid), { mode: "walking", provider });

    expect(route.orderedPlaces).toHaveLength(3);
    expect(names(route.orderedPlaces)).toContain("Broken");
    expect(matrixSpy(provider).mock.calls[0][0]).toHaveLength(2);
  });
});

describe("buildTripRouting", () => {
  it("aggregates routes across clusters", async () => {
    const provider = createFakeProvider();
    const clustering = {
      clusters: [cluster([poi("A", 41.39, 2.17, 90), poi("B", 41.4, 2.18, 80)], 1), cluster([], 2)],
    };

    const result = await buildTripRouting(clustering, { mode: "walking", provider });

    expect(result.mode).toBe("walking");
    expect(result.dayRoutes).toHaveLength(2);
    expect(result.dayRoutes[0].dayIndex).toBe(1);
    expect(result.dayRoutes[1].dayIndex).toBe(2);
    expect(result.source).toBe("provider");
  });

  it("uses approximation when no provider is configured", async () => {
    const clustering = {
      clusters: [cluster([poi("A", 41.39, 2.17, 90), poi("B", 41.4, 2.18, 80)], 1)],
    };

    const result = await buildTripRouting(clustering, { mode: "walking", provider: null });

    expect(result.source).toBe("approximation");
    expect(result.dayRoutes[0].routingSource).toBe("approximation");
  });
});
