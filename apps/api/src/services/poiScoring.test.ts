import { describe, expect, it } from "vitest";
import type { TripDayWeather } from "@triply/shared";
import type { NormalizedPoi } from "./poiFiltering.js";
import {
  DEFAULT_SCORING_WEIGHTS,
  deriveWeatherProfile,
  scorePois,
} from "./poiScoring.js";

function poi(overrides: Partial<NormalizedPoi> & { name: string }): NormalizedPoi {
  return {
    osmKey: null,
    category: "attraction",
    lat: 48.85,
    lng: 2.35,
    distanceMeters: 0,
    environment: "unknown",
    metadataCount: 0,
    ...overrides,
  };
}

function rainyDays(): TripDayWeather[] {
  return [
    { date: "2026-06-01", weatherCode: 61, temperatureMax: 14 },
    { date: "2026-06-02", weatherCode: 63, temperatureMax: 13 },
    { date: "2026-06-03", weatherCode: 95, temperatureMax: 17 },
  ];
}

function fairDays(): TripDayWeather[] {
  return [
    { date: "2026-06-01", weatherCode: 0, temperatureMax: 23 },
    { date: "2026-06-02", weatherCode: 1, temperatureMax: 24 },
    { date: "2026-06-03", weatherCode: 2, temperatureMax: 22 },
  ];
}

function resultNames(result: ReturnType<typeof scorePois>): string[] {
  return result.map((entry) => entry.name);
}

