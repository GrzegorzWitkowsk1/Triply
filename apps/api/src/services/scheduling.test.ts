import { describe, expect, it } from "vitest";
import type {
  DailySchedulingInput,
  OpeningHours,
  OptimizedDayRoute,
  SchedulablePoi,
  TripDayWeather,
} from "@triply/shared";
import { buildDailySchedules } from "./scheduling.js";

function poi(name: string, over: Partial<SchedulablePoi> = {}): SchedulablePoi {
  return { name, category: "attraction", lat: 41.39, lng: 2.17, ...over };
}

interface RouteOptions {
  travelMinutes?: number;
  distanceMeters?: number | null;
  durationSeconds?: number | null;
  returnsToStart?: boolean;
}

function makeRoute(
  dayIndex: number,
  places: SchedulablePoi[],
  options: RouteOptions = {},
): OptimizedDayRoute<SchedulablePoi> {
  const travelMinutes = options.travelMinutes ?? 10;
  const durationSeconds =
    options.durationSeconds !== undefined ? options.durationSeconds : travelMinutes * 60;
  const distanceMeters = options.distanceMeters !== undefined ? options.distanceMeters : 500;

  const segments = places.slice(0, -1).map((_, index) => ({
    fromIndex: index,
    toIndex: index + 1,
    distanceMeters,
    durationSeconds,
    geometry: null,
  }));

  return {
    dayIndex,
    orderedPlaces: [...places],
    segments,
    totalDistanceMeters: segments.reduce((total, segment) => total + (segment.distanceMeters ?? 0), 0),
    totalDurationSeconds: segments.reduce(
      (total, segment) => total + (segment.durationSeconds ?? 0),
      0,
    ),
    geometry: null,
    travelMode: "walking",
    routingSource: "provider",
    returnsToStart: options.returnsToStart ?? false,
  };
}

function makeRouteWithStart(
  places: SchedulablePoi[],
  options: { travelMinutes?: number; returnsToStart?: boolean } = {},
): OptimizedDayRoute<SchedulablePoi> {
  const travelMinutes = options.travelMinutes ?? 10;
  const segment = (index: number) => ({
    fromIndex: index,
    toIndex: index + 1,
    distanceMeters: 500,
    durationSeconds: travelMinutes * 60,
    geometry: null,
  });

  const segments = [segment(0)];

  for (let index = 1; index < places.length; index += 1) {
    segments.push(segment(index));
  }

  if (options.returnsToStart && places.length > 0) {
    segments.push(segment(places.length));
  }

  return {
    dayIndex: 1,
    orderedPlaces: [...places],
    segments,
    totalDistanceMeters: segments.length * 500,
    totalDurationSeconds: segments.length * travelMinutes * 60,
    geometry: null,
    travelMode: "walking",
    routingSource: "provider",
    returnsToStart: options.returnsToStart ?? false,
  };
}

function build(
  dayRoutes: OptimizedDayRoute<SchedulablePoi>[],
  over: Partial<DailySchedulingInput<SchedulablePoi>> = {},
) {
  return buildDailySchedules<SchedulablePoi>({
    dayRoutes,
    travelMode: "walking",
    ...over,
  });
}

describe("OSM opening-aware scheduling", () => {
  const metadata = (raw: string) => ({ raw, source: "osm" as const, checkedAt: null });
  it("waits for opening and verifies the full visit again after breaks", () => {
    const place = poi("Gallery", { visitDurationMinutes: 60, openingHours: metadata("Mo 13:00-14:00") });
    const result = build([makeRoute(1, [place])], { startDate: "2026-06-01", pace: "balanced" });
    const visit = result.days[0].activities.find(a => a.type === "attraction");
    expect(visit?.startTime).toBe("2026-06-01T13:00:00");
    expect(visit?.openingHoursCheck?.status).toBe("open");
  });
  it("retains every conflicting and blocked attraction as a structured result", () => {
    const result = build([makeRoute(1, [poi("Closed", { openingHours: metadata("Mo off") }), poi("Unknown")])],
      { startDate: "2026-06-01" });
    expect(result.unscheduledPlaces.map(p => p.place.name)).toEqual(["Closed", "Unknown"]);
    expect(result.unscheduledPlaces[0].reason).toBe("opening-hours-conflict");
    expect(result.unscheduledPlaces[1].reason).toBe("insufficient-time");
  });
  it("leaves invalid and missing hours explicitly unknown on each visit", () => {
    const result = build([makeRoute(1, [poi("Invalid", { openingHours: metadata("invalid") }), poi("Missing")])],
      { startDate: "2026-06-01" });
    expect(result.days[0].activities.filter(a => a.type === "attraction").map(a => a.openingHoursCheck?.status)).toEqual(["unknown", "unknown"]);
  });
});

