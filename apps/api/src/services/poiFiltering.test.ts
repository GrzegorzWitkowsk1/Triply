import { describe, expect, it } from "vitest";
import {
  normalizeInterests,
  normalizePois,
  type NormalizePoisOptions,
  type RawPoiCandidate,
} from "./poiFiltering.js";

const CENTER = { lat: 48.85, lng: 2.35 };

function poi(
  osmKey: string | null,
  lat: unknown,
  lng: unknown,
  tags: Record<string, unknown>,
): RawPoiCandidate {
  return { osmKey, lat, lng, tags };
}

function options(interests: readonly string[]): NormalizePoisOptions {
  return { lat: CENTER.lat, lng: CENTER.lng, interests };
}

function names(result: ReturnType<typeof normalizePois>): string[] {
  return result.map((entry) => entry.name);
}

describe("normalizeInterests", () => {
  it("lowercases, trims and dedupes interests", () => {
    expect(normalizeInterests([" Food ", "FOOD", "  ", "food", "culture"])).toEqual([
      "food",
      "culture",
    ]);
  });

  it("returns an empty list for no interests", () => {
    expect(normalizeInterests([])).toEqual([]);
  });
});

describe("normalizePois", () => {
  it("normalizes a valid POI with category, distance, environment and metadata", () => {
    const [result] = normalizePois(
      [
        poi("node/1", 48.851, 2.35, {
          name: " Café   de Flore ",
          amenity: "cafe",
          website: "https://cafe.example",
          description: "Historic café",
        }),
      ],
      options(["food"]),
    );

    expect(result).toMatchObject({
      osmKey: "node/1",
      name: "Café de Flore",
      category: "food",
      lat: 48.851,
      lng: 2.35,
      environment: "indoor",
      metadataCount: 2,
    });
    expect(result?.distanceMeters).toBeGreaterThan(100);
    expect(result?.distanceMeters).toBeLessThan(130);
  });

  it("keeps POIs without a description or website", () => {
    const result = normalizePois([poi("node/1", 48.86, 2.34, { name: "Quiet Bench", amenity: "cafe" })], options([]));

    expect(result).toHaveLength(1);
    expect(result[0]?.metadataCount).toBe(0);
  });

  it("drops POIs without a usable name", () => {
    const result = normalizePois(
      [
        poi("node/1", 48.86, 2.34, { amenity: "cafe" }),
        poi("node/2", 48.86, 2.34, { name: "   ", amenity: "cafe" }),
        poi("node/3", 48.86, 2.34, { name: 42, amenity: "cafe" }),
      ],
      options(["food"]),
    );

    expect(result).toEqual([]);
  });

  it("drops invalid coordinates including null island", () => {
    const result = normalizePois(
      [
        poi("node/1", Number.NaN, 2.35, { name: "NaN", amenity: "cafe" }),
        poi("node/2", 91, 2.35, { name: "Too north", amenity: "cafe" }),
        poi("node/3", 48.85, 200, { name: "Too east", amenity: "cafe" }),
        poi("node/4", 0, 0, { name: "Null Island", amenity: "cafe" }),
        poi("node/5", "48.85", 2.35, { name: "String coord", amenity: "cafe" }),
        poi("node/6", undefined, undefined, { name: "Missing coord", amenity: "cafe" }),
        poi("node/7", 48.86, 2.34, { name: "Valid", amenity: "cafe" }),
      ],
      options([]),
    );

    expect(names(result)).toEqual(["Valid"]);
  });

  it("removes repeated OSM ids", () => {
    const result = normalizePois(
      [
        poi("node/1", 48.86, 2.34, { name: "Twin Spot", amenity: "cafe" }),
        poi("node/1", 48.86, 2.34, { name: "Twin Spot", amenity: "cafe" }),
      ],
      options([]),
    );

    expect(result).toHaveLength(1);
  });

  it("merges node and way representations of the same place", () => {
    const result = normalizePois(
      [
        poi("way/9", 48.86015, 2.34, {
          name: "Central Museum",
          tourism: "museum",
        }),
        poi("node/9", 48.86, 2.34, {
          name: "Central Museum",
          tourism: "museum",
          description: "City museum",
          website: "https://museum.example",
        }),
      ],
      options([]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.osmKey).toBe("node/9");
    expect(result[0]?.metadataCount).toBe(2);
  });

  it("keeps same-named POIs that are far apart", () => {
    const result = normalizePois(
      [
        poi("node/1", 48.86, 2.34, { name: "City View", tourism: "attraction" }),
        poi("node/2", 48.87, 2.34, { name: "City View", tourism: "attraction" }),
      ],
      options([]),
    );

    expect(result).toHaveLength(2);
  });

  it("keeps same-named POIs with different categories even when close", () => {
    const result = normalizePois(
      [
        poi("node/1", 48.86, 2.34, { name: "Riverside", tourism: "attraction" }),
        poi("node/2", 48.8601, 2.34, { name: "Riverside", amenity: "restaurant" }),
      ],
      options([]),
    );

    expect(result).toHaveLength(2);
  });

  it("filters by the user's interests while keeping generic attractions", () => {
    const result = normalizePois(
      [
        poi("node/1", 48.86, 2.34, { name: "Bistro", amenity: "cafe" }),
        poi("node/2", 48.861, 2.341, { name: "Gallery", tourism: "museum" }),
        poi("node/3", 48.862, 2.342, { name: "Sight", tourism: "attraction" }),
      ],
      options(["Food"]),
    );

    expect(names(result)).toEqual(["Bistro", "Sight"]);
  });

  it("keeps every POI when interests are uncommon", () => {
    const result = normalizePois(
      [
        poi("node/1", 48.86, 2.34, { name: "Bistro", amenity: "cafe" }),
        poi("node/2", 48.861, 2.341, { name: "Gallery", tourism: "museum" }),
        poi("node/3", 48.862, 2.342, { name: "Sight", tourism: "attraction" }),
      ],
      options(["gardening", "astrology"]),
    );

    expect(names(result)).toEqual(["Bistro", "Gallery", "Sight"]);
    expect(result.map((entry) => entry.category)).toEqual(["food", "culture", "attraction"]);
  });

  it("keeps every POI when the user has no interests", () => {
    const result = normalizePois(
      [
        poi("node/1", 48.86, 2.34, { name: "Bistro", amenity: "cafe" }),
        poi("node/2", 48.861, 2.341, { name: "Gallery", tourism: "museum" }),
      ],
      options([]),
    );

    expect(result).toHaveLength(2);
  });

  it("maps OSM tags to canonical categories and environments", () => {
    const result = normalizePois(
      [
        poi("node/1", 48.86, 2.34, { name: "Louvre", tourism: "museum" }),
        poi("node/2", 48.861, 2.341, { name: "Jardin", leisure: "park" }),
        poi("node/3", 48.862, 2.342, { name: "Column", historic: "monument" }),
        poi("node/4", 48.863, 2.343, { name: "Notre-Dame", building: "cathedral" }),
        poi("node/5", 48.864, 2.344, { name: "Old Town", tourism: "attraction" }),
        poi("node/6", 48.865, 2.345, { name: "Books", shop: "books" }),
        poi("node/7", 48.866, 2.346, { name: "Overlook", tourism: "viewpoint" }),
        poi("node/8", 48.867, 2.347, { name: "Pub", amenity: "bar" }),
      ],
      options(["gardening"]),
    );

    expect(
      result.map((entry) => ({ name: entry.name, category: entry.category, environment: entry.environment })),
    ).toEqual([
      { name: "Louvre", category: "culture", environment: "indoor" },
      { name: "Jardin", category: "nature", environment: "outdoor" },
      { name: "Column", category: "architecture", environment: "outdoor" },
      { name: "Notre-Dame", category: "architecture", environment: "indoor" },
      { name: "Old Town", category: "attraction", environment: "unknown" },
      { name: "Books", category: "shopping", environment: "indoor" },
      { name: "Overlook", category: "attraction", environment: "outdoor" },
      { name: "Pub", category: "nightlife", environment: "indoor" },
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(normalizePois([], options(["food"]))).toEqual([]);
  });

  it("returns an empty list when the search center is invalid", () => {
    const result = normalizePois([poi("node/1", 48.86, 2.34, { name: "Spot", amenity: "cafe" })], {
      lat: Number.NaN,
      lng: 2.35,
      interests: [],
    });

    expect(result).toEqual([]);
  });
});
