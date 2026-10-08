import type { ClusterablePoi, Pace, PoiCluster, PoiClusteringResult } from "@triply/shared";
import { distanceMeters, isValidCoordinate } from "./geo.js";

export const CLUSTERING_CONFIG = {
  minDays: 1,
  maxDays: 365,
  maxRefinementPasses: 8,
  moveSlackMeters: 400,
  moveTolerance: {
    relaxed: 1.25,
    balanced: 1.75,
    packed: 2.5,
  },
} as const;

export interface ClusterPoisOptions {
  days: number | null | undefined;
  pace?: Pace | null | undefined;
}

interface IndexedPoi<T extends ClusterablePoi> {
  poi: T;
  index: number;
  name: string;
  score: number;
  lat: number;
  lng: number;
}

interface Centroid {
  lat: number;
  lng: number;
}

export function normalizeDays(days: number | null | undefined): number {
  if (typeof days !== "number" || !Number.isFinite(days)) {
    return CLUSTERING_CONFIG.minDays;
  }

  const rounded = Math.round(days);

  return Math.min(CLUSTERING_CONFIG.maxDays, Math.max(CLUSTERING_CONFIG.minDays, rounded));
}

function normalizedScore(poi: ClusterablePoi): number {
  if (typeof poi.score !== "number" || !Number.isFinite(poi.score)) {
    return 0;
  }

  return Math.min(100, Math.max(0, poi.score));
}

function hasValidName(poi: ClusterablePoi): boolean {
  return typeof poi.name === "string" && poi.name.trim() !== "";
}

function moveTolerance(pace: Pace | null | undefined): number {
  const table = CLUSTERING_CONFIG.moveTolerance;

  if (pace !== null && pace !== undefined && pace in table) {
    return table[pace];
  }

  return table.balanced;
}

function compareByNameThenIndex<T extends ClusterablePoi>(
  a: IndexedPoi<T>,
  b: IndexedPoi<T>,
): number {
  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }

  return a.index - b.index;
}

function compareByScoreThenNameIndex<T extends ClusterablePoi>(
  a: IndexedPoi<T>,
  b: IndexedPoi<T>,
): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }

  return compareByNameThenIndex(a, b);
}

function globalCentroid<T extends ClusterablePoi>(items: readonly IndexedPoi<T>[]): Centroid | null {
  if (items.length === 0) {
    return null;
  }

  let lat = 0;
  let lng = 0;

  for (const item of items) {
    lat += item.lat;
    lng += item.lng;
  }

  return { lat: lat / items.length, lng: lng / items.length };
}

function distanceTo(a: IndexedPoi<ClusterablePoi> | Centroid, b: IndexedPoi<ClusterablePoi> | Centroid): number {
  return distanceMeters(a.lat, a.lng, b.lat, b.lng);
}

function pickSeeds<T extends ClusterablePoi>(
  items: readonly IndexedPoi<T>[],
  count: number,
): IndexedPoi<T>[] {
  const centroid = globalCentroid(items);
  const seeded = new Set<number>();
  const seeds: IndexedPoi<T>[] = [];

  const remaining = [...items];
  remaining.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }

    if (centroid) {
      const delta = distanceTo(a, centroid) - distanceTo(b, centroid);
      if (delta !== 0) {
        return delta;
      }
    }

    return compareByNameThenIndex(a, b);
  });

  seeds.push(remaining[0]);
  seeded.add(remaining[0].index);

  while (seeds.length < count) {
    let best: IndexedPoi<T> | null = null;
    let bestMin = -1;

    for (const item of items) {
      if (seeded.has(item.index)) {
        continue;
      }

      let min = Number.POSITIVE_INFINITY;

      for (const seed of seeds) {
        min = Math.min(min, distanceTo(item, seed));
      }

      if (best === null || min > bestMin) {
        best = item;
        bestMin = min;
        continue;
      }

      if (min === bestMin && compareByScoreThenNameIndex(item, best) < 0) {
        best = item;
      }
    }

    if (best === null) {
      break;
    }

    seeds.push(best);
    seeded.add(best.index);
  }

  return seeds;
}

function chooseMedoid<T extends ClusterablePoi>(
  cluster: readonly IndexedPoi<T>[],
  fallback: IndexedPoi<T>,
): IndexedPoi<T> {
  if (cluster.length === 0) {
    return fallback;
  }

  let best = cluster[0];
  let bestSum = Number.POSITIVE_INFINITY;

  for (const candidate of cluster) {
    let sum = 0;

    for (const other of cluster) {
      if (other.index !== candidate.index) {
        sum += distanceTo(candidate, other);
      }
    }

    if (sum < bestSum || (sum === bestSum && compareByScoreThenNameIndex(candidate, best) < 0)) {
      best = candidate;
      bestSum = sum;
    }
  }

  return best;
}