describe("buildDailySchedules", () => {
  it("estimates visit durations and preserves provided ones", () => {
    const places = [
      poi("Museum", { category: "culture" }),
      poi("Tower", { category: "architecture", visitDurationMinutes: 25 }),
    ];
    const result = build([makeRoute(1, places)], { startDate: "2026-06-01" });
    const attractions = result.days[0].activities.filter((activity) => activity.type === "attraction");

    expect(attractions[0].durationMinutes).toBe(105);
    expect(attractions[0].durationSource).toBe("estimated");
    expect(attractions[1].durationMinutes).toBe(25);
    expect(attractions[1].durationSource).toBe("provided");
  });

  it("applies pace-specific daily start times", () => {
    const relaxed = build([makeRoute(1, [poi("A")])], { pace: "relaxed", startDate: "2026-06-01" });
    const packed = build([makeRoute(1, [poi("A")])], { pace: "packed", startDate: "2026-06-01" });

    expect(relaxed.days[0].activities[0].startTime).toBe("2026-06-01T10:00:00");
    expect(packed.days[0].activities[0].startTime).toBe("2026-06-01T08:00:00");
  });

  it("schedules more attractions on packed days than relaxed days", () => {
    const places = Array.from({ length: 6 }, (_, index) => poi(`P${index}`, { category: "culture" }));

    const count = (result: ReturnType<typeof build>) =>
      result.days[0].activities.filter((activity) => activity.type === "attraction").length;

    const relaxed = build([makeRoute(1, places)], { pace: "relaxed", startDate: "2026-06-01" });
    const packed = build([makeRoute(1, places)], { pace: "packed", startDate: "2026-06-01" });

    expect(count(packed)).toBeGreaterThan(count(relaxed));
  });

  it("keeps activities ordered and non-overlapping", () => {
    const places = Array.from({ length: 4 }, (_, index) => poi(`P${index}`, { category: "nature" }));
    const result = build([makeRoute(1, places)], { pace: "balanced", startDate: "2026-06-01" });
    const activities = result.days[0].activities;

    for (let index = 1; index < activities.length; index += 1) {
      expect(activities[index].startTime >= activities[index - 1].endTime).toBe(true);
    }
  });

  it("places travel segments between attractions using provider durations", () => {
    const route = makeRoute(1, [poi("A"), poi("B"), poi("C")], { travelMinutes: 15 });
    const result = build([route], { startDate: "2026-06-01" });
    const kinds = result.days[0].activities
      .filter((activity) => activity.type !== "break")
      .map((activity) => activity.type);

    expect(kinds).toEqual(["attraction", "travel", "attraction", "travel", "attraction"]);

    const travels = result.days[0].activities.filter((activity) => activity.type === "travel");
    expect(travels.every((travel) => travel.travelDurationSource === "provider")).toBe(true);
    expect(travels.every((travel) => travel.durationMinutes === 15)).toBe(true);
    expect(result.days[0].totalTravelMinutes).toBe(30);
  });

  it("places base travel and return travel when routing used a start", () => {
    const route = makeRouteWithStart([poi("A"), poi("B")], { travelMinutes: 12, returnsToStart: true });
    const result = build([route], { startDate: "2026-06-01", start: { lat: 41.38, lng: 2.16 } });
    const activities = result.days[0].activities;

    expect(activities[0].type).toBe("travel");
    expect(activities[0].title).toBe("To A");
    expect(activities[activities.length - 1].type).toBe("travel");
    expect(activities[activities.length - 1].title).toBe("Return to start");
    expect(result.days[0].totalTravelMinutes).toBe(36);
  });

  it("inserts non-overlapping lunch and coffee breaks", () => {
    const places = Array.from({ length: 4 }, (_, index) => poi(`P${index}`, { category: "nature" }));
    const result = build([makeRoute(1, places, { travelMinutes: 10 })], {
      pace: "balanced",
      startDate: "2026-06-01",
    });

    const titles = result.days[0].activities
      .filter((activity) => activity.type === "break")
      .map((activity) => activity.title);

    expect(titles).toContain("Lunch break");
    expect(titles).toContain("Coffee break");
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("drops trailing attractions that do not fit and reports why", () => {
    const places = Array.from({ length: 6 }, (_, index) => poi(`P${index}`, { category: "culture" }));
    const result = build([makeRoute(1, places)], { pace: "relaxed", startDate: "2026-06-01" });

    const scheduled = result.days[0].activities.filter((activity) => activity.type === "attraction");
    const unscheduled = result.unscheduledPlaces.filter((entry) => entry.reason === "insufficient-time");

    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.length).toBeLessThan(places.length);
    expect(unscheduled.length).toBeGreaterThan(0);

    const scheduledTitles = new Set(scheduled.map((activity) => activity.title));
    for (const entry of unscheduled) {
      expect(scheduledTitles.has(entry.place.name)).toBe(false);
    }

    expect(result.days[0].activities[result.days[0].activities.length - 1].endTime <= "2026-06-01T17:00:00").toBe(true);
  });

  it("waits for the opening time when an attraction opens later", () => {
    const openingHours: OpeningHours = { weekly: { mon: [{ openMinutes: 600, closeMinutes: 780 }] } };
    const place = poi("Gallery", { category: "culture", visitDurationMinutes: 60, openingHours });

    const result = build([makeRoute(1, [place])], { pace: "balanced", startDate: "2026-06-01" });
    const activity = result.days[0].activities[0];

    expect(activity.startTime).toBe("2026-06-01T10:00:00");
  });

  it("flags attractions that conflict with opening hours", () => {
    const openingHours: OpeningHours = { weekly: { mon: [{ openMinutes: 600, closeMinutes: 620 }] } };
    const place = poi("Tiny", { category: "culture", visitDurationMinutes: 60, openingHours });

    const result = build([makeRoute(1, [place])], { pace: "balanced", startDate: "2026-06-01" });

    expect(result.days[0].activities.filter((activity) => activity.type === "attraction")).toHaveLength(0);
    expect(result.unscheduledPlaces.some((entry) => entry.reason === "opening-hours-conflict")).toBe(true);
  });

  it("treats an explicitly empty weekday as closed", () => {
    const openingHours: OpeningHours = { weekly: { mon: [] } };
    const place = poi("Closed", { openingHours });

    const result = build([makeRoute(1, [place])], { pace: "balanced", startDate: "2026-06-01" });

    expect(result.unscheduledPlaces.some((entry) => entry.reason === "opening-hours-conflict")).toBe(true);
  });

  it("marks missing opening hours as unverified", () => {
    const result = build([makeRoute(1, [poi("A")])], { pace: "balanced", startDate: "2026-06-01" });

    expect(result.days[0].warnings.some((warning) => warning.includes("Opening hours unverified"))).toBe(true);
  });

  it("approximates missing durations from distance", () => {
    const route = makeRoute(1, [poi("A"), poi("B")], { durationSeconds: null, distanceMeters: 1400 });
    const result = build([route], { startDate: "2026-06-01" });
    const travel = result.days[0].activities.find((activity) => activity.type === "travel");

    expect(travel?.travelDurationSource).toBe("approximation");
    expect(travel?.durationMinutes).toBe(17);
  });

  it("does not silently treat unknown travel as zero", () => {
    const route = makeRoute(1, [poi("A"), poi("B")], { durationSeconds: null, distanceMeters: null });
    const result = build([route], { startDate: "2026-06-01" });
    const travel = result.days[0].activities.find((activity) => activity.type === "travel");

    expect(travel?.travelDurationSource).toBe("unavailable");
    expect(travel?.durationMinutes).toBe(10);
    expect((travel?.warnings?.length ?? 0) > 0).toBe(true);
    expect(result.days[0].partiallyEstimated).toBe(true);
    expect(result.days[0].totalTravelMinutes).toBeNull();
  });

  it("warns about outdoor activities during adverse weather without reordering", () => {
    const weather: TripDayWeather[] = [{ date: "2026-06-01", weatherCode: 61, temperatureMax: 20 }];
    const outdoor = poi("Park", { environment: "outdoor", category: "nature" });
    const indoor = poi("Museum", { environment: "indoor", category: "culture" });

    const result = build([makeRoute(1, [outdoor, indoor])], { weather, startDate: "2026-06-01" });
    const park = result.days[0].activities.find((activity) => activity.title === "Park");
    const museum = result.days[0].activities.find((activity) => activity.title === "Museum");

    expect(park?.weatherAdjusted).toBe(true);
    expect(park?.warnings?.some((warning) => warning.includes("Outdoor"))).toBe(true);
    expect(museum?.weatherAdjusted).toBeUndefined();

    const order = result.days[0].activities
      .filter((activity) => activity.type === "attraction")
      .map((activity) => activity.title);
    expect(order).toEqual(["Park", "Museum"]);
  });

  it("does not pretend a forecast exists outside the supplied range", () => {
    const weather: TripDayWeather[] = [{ date: "2026-06-02", weatherCode: 0, temperatureMax: 22 }];
    const result = build([makeRoute(1, [poi("A")])], { weather, startDate: "2026-06-01" });

    expect(result.days[0].warnings.some((warning) => warning.includes("Weather forecast unavailable"))).toBe(true);
  });

  it("moves invalid-coordinate places to unscheduled", () => {
    const route = makeRoute(1, [poi("Good"), poi("Bad", { lat: 999, lng: 2.18 })]);
    const result = build([route], { startDate: "2026-06-01" });

    expect(
      result.unscheduledPlaces.some(
        (entry) => entry.reason === "invalid-location" && entry.place.name === "Bad",
      ),
    ).toBe(true);
    expect(result.days[0].activities.some((activity) => activity.title === "Bad")).toBe(false);
  });

  it("produces one schedule per day with sequential dates", () => {
    const result = build([makeRoute(1, [poi("A")]), makeRoute(2, [poi("B")])], {
      startDate: "2026-06-01",
    });

    expect(result.days).toHaveLength(2);
    expect(result.days[0].date).toBe("2026-06-01");
    expect(result.days[1].date).toBe("2026-06-02");
  });

  it("handles empty days with zero totals", () => {
    const result = build([makeRoute(1, [])], { startDate: "2026-06-01" });
    const day = result.days[0];

    expect(day.activities).toEqual([]);
    expect(day.totalVisitMinutes).toBe(0);
    expect(day.totalTravelMinutes).toBe(0);
    expect(day.totalDistanceMeters).toBe(0);
  });

  it("is deterministic", () => {
    const places = Array.from({ length: 5 }, (_, index) => poi(`P${index}`));
    const run = () =>
      build([makeRoute(1, places)], {
        pace: "packed",
        startDate: "2026-06-01",
        timeZone: "Europe/Warsaw",
      });

    expect(run()).toEqual(run());
  });

  it("warns when the destination time zone is unknown", () => {
    const result = build([makeRoute(1, [poi("A")])], { startDate: "2026-06-01" });

    expect(result.timeZone).toBe("UTC");
    expect(result.days[0].warnings.some((warning) => warning.includes("time zone unknown"))).toBe(true);
    expect(result.days[0].activities[0].startTime.startsWith("2026-06-01T")).toBe(true);
  });

  it("reports a daylight saving adjustment when a window starts in the DST gap", () => {
    const result = build([makeRoute(1, [poi("A", { visitDurationMinutes: 30 })])], {
      startDate: "2026-03-29",
      timeZone: "Europe/Warsaw",
      dayWindows: [{ dayIndex: 1, startMinutes: 150, endMinutes: 300 }],
    });
    const activity = result.days[0].activities[0];

    expect(activity.startTime).toBe("2026-03-29T03:30:00");
    expect(activity.warnings?.some((warning) => warning.includes("daylight saving"))).toBe(true);
  });

  it("honours arrival and departure constraints", () => {
    const routes = [
      makeRoute(1, [poi("A", { visitDurationMinutes: 30 })]),
      makeRoute(2, [poi("B", { visitDurationMinutes: 30 })]),
    ];
    const result = build(routes, {
      startDate: "2026-06-01",
      arrivalTimeMinutes: 600,
      departureTimeMinutes: 720,
    });

    expect(result.days[0].activities[0].startTime).toBe("2026-06-01T10:00:00");
  });

  it("preserves the routing order of scheduled attractions", () => {
    const result = build([makeRoute(1, [poi("A"), poi("B"), poi("C")])], { startDate: "2026-06-01" });
    const titles = result.days[0].activities
      .filter((activity) => activity.type === "attraction")
      .map((activity) => activity.title);

    expect(titles).toEqual(["A", "B", "C"]);
  });
});
