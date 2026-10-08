import { describe, expect, it } from "vitest";
import type { ClusterablePoi, PoiClusteringResult, TripAttraction } from "@triply/shared";
import { distanceMeters } from "./geo.js";
import { clusterPois, normalizeDays } from "./poiClustering.js";

type ClusterResult = PoiClusteringResult<TripAttraction>;

function poi(name: string, lat: number, lng: number, score?: number | null): TripAttraction {
  return { name, category: "attraction", lat, lng, score };
}

function names(trip: TripAttraction): string {
  return trip.name;
}

function clusterNames(result: ClusterResult): string[][] {
  return result.clusters.map((cluster) => cluster.pois.map(names));
}

function counts(result: ClusterResult): number[] {
  return result.clusters.map((cluster) => cluster.count);
}

function twoBlobs(): TripAttraction[] {
  return [
    poi("A1", 41.39, 2.17, 95),
    poi("A2", 41.391, 2.17, 90),
    poi("A3", 41.39, 2.171, 85),
    poi("B1", 41.45, 2.17, 80),
    poi("B2", 41.451, 2.17, 75),
    poi("B3", 41.45, 2.171, 70),
  ];
}

function twelveAttractions(): TripAttraction[] {
  return [
    poi("Gothic1", 41.383, 2.176, 96),
    poi("Eixample1", 41.393, 2.164, 94),
    poi("Beach1", 41.376, 2.19, 92),
    poi("Gothic2", 41.3834, 2.176, 90),
    poi("Eixample2", 41.3934, 2.164, 88),
    poi("Beach2", 41.3764, 2.19, 86),
    poi("Gothic3", 41.383, 2.1765, 84),
    poi("Eixample3", 41.393, 2.1645, 82),
    poi("Beach3", 41.376, 2.1905, 80),
    poi("Gothic4", 41.3836, 2.1764, 78),
    poi("Eixample4", 41.3936, 2.1644, 76),
    poi("Beach4", 41.3766, 2.1904, 74),
  ];
}

