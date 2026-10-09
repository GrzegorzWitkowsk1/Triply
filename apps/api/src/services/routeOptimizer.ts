import type {
  ClusterablePoi,
  Coordinates,
  GeoLineString,
  OptimizedDayRoute,
  PoiCluster,
  RouteSegment,
  RouteSource,
  TravelMode,
} from "@triply/shared";
import type { RouteLegValue, RoutingProvider, TravelMatrix } from "../routing/types.js";
import { distanceMeters, isValidCoordinate } from "./geo.js";

const DEFAULT_MAX_MATRIX_POINTS = 100;
const TWO_OPT_MAX_PASSES = 25;
const EPSILON = 1e-9;

type CostMatrix = (number | null)[][];

export interface OptimizeClusterOptions {
  mode: TravelMode;
  start?: Coordinates | null;
  returnToStart?: boolean;
  provider?: RoutingProvider | null;
  maxMatrixPoints?: number;
}

interface RouteNode<T extends ClusterablePoi> {
  coord: Coordinates;
  place: T | null;
  placeIndex: number;
}

function costAt(cost: CostMatrix, from: number, to: number): number {
  if (from === to) {
    return 0;
  }

  const value = cost[from]?.[to];

  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function normalizedScore(place: ClusterablePoi): number {
  if (typeof place.score !== "number" || !Number.isFinite(place.score)) {
    return 0;
  }

  return Math.min(100, Math.max(0, place.score));
}

function compareNodePreference<T extends ClusterablePoi>(
  a: RouteNode<T>,
  b: RouteNode<T>,
): number {
  const scoreA = a.place ? normalizedScore(a.place) : Number.NEGATIVE_INFINITY;
  const scoreB = b.place ? normalizedScore(b.place) : Number.NEGATIVE_INFINITY;

  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }

  const nameA = a.place?.name ?? "";
  const nameB = b.place?.name ?? "";

  if (nameA !== nameB) {
    return nameA < nameB ? -1 : 1;
  }

  return a.placeIndex - b.placeIndex;
}

export function nearestNeighborOrder(cost: CostMatrix, start: number): number[] {
  const count = cost.length;

  if (count === 0) {
    return [];
  }

  const visited = new Array<boolean>(count).fill(false);
  const order = [start];
  visited[start] = true;

  let current = start;

  for (let step = 1; step < count; step += 1) {
    let best = -1;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let candidate = 0; candidate < count; candidate += 1) {
      if (visited[candidate]) {
        continue;
      }

      const value = costAt(cost, current, candidate);

      if (best === -1 || value < bestCost) {
        bestCost = value;
        best = candidate;
      }
    }

    if (best === -1) {
      break;
    }

    order.push(best);
    visited[best] = true;
    current = best;
  }

  return order;
}

export interface TwoOptOptions {
  fixedStart?: boolean;
  returnToStart?: boolean;
}