function assignPois<T extends ClusterablePoi>(
  items: readonly IndexedPoi<T>[],
  medoids: readonly IndexedPoi<T>[],
  tolerance: number,
): IndexedPoi<T>[][] {
  const capacity = Math.ceil(items.length / medoids.length);
  const clusters: IndexedPoi<T>[][] = medoids.map(() => []);

  const order = [...items].sort(compareByScoreThenNameIndex);

  for (const item of order) {
    const candidates = medoids
      .map((medoid, index) => ({ index, dist: distanceTo(item, medoid) }))
      .sort((a, b) => (a.dist !== b.dist ? a.dist - b.dist : a.index - b.index));

    const withRoom = candidates.find((candidate) => clusters[candidate.index].length < capacity);

    if (withRoom === undefined) {
      clusters[candidates[0].index].push(item);
      continue;
    }

    if (withRoom.index === candidates[0].index) {
      clusters[withRoom.index].push(item);
      continue;
    }

    const allowed = tolerance * candidates[0].dist + CLUSTERING_CONFIG.moveSlackMeters;
    const target = withRoom.dist <= allowed ? withRoom.index : candidates[0].index;
    clusters[target].push(item);
  }

  return clusters;
}

function sameMembers<T extends ClusterablePoi>(
  a: readonly (readonly IndexedPoi<T>[])[],
  b: readonly (readonly IndexedPoi<T>[])[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every(
    (cluster, index) =>
      cluster.length === b[index].length &&
      cluster.every((item, position) => item.index === b[index][position].index),
  );
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clusterPois<T extends ClusterablePoi>(
  pois: readonly T[],
  options: ClusterPoisOptions,
): PoiClusteringResult<T> {
  const days = normalizeDays(options.days);
  const tolerance = moveTolerance(options.pace);

  const items: IndexedPoi<T>[] = [];
  const unassigned: T[] = [];

  pois.forEach((poi, index) => {
    if (!hasValidName(poi) || !isValidCoordinate(poi.lat, poi.lng)) {
      unassigned.push(poi);
      return;
    }

    items.push({
      poi,
      index,
      name: poi.name,
      score: normalizedScore(poi),
      lat: poi.lat,
      lng: poi.lng,
    });
  });

  const seedCount = Math.min(days, items.length);
  let medoids: IndexedPoi<T>[] = seedCount > 0 ? pickSeeds(items, seedCount) : [];
  let members: IndexedPoi<T>[][] = medoids.length > 0 ? assignPois(items, medoids, tolerance) : [];

  for (let pass = 0; pass < CLUSTERING_CONFIG.maxRefinementPasses && medoids.length > 0; pass += 1) {
    const updatedMedoids = medoids.map((medoid, index) => chooseMedoid(members[index], medoid));
    const next = assignPois(items, updatedMedoids, tolerance);
    const changed = !sameMembers(members, next);

    medoids = updatedMedoids;
    members = next;

    if (!changed) {
      break;
    }
  }

  interface DraftCluster {
    slot: number;
    pois: T[];
    medoid: T | null;
    center: Centroid | null;
    avgScore: number;
    spreadMeters: number;
    topScore: number;
    medoidToCentroid: number;
  }

  const centroid = globalCentroid(items);
  const drafts: DraftCluster[] = [];

  for (let slot = 0; slot < days; slot += 1) {
    const cluster = members[slot] ?? [];

    if (cluster.length === 0) {
      drafts.push({
        slot,
        pois: [],
        medoid: null,
        center: null,
        avgScore: 0,
        spreadMeters: 0,
        topScore: -1,
        medoidToCentroid: Number.POSITIVE_INFINITY,
      });
      continue;
    }

    const ordered = [...cluster].sort((a, b) => a.index - b.index);
    let lat = 0;
    let lng = 0;
    let scoreSum = 0;
    let topScore = -1;

    for (const item of cluster) {
      lat += item.lat;
      lng += item.lng;
      scoreSum += item.score;
      topScore = Math.max(topScore, item.score);
    }

    const center: Centroid = { lat: lat / cluster.length, lng: lng / cluster.length };
    let spread = 0;

    for (const item of cluster) {
      spread = Math.max(spread, distanceTo(item, center));
    }

    const medoid = medoids[slot] ?? chooseMedoid(cluster, cluster[0]);
    const anchor = centroid ? distanceTo(medoid, centroid) : 0;

    drafts.push({
      slot,
      pois: ordered.map((item) => item.poi),
      medoid: medoid.poi,
      center,
      avgScore: roundToOneDecimal(scoreSum / cluster.length),
      spreadMeters: Math.round(spread),
      topScore,
      medoidToCentroid: anchor,
    });
  }

  const occupied = drafts.filter((draft) => draft.pois.length > 0);
  const empty = drafts.filter((draft) => draft.pois.length === 0);

  occupied.sort((a, b) => {
    if (a.topScore !== b.topScore) {
      return b.topScore - a.topScore;
    }

    if (a.medoidToCentroid !== b.medoidToCentroid) {
      return a.medoidToCentroid - b.medoidToCentroid;
    }

    if (a.medoid !== null && b.medoid !== null && a.medoid.name !== b.medoid.name) {
      return a.medoid.name < b.medoid.name ? -1 : 1;
    }

    return a.slot - b.slot;
  });

  const orderedDrafts = [...occupied, ...empty];

  const clusters: PoiCluster<T>[] = orderedDrafts.map((draft, position) => ({
    day: position + 1,
    pois: draft.pois,
    center: draft.center,
    medoid: draft.medoid,
    count: draft.pois.length,
    avgScore: draft.avgScore,
    spreadMeters: draft.spreadMeters,
  }));

  return {
    days,
    clusters,
    unassigned,
    assignedCount: items.length,
  };
}