describe("clusterPois", () => {
  it("groups nearby attractions together", () => {
    const result = clusterPois(twoBlobs(), { days: 2 });

    expect(clusterNames(result)).toEqual([
      ["A1", "A2", "A3"],
      ["B1", "B2", "B3"],
    ]);
    expect(result.assignedCount).toBe(6);
    expect(result.unassigned).toEqual([]);
  });

  it("keeps a tight group together over equal sizes when one POI is far away", () => {
    const tight = [
      poi("T1", 41.39, 2.17, 95),
      poi("T2", 41.3905, 2.17, 90),
      poi("T3", 41.39, 2.1705, 85),
    ];
    const distant = poi("D1", 41.44, 2.17, 70);
    const result = clusterPois([...tight, distant], { days: 2 });

    expect(counts(result)).toEqual([3, 1]);
    expect(result.clusters[1].pois).toEqual([distant]);
    expect(clusterNames(result)[0]).toEqual(["T1", "T2", "T3"]);
  });

  it("respects the requested number of days", () => {
    const attractions = twoBlobs();

    const oneDay = clusterPois(attractions, { days: 1 });
    expect(oneDay.days).toBe(1);
    expect(counts(oneDay)).toEqual([6]);

    const twoDays = clusterPois(attractions, { days: 2 });
    expect(twoDays.days).toBe(2);
    expect(counts(twoDays)).toEqual([3, 3]);

    const threeDays = clusterPois(attractions, { days: 3 });
    expect(threeDays.days).toBe(3);
    expect(threeDays.clusters).toHaveLength(3);
    expect(counts(threeDays).reduce((sum, value) => sum + value, 0)).toBe(6);
    expect(threeDays.clusters.every((cluster) => cluster.count >= 1)).toBe(true);
  });

  it("is deterministic across runs", () => {
    const first = clusterPois(twelveAttractions(), { days: 3, pace: "balanced" });
    const second = clusterPois(twelveAttractions(), { days: 3, pace: "balanced" });

    expect(first).toEqual(second);
  });

  it("balances a uniform grid across days", () => {
    const grid: TripAttraction[] = [];
    const rows = [41.39, 41.394, 41.398];
    const columns = [2.17, 2.174, 2.178, 2.182];
    let score = 100;

    for (const lat of rows) {
      for (const lng of columns) {
        grid.push(poi(`G${score}`, lat, lng, score));
        score -= 1;
      }
    }

    const result = clusterPois(grid, { days: 3 });

    expect(counts(result).sort((a, b) => a - b)).toEqual([4, 4, 4]);
  });

  it("produces three coherent day groups for twelve attractions", () => {
    const result = clusterPois(twelveAttractions(), { days: 3 });

    expect(counts(result)).toEqual([4, 4, 4]);

    for (const cluster of result.clusters) {
      const prefixes = new Set(cluster.pois.map((trip) => trip.name.replace(/\d+$/, "")));
      expect(prefixes.size).toBe(1);
    }

    expect(clusterNames(result)[0]).toEqual(["Gothic1", "Gothic2", "Gothic3", "Gothic4"]);
  });

  it("handles an empty input", () => {
    const result = clusterPois([], { days: 3 });

    expect(result.days).toBe(3);
    expect(result.clusters).toHaveLength(3);
    expect(result.clusters.every((cluster) => cluster.count === 0)).toBe(true);
    expect(result.unassigned).toEqual([]);
    expect(result.assignedCount).toBe(0);
  });

  it("handles a single attraction with more days than attractions", () => {
    const solo = poi("Solo", 41.39, 2.17, 88);
    const result = clusterPois([solo], { days: 3 });

    expect(counts(result)).toEqual([1, 0, 0]);
    expect(result.clusters[0].pois).toEqual([solo]);
    expect(result.clusters[0].medoid).toBe(solo);
    expect(result.clusters[0].center).toEqual({ lat: 41.39, lng: 2.17 });
    expect(result.clusters[1].medoid).toBeNull();
    expect(result.clusters[1].center).toBeNull();
  });

  it("gives every attraction its own day when days exceed attractions", () => {
    const result = clusterPois(twoBlobs().slice(0, 4), { days: 6 });

    expect(result.days).toBe(6);
    expect(counts(result)).toEqual([1, 1, 1, 1, 0, 0]);
    expect(result.assignedCount).toBe(4);
    expect(result.unassigned).toEqual([]);
  });

  it("handles identical coordinates deterministically", () => {
    const same = [95, 90, 85, 80, 75].map((score, index) =>
      poi(`S${index + 1}`, 41.4, 2.17, score),
    );

    const result = clusterPois(same, { days: 2 });

    expect(counts(result)).toEqual([3, 2]);
    expect(result.assignedCount).toBe(5);
    expect(result.unassigned).toEqual([]);
    expect(result.clusters[0].spreadMeters).toBe(0);
    expect(result).toEqual(clusterPois(same, { days: 2 }));
  });

  it("excludes invalid attractions into unassigned without losing them", () => {
    const validOne = poi("Valid One", 41.39, 2.17, 90);
    const nanLat = poi("NaN Lat", Number.NaN, 2.17, 80);
    const farLng = poi("Far LNG", 41.39, 999, 70);
    const nullIsland = poi("Null Island", 0, 0, 60);
    const infiniteLat = poi("Infinite Lat", Infinity, 2.17, 55);
    const blankName = poi("   ", 41.391, 2.17, 50);
    const validTwo = poi("Valid Two", 41.45, 2.17, 85);

    const result = clusterPois(
      [validOne, nanLat, farLng, nullIsland, infiniteLat, blankName, validTwo],
      { days: 2 },
    );

    expect(result.unassigned).toHaveLength(5);
    expect(result.unassigned[0]).toBe(nanLat);
    expect(result.unassigned[1]).toBe(farLng);
    expect(result.unassigned[2]).toBe(nullIsland);
    expect(result.unassigned[3]).toBe(infiniteLat);
    expect(result.unassigned[4]).toBe(blankName);
    expect(result.assignedCount).toBe(2);
    expect(counts(result)).toEqual([1, 1]);
  });

  it("clamps and defaults invalid scores without dropping attractions", () => {
    const attractions: TripAttraction[] = [
      poi("over", 41.39, 2.17, 150),
      poi("under", 41.392, 2.17, -10),
      poi("nan", 41.394, 2.17, Number.NaN),
      poi("null", 41.396, 2.17, null),
      poi("missing", 41.398, 2.17),
      poi("normal", 41.4, 2.17, 50),
    ];

    const result = clusterPois(attractions, { days: 6 });

    expect(result.assignedCount).toBe(6);
    expect(result.unassigned).toEqual([]);

    const averageFor = (name: string): number | undefined =>
      result.clusters.find((cluster) => cluster.pois[0]?.name === name)?.avgScore;

    expect(averageFor("over")).toBe(100);
    expect(averageFor("under")).toBe(0);
    expect(averageFor("nan")).toBe(0);
    expect(averageFor("null")).toBe(0);
    expect(averageFor("missing")).toBe(0);
    expect(averageFor("normal")).toBe(50);
  });

  it("normalizes invalid travel days", () => {
    expect(normalizeDays(0)).toBe(1);
    expect(normalizeDays(-3)).toBe(1);
    expect(normalizeDays(Number.NaN)).toBe(1);
    expect(normalizeDays(null)).toBe(1);
    expect(normalizeDays(undefined)).toBe(1);
    expect(normalizeDays(2.7)).toBe(3);
    expect(normalizeDays(400)).toBe(365);

    const fallback = clusterPois(twoBlobs(), { days: Number.NaN });
    expect(fallback.days).toBe(1);
    expect(fallback.clusters).toHaveLength(1);
    expect(fallback.clusters[0].count).toBe(6);
  });

  it("lets pace drive the tradeoff between balance and compactness", () => {
    const attractions: TripAttraction[] = [
      poi("X1", 41.4, 2.17, 95),
      poi("X2", 41.401, 2.17, 90),
      poi("X3", 41.4, 2.171, 85),
      poi("Bridge", 41.4, 2.182, 80),
      poi("Y1", 41.4, 2.206, 75),
    ];

    const relaxed = clusterPois(attractions, { days: 2, pace: "relaxed" });
    const packed = clusterPois(attractions, { days: 2, pace: "packed" });
    const balanced = clusterPois(attractions, { days: 2, pace: "balanced" });
    const defaultPace = clusterPois(attractions, { days: 2 });

    const clusterWith = (result: ClusterResult, name: string) =>
      result.clusters.find((cluster) => cluster.pois.some((trip) => trip.name === name));

    expect(clusterWith(relaxed, "Bridge")?.pois).toHaveLength(4);
    expect(clusterWith(relaxed, "Bridge")?.pois.map(names)).toContain("X1");
    expect(clusterWith(relaxed, "Y1")?.pois).toHaveLength(1);

    expect(counts(packed)).toEqual([3, 2]);
    expect(clusterWith(packed, "Bridge")?.pois.map(names)).toContain("Y1");

    expect(balanced).toEqual(defaultPace);
  });

  it("stays intact on a highly uneven distribution", () => {
    const blob: TripAttraction[] = [];
    let score = 95;

    for (let index = 0; index < 10; index += 1) {
      const lat = 41.39 + (index % 5) * 0.0004;
      const lng = 2.17 + Math.floor(index / 5) * 0.0005;
      blob.push(poi(`Blob${index + 1}`, lat, lng, score));
      score -= 1;
    }

    const farOne = poi("Far1", 41.44, 2.17, 80);
    const farTwo = poi("Far2", 41.441, 2.17, 78);
    const result = clusterPois([...blob, farOne, farTwo], { days: 3 });

    expect(result.assignedCount).toBe(12);
    expect(result.clusters).toHaveLength(3);

    const farCluster = result.clusters.find((cluster) =>
      cluster.pois.some((trip) => trip.name === "Far1"),
    );
    expect(farCluster?.pois.map(names)).toEqual(["Far1", "Far2"]);

    for (const cluster of result.clusters) {
      const hasBlob = cluster.pois.some((trip) => trip.name.startsWith("Blob"));
      const hasFar = cluster.pois.some((trip) => trip.name.startsWith("Far"));
      expect(hasBlob && hasFar).toBe(false);
    }
  });

  it("preserves input order and metadata invariants", () => {
    const input = [
      poi("C", 41.39, 2.17, 60),
      poi("A", 41.3904, 2.1702, 95),
      poi("B", 41.3902, 2.1705, 80),
    ];
    const result = clusterPois(input, { days: 1, pace: "relaxed" });

    expect(result.clusters[0].pois).toEqual(input);

    const multi = clusterPois(twelveAttractions(), { days: 3 });
    expect(multi.clusters.map((cluster) => cluster.day)).toEqual([1, 2, 3]);

    for (const cluster of multi.clusters) {
      expect(cluster.count).toBe(cluster.pois.length);
      expect(cluster.pois).toContain(cluster.medoid);
      expect(cluster.avgScore).toBeGreaterThanOrEqual(0);
      expect(cluster.avgScore).toBeLessThanOrEqual(100);
      expect(cluster.spreadMeters).toBeGreaterThanOrEqual(0);

      const latSum = cluster.pois.reduce((sum, trip) => sum + trip.lat, 0);
      const lngSum = cluster.pois.reduce((sum, trip) => sum + trip.lng, 0);
      const center = { lat: latSum / cluster.count, lng: lngSum / cluster.count };
      expect(cluster.center?.lat).toBeCloseTo(center.lat, 10);
      expect(cluster.center?.lng).toBeCloseTo(center.lng, 10);

      const spread = Math.max(
        ...cluster.pois.map((trip) =>
          distanceMeters(trip.lat, trip.lng, center.lat, center.lng),
        ),
      );
      expect(cluster.spreadMeters).toBe(Math.round(spread));

      const scoreSum = cluster.pois.reduce(
        (sum, trip) => sum + Math.min(100, Math.max(0, trip.score ?? 0)),
        0,
      );
      expect(cluster.avgScore).toBe(Math.round((scoreSum / cluster.count) * 10) / 10);
    }

    expect(multi.assignedCount + multi.unassigned.length).toBe(12);
  });

  it("handles a large input efficiently and deterministically", () => {
    const attractions: TripAttraction[] = [];

    for (let index = 0; index < 300; index += 1) {
      const lat = 41.3 + (index % 30) * 0.002;
      const lng = 2.1 + Math.floor(index / 30) * 0.002;
      attractions.push(poi(`P${String(index).padStart(3, "0")}`, lat, lng, 100 - (index % 100)));
    }

    const result = clusterPois(attractions, { days: 7 });

    expect(result.clusters).toHaveLength(7);
    expect(result.assignedCount).toBe(300);
    expect(result.unassigned).toEqual([]);
    expect(counts(result).reduce((sum, value) => sum + value, 0)).toBe(300);
    expect(result).toEqual(clusterPois(attractions, { days: 7 }));
  });

  it("preserves generic POI fields without copying", () => {
    interface TaggedPoi extends ClusterablePoi {
      osmKey: string;
    }

    const input: TaggedPoi[] = [
      { name: "Tagged One", lat: 41.39, lng: 2.17, score: 80, osmKey: "way/123" },
      { name: "Tagged Two", lat: 41.3905, lng: 2.17, score: 70, osmKey: "node/456" },
    ];

    const result = clusterPois(input, { days: 1 });

    expect(result.assignedCount).toBe(2);
    expect(result.clusters[0].pois[0]).toBe(input[0]);
    expect(result.clusters[0].pois[1]).toBe(input[1]);
    expect(result.clusters[0].pois[0].osmKey).toBe("way/123");
    expect(result.clusters[0].pois[1].osmKey).toBe("node/456");
  });
});