export function twoOpt(
  order: readonly number[],
  cost: CostMatrix,
  options: TwoOptOptions = {},
): { order: number[]; improved: boolean } {
  const route = [...order];
  const count = route.length;

  if (count < 3) {
    return { order: route, improved: false };
  }

  const fixedStart = options.fixedStart ?? true;
  const returnToStart = options.returnToStart ?? false;
  const startBound = fixedStart ? 1 : 0;

  let improved = false;
  let passes = 0;

  while (passes < TWO_OPT_MAX_PASSES) {
    let changed = false;
    passes += 1;

    for (let i = startBound; i < count - 1; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = route[i - 1];
        const b = route[i];
        const c = route[j];
        const hasNext = j + 1 < count;
        const d = returnToStart ? route[(j + 1) % count] : hasNext ? route[j + 1] : null;

        const currentCost = costAt(cost, a, b) + (d === null ? 0 : costAt(cost, c, d));
        const candidateCost = costAt(cost, a, c) + (d === null ? 0 : costAt(cost, b, d));

        if (candidateCost < currentCost - EPSILON) {
          for (let left = i, right = j; left < right; left += 1, right -= 1) {
            const swap = route[left];
            route[left] = route[right];
            route[right] = swap;
          }

          changed = true;
          improved = true;
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  return { order: route, improved };
}

function haversineMatrix(coordinates: readonly Coordinates[]): number[][] {
  return coordinates.map((from) =>
    coordinates.map((to) => distanceMeters(from.lat, from.lng, to.lat, to.lng)),
  );
}

function hasFiniteOffDiagonal(matrix: (number | null)[][]): boolean {
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix.length; column += 1) {
      if (row === column) {
        continue;
      }

      const value = matrix[row]?.[column];

      if (typeof value === "number" && Number.isFinite(value)) {
        return true;
      }
    }
  }

  return false;
}

function costFromMatrix(matrix: TravelMatrix): CostMatrix | null {
  if (matrix.durationsSeconds.length > 0 && hasFiniteOffDiagonal(matrix.durationsSeconds)) {
    return matrix.durationsSeconds;
  }

  if (matrix.distancesMeters.length > 0 && hasFiniteOffDiagonal(matrix.distancesMeters)) {
    return matrix.distancesMeters;
  }

  return null;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export async function optimizeClusterRoute<T extends ClusterablePoi>(
  cluster: PoiCluster<T>,
  options: OptimizeClusterOptions,
): Promise<OptimizedDayRoute<T>> {
  const { mode } = options;
  const maxMatrixPoints = options.maxMatrixPoints ?? DEFAULT_MAX_MATRIX_POINTS;
  const places = cluster.pois;

  const validIndices: number[] = [];
  const invalidPlaces: T[] = [];

  places.forEach((place, index) => {
    if (isValidCoordinate(place.lat, place.lng)) {
      validIndices.push(index);
    } else {
      invalidPlaces.push(place);
    }
  });

  if (validIndices.length < 2) {
    return {
      dayIndex: cluster.day,
      orderedPlaces: [...places],
      segments: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      geometry: null,
      travelMode: mode,
      routingSource: places.length === 0 ? "unavailable" : "provider",
      returnsToStart: false,
    };
  }

  const start =
    options.start && isValidCoordinate(options.start.lat, options.start.lng) ? options.start : null;
  const returnToStart = Boolean(options.returnToStart) && start !== null;

  const nodes: RouteNode<T>[] = [];

  if (start) {
    nodes.push({ coord: start, place: null, placeIndex: -1 });
  }

  for (const index of validIndices) {
    const place = places[index];
    nodes.push({ coord: { lat: place.lat, lng: place.lng }, place, placeIndex: index });
  }

  const coordinates = nodes.map((node) => node.coord);
  const provider = options.provider ?? null;
  const providerUsable =
    provider !== null &&
    provider.supportsMode(mode) &&
    nodes.length <= maxMatrixPoints;

  let matrix: TravelMatrix | null = null;
  let source: RouteSource = "approximation";
  let cost: CostMatrix | null = null;

  if (providerUsable && provider) {
    try {
      matrix = await provider.getTravelMatrix(coordinates, mode);
      cost = costFromMatrix(matrix);

      if (cost) {
        source = "provider";
      } else {
        matrix = null;
      }
    } catch (error) {
      console.error(
        `[routing] travel matrix failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      matrix = null;
      cost = null;
    }
  }

  if (!cost) {
    cost = haversineMatrix(coordinates);
    source = "approximation";
  }

  const seed =
    start !== null
      ? 0
      : nodes.reduce((best, _node, index) => (compareNodePreference(nodes[index], nodes[best]) < 0 ? index : best), 0);

  const initialOrder = nearestNeighborOrder(cost, seed);
  const optimized = twoOpt(initialOrder, cost, { fixedStart: true, returnToStart }).order;

  const sequence = returnToStart ? [...optimized, seed] : optimized;

  let geometry: GeoLineString | null = null;
  let legs: RouteLegValue[] | null = null;

  if (source === "provider" && provider && sequence.length <= maxMatrixPoints) {
    try {
      const route = await provider.getRoute(sequence.map((index) => nodes[index].coord), mode);
      geometry = route.geometry;

      if (route.legs.length === sequence.length - 1) {
        legs = route.legs;
      }
    } catch (error) {
      console.error(
        `[routing] route geometry failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const segments: RouteSegment[] = [];

  for (let index = 0; index + 1 < sequence.length; index += 1) {
    const from = sequence[index];
    const to = sequence[index + 1];
    let distance: number | null = null;
    let duration: number | null = null;

    const leg = legs?.[index];

    if (leg) {
      distance = leg.distanceMeters;
      duration = leg.durationSeconds;
    } else if (matrix && source === "provider") {
      distance = matrix.distancesMeters[from]?.[to] ?? null;
      duration = matrix.durationsSeconds[from]?.[to] ?? null;
    } else {
      distance = distanceMeters(
        nodes[from].coord.lat,
        nodes[from].coord.lng,
        nodes[to].coord.lat,
        nodes[to].coord.lng,
      );
      duration = null;
    }

    segments.push({
      fromIndex: index,
      toIndex: index + 1,
      distanceMeters: distance,
      durationSeconds: duration,
      geometry: null,
    });
  }

  const distancesComplete = segments.every((segment) => segment.distanceMeters !== null);
  const durationsComplete = segments.every((segment) => segment.durationSeconds !== null);

  const totalDistanceMeters =
    segments.length === 0
      ? 0
      : distancesComplete
        ? sum(segments.map((segment) => segment.distanceMeters as number))
        : null;
  const totalDurationSeconds =
    segments.length === 0
      ? 0
      : durationsComplete
        ? sum(segments.map((segment) => segment.durationSeconds as number))
        : null;

  const orderedValid = optimized
    .map((index) => nodes[index].place)
    .filter((place): place is T => place !== null);

  return {
    dayIndex: cluster.day,
    orderedPlaces: [...orderedValid, ...invalidPlaces],
    segments,
    totalDistanceMeters,
    totalDurationSeconds,
    geometry,
    travelMode: mode,
    routingSource: source,
    returnsToStart: returnToStart,
  };
}