describe("scorePois", () => {
  it("returns an empty list for empty input", () => {
    expect(scorePois([], { interests: ["food"] })).toEqual([]);
  });

  it("normalizes scores to integers between 0 and 100", () => {
    const scored = scorePois(
      [
        poi({ name: "Near cafe", category: "food", distanceMeters: 120, metadataCount: 3 }),
        poi({ name: "Far sight", category: "attraction", distanceMeters: 9000 }),
        poi({ name: "Mid park", category: "nature", distanceMeters: 2400, metadataCount: 1 }),
      ],
      { interests: ["food"] },
    );

    expect(scored).toHaveLength(3);

    for (const entry of scored) {
      expect(Number.isInteger(entry.score)).toBe(true);
      expect(entry.score).toBeGreaterThanOrEqual(0);
      expect(entry.score).toBeLessThanOrEqual(100);
    }
  });

  it("produces identical results for identical input", () => {
    const build = () => [
      poi({ name: "Cafe One", category: "food", distanceMeters: 300, osmKey: "node/1" }),
      poi({ name: "Museum", category: "culture", distanceMeters: 900, osmKey: "node/2", metadataCount: 2 }),
      poi({ name: "Park", category: "nature", distanceMeters: 1500, osmKey: "node/3" }),
    ];

    const first = scorePois(build(), { interests: ["food", "culture"], weather: rainyDays() });
    const second = scorePois(build(), { interests: ["food", "culture"], weather: rainyDays() });

    expect(first).toEqual(second);
  });

  it("ranks the same POIs differently for different user interests", () => {
    const build = () => [
      poi({ name: "Corner Cafe", category: "food", distanceMeters: 700 }),
      poi({ name: "City Museum", category: "culture", distanceMeters: 700 }),
    ];

    const foodFirst = scorePois(build(), { interests: ["food"] });
    const cultureFirst = scorePois(build(), { interests: ["culture"] });

    expect(resultNames(foodFirst)).toEqual(["Corner Cafe", "City Museum"]);
    expect(resultNames(cultureFirst)).toEqual(["City Museum", "Corner Cafe"]);
    expect(foodFirst[0]!.score).toBeGreaterThan(foodFirst[1]!.score);
    expect(cultureFirst[0]!.score).toBeGreaterThan(cultureFirst[1]!.score);
  });

  it("neutralizes interest scoring when no interest is a known category", () => {
    const build = () => [
      poi({ name: "Corner Cafe", category: "food", distanceMeters: 700 }),
      poi({ name: "City Museum", category: "culture", distanceMeters: 700 }),
    ];

    const scored = scorePois(build(), { interests: ["gardening"] });

    expect(scored[0]!.score).toBe(scored[1]!.score);
    expect(scored.every((entry) => entry.breakdown.interest === 0.75)).toBe(true);
  });

  it("prefers closer POIs of equal relevance", () => {
    const scored = scorePois(
      [
        poi({ name: "Far Cafe", category: "food", distanceMeters: 3500 }),
        poi({ name: "Near Cafe", category: "food", distanceMeters: 200 }),
      ],
      { interests: ["food"] },
    );

    expect(resultNames(scored)).toEqual(["Near Cafe", "Far Cafe"]);
    expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score);
    expect(scored[1]!.breakdown.distance).toBeCloseTo(1 - 3500 / 5000, 5);
  });

  it("ranks monotonically by distance for otherwise identical POIs", () => {
    const scored = scorePois(
      [
        poi({ name: "D", category: "food", distanceMeters: 4900 }),
        poi({ name: "A", category: "food", distanceMeters: 100 }),
        poi({ name: "C", category: "food", distanceMeters: 2500 }),
        poi({ name: "E", category: "food", distanceMeters: 8000 }),
      ],
      { interests: ["food"] },
    );

    expect(resultNames(scored)).toEqual(["A", "C", "D", "E"]);
  });

  it("boosts indoor POIs on adverse weather and outdoor POIs in fair weather", () => {
    const build = () => [
      poi({ name: "Museum", category: "culture", environment: "indoor" }),
      poi({ name: "Park", category: "nature", environment: "outdoor" }),
      poi({ name: "Sight", category: "attraction", environment: "unknown" }),
    ];

    const adverse = scorePois(build(), { interests: [], weather: rainyDays() });
    const fair = scorePois(build(), { interests: [], weather: fairDays() });

    expect(resultNames(adverse)).toEqual(["Museum", "Sight", "Park"]);
    expect(resultNames(fair)).toEqual(["Park", "Museum", "Sight"]);
  });

  it("skips the weather component when no forecast is available", () => {
    const scored = scorePois(
      [
        poi({ name: "Museum", category: "culture", environment: "indoor" }),
        poi({ name: "Park", category: "nature", environment: "outdoor" }),
      ],
      { interests: [] },
    );

    expect(scored.every((entry) => entry.breakdown.weather === null)).toBe(true);
    expect(scored[0]!.score).toBe(scored[1]!.score);
  });

  it("keeps metadata-free POIs competitive", () => {
    const scored = scorePois(
      [
        poi({ name: "Bare Cafe", category: "food", distanceMeters: 250 }),
        poi({ name: "Rich Cafe", category: "food", distanceMeters: 250, metadataCount: 3 }),
      ],
      { interests: ["food"] },
    );

    const bare = scored.find((entry) => entry.name === "Bare Cafe");
    const rich = scored.find((entry) => entry.name === "Rich Cafe");

    expect(bare?.score).toBeGreaterThanOrEqual(80);
    expect(rich?.score).toBeGreaterThan(bare?.score ?? 0);
  });

  it("spreads scores across repeated categories for diversity", () => {
    const scored = scorePois(
      [
        poi({ name: "Cafe One", category: "food", distanceMeters: 400 }),
        poi({ name: "Cafe Two", category: "food", distanceMeters: 400 }),
        poi({ name: "Cafe Three", category: "food", distanceMeters: 400 }),
      ],
      { interests: ["food"] },
    );

    expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score);
    expect(scored[1]!.score).toBeGreaterThan(scored[2]!.score);
    expect(scored[0]!.breakdown.diversity).toBe(1);
    expect(scored[1]!.breakdown.diversity).toBe(0.5);
    expect(scored[2]!.breakdown.diversity).toBeCloseTo(1 / 3, 5);
  });

  it("honors weight overrides", () => {
    const scored = scorePois(
      [
        poi({ name: "Corner Cafe", category: "food", distanceMeters: 4000 }),
        poi({ name: "City Museum", category: "culture", distanceMeters: 100 }),
      ],
      {
        interests: ["food"],
        weights: { interest: 1, distance: 0, weather: 0, metadata: 0, diversity: 0 },
      },
    );

    expect(scored[0]).toMatchObject({ name: "Corner Cafe", score: 100 });
    expect(scored[1]).toMatchObject({ name: "City Museum", score: 30 });
  });

  it("exposes an explainable breakdown", () => {
    const [entry] = scorePois([poi({ name: "Only Spot", category: "food", metadataCount: 0 })], {
      interests: ["food"],
    });

    expect(entry?.breakdown).toEqual({
      interest: 1,
      distance: 1,
      weather: null,
      metadata: 0.4,
      diversity: 1,
    });
    expect(DEFAULT_SCORING_WEIGHTS.interest + DEFAULT_SCORING_WEIGHTS.distance).toBeCloseTo(0.65, 5);
  });

  it("keeps the nearest POI first regardless of category", () => {
    const scored = scorePois(
      [
        poi({ name: "Zoo", category: "nature", distanceMeters: 4800 }),
        poi({ name: "Bistro", category: "food", distanceMeters: 150 }),
        poi({ name: "Plaza", category: "attraction", distanceMeters: 4700 }),
      ],
      { interests: ["food"] },
    );

    expect(scored[0]?.name).toBe("Bistro");
  });
});

describe("deriveWeatherProfile", () => {
  it("returns null when no forecast is available", () => {
    expect(deriveWeatherProfile(null)).toBeNull();
    expect(deriveWeatherProfile(undefined)).toBeNull();
    expect(deriveWeatherProfile([])).toBeNull();
  });

  it("marks rainy and freezing days as adverse", () => {
    expect(deriveWeatherProfile(rainyDays())?.adverse).toBe(true);
    expect(
      deriveWeatherProfile([{ date: "2026-06-01", weatherCode: 0, temperatureMax: -3 }])?.adverse,
    ).toBe(true);
    expect(
      deriveWeatherProfile([{ date: "2026-06-01", weatherCode: 3, temperatureMax: 21 }])?.adverse,
    ).toBe(false);
  });

  it("needs at least a third of the days to be adverse", () => {
    const profile = deriveWeatherProfile([
      { date: "2026-06-01", weatherCode: 61, temperatureMax: 15 },
      { date: "2026-06-02", weatherCode: 1, temperatureMax: 20 },
      { date: "2026-06-03", weatherCode: 2, temperatureMax: 22 },
    ]);

    expect(profile?.adverseShare).toBeCloseTo(1 / 3, 5);
    expect(profile?.adverse).toBe(false);
  });
});
