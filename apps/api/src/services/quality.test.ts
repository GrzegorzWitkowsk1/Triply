import { describe, expect, it } from "vitest";
import { TripModel } from "../models/Trip.js";
import { planTrip } from "./tripPlanner.js";
import { toItineraryRecord, toSchedulablePois } from "./tripGeneration.js";
import { validateItinerary } from "./itineraryValidationService.js";
import { assessTripQuality } from "./tripQualityService.js";
import { repairItinerary } from "./itineraryRepairService.js";
import { DESTINATIONS, fixtureRouter, qualityScenario } from "./fixtures/qualityScenarios.js";
import { normalizeAdmission } from "./admissionPricingService.js";
import { factualAnswer, buildAssistantContext } from "./assistantContext.js";

async function fixture() {
  const attractions = [1, 2].map(i => ({ placeId: `node/${i}`, name: `Museum ${i}`, category: "culture", lat: 48.85 + i * .001, lng: 2.35, visitDurationMinutes: 30, score: 90 }));
  const result = await planTrip({ pois: toSchedulablePois(attractions), durationDays: 2, startDate: "2026-10-12", timeZone: "Europe/Paris", routing: { provider: null, start: { lat: 48.85, lng: 2.35 }, returnToStart: true } });
  return new TripModel({ attractions, analysis: { pace: "balanced", startDate: "2026-10-12", endDate: "2026-10-13", durationDays: 2, location: { lat: 48.85, lng: 2.35 }, budget: { amount: 100, currency: "EUR", type: "total" } }, itinerary: toItineraryRecord(result, new Date()) }).toObject();
}
describe("trip quality", () => {
  it("preserves existing planner validity under sparse metadata", async () => {
    const trip = await fixture();
    expect(validateItinerary(trip).issues.filter(i => i.severity === "error")).toEqual([]);
    expect(assessTripQuality(trip).score).toBeNull();
    expect(assessTripQuality(trip)).toEqual(assessTripQuality(trip));
  });
  it.each(DESTINATIONS)("validates synthetic $name scenarios without external requests", async destination => {
    for (const durationDays of [1, 4, 7]) {
      for (const pace of ["relaxed", "packed"] as const) {
        const trip = qualityScenario(destination, durationDays, pace);
        const planned = await planTrip({ pois: toSchedulablePois(trip.attractions), durationDays, pace, startDate: trip.analysis.startDate, timeZone: "Europe/Paris", routing: { provider: fixtureRouter, start: trip.analysis.location } });
        trip.itinerary = toItineraryRecord(planned, new Date(0));
        const before = JSON.stringify(trip);
        expect(validateItinerary(trip).issues.filter(i => i.severity === "error")).toEqual([]);
        expect(assessTripQuality(trip)).toEqual(assessTripQuality(trip));
        expect(JSON.stringify(trip)).toBe(before);
      }
    }
  });
  it.each([
    ["ACTIVITY_OVERLAP", (trip: Awaited<ReturnType<typeof fixture>>) => { const day = trip.itinerary!.days[0]; day.activities.push({ ...day.activities[0], type: "break" }); }],
    ["ACTIVITY_DURATION_INVALID", (trip: Awaited<ReturnType<typeof fixture>>) => { trip.itinerary!.days[0].activities[0].durationMinutes = -1; }],
    ["ACTIVITY_TIME_INVALID", (trip: Awaited<ReturnType<typeof fixture>>) => { trip.itinerary!.days[0].activities[0].startTime = "2026-02-30T09:00:00"; }],
    ["DATE_OUTSIDE_TRIP", (trip: Awaited<ReturnType<typeof fixture>>) => { trip.itinerary!.days[0].date = "2025-01-01"; }],
    ["ATTRACTION_DUPLICATE", (trip: Awaited<ReturnType<typeof fixture>>) => { const day = trip.itinerary!.days[0]; day.activities.push({ ...day.activities.find(a => a.type === "attraction")! }); }],
    ["COORDINATES_INVALID", (trip: Awaited<ReturnType<typeof fixture>>) => { trip.itinerary!.days[0].stops[0].lat = 200; }],
    ["ROUTE_VALUES_INVALID", (trip: Awaited<ReturnType<typeof fixture>>) => { trip.itinerary!.days[0].segments.push({ fromIndex: 0, toIndex: 1, durationSeconds: -1, distanceMeters: 1, geometry: null }); }],
  ] as const)("detects blocking %s", async (code, mutate) => {
    const trip = await fixture(); mutate(trip);
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code, severity: "error" }));
  });
  it("separates confirmed closures, unknown expressions and missing timezone", async () => {
    const trip = await fixture();
    trip.attractions[0].openingHours = { raw: "Mo off", source: "osm", checkedAt: null };
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code: "OPENING_HOURS_CONFLICT", severity: "error" }));
    trip.attractions[0].openingHours!.raw = "not a valid expression";
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code: "OPENING_HOURS_INVALID", severity: "warning" }));
    trip.itinerary!.days[0].timeZone = "unknown";
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code: "TIMEZONE_UNKNOWN", severity: "warning" }));
  });
  it("checks complete visits through split opening intervals", async () => {
    const trip = await fixture(); const visit = trip.itinerary!.days[0].activities.find(a => a.type === "attraction")!;
    trip.attractions[0].openingHours = { raw: "Mo 09:00-09:15,10:00-18:00", source: "osm", checkedAt: null };
    visit.startTime = "2026-10-12T09:00:00"; visit.endTime = "2026-10-12T09:30:00";
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code: "OPENING_HOURS_CONFLICT" }));
  });
  it("classifies partial prices, over-budget spending and currencies as warnings", async () => {
    const trip = await fixture(); trip.analysis.budget.amount = 1;
    trip.attractions[0].admission = normalizeAdmission({ tourism: "museum", fee: "yes", charge: "12 EUR/person" }); trip.analysis.travelers = 2;
    const result = validateItinerary(trip);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "BUDGET_PLANNED_EXCEEDED", severity: "warning" }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "ADMISSION_PRICE_UNKNOWN", severity: "warning" }));
    trip.analysis.budget.currency = "USD";
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code: "BUDGET_CURRENCY_MISMATCH", severity: "warning" }));
  });
  it("repairs known opening intervals without reordering, deletion or unrelated changes", async () => {
    const trip = await fixture(); const day = trip.itinerary!.days[0];
    day.activities = day.activities.filter(a => a.type === "attraction"); day.segments = []; day.partiallyEstimated = false;
    trip.attractions[0].openingHours = { raw: "Mo 11:00-18:00", source: "osm", checkedAt: null };
    const original = JSON.stringify(trip);
    const result = repairItinerary(trip, { dayIndex: day.dayIndex });
    expect(result.validation.valid).toBe(true); expect(result.repaired).toBe(true);
    expect(result.trip.itinerary!.days[0].activities[0].startTime).toContain("T11:00");
    expect(result.trip.itinerary!.days[0].activities.map(a => a.placeId)).toEqual(day.activities.map(a => a.placeId));
    expect(result.trip.itinerary!.days[1]).toEqual(trip.itinerary!.days[1]);
    expect(result.trip.expenses).toEqual(trip.expenses); expect(JSON.stringify(trip)).toBe(original);
    expect(repairItinerary(result.trip).repaired).toBe(false);
  });
  it("bounds unrepairable conflicts and respects zero attempts", async () => {
    const trip = await fixture(); trip.attractions[0].openingHours = { raw: "Mo off", source: "osm", checkedAt: null };
    const result = repairItinerary(trip, { maxAttempts: 100 });
    expect(result.validation.valid).toBe(false); expect(result.attempts).toBeLessThanOrEqual(3);
    expect(result.trip).toBe(trip); expect(repairItinerary(trip, { maxAttempts: 0 }).attempts).toBe(0);
  });
  it("supplies deterministic assistant diagnostics", async () => {
    const trip = new TripModel(await fixture());
    expect(buildAssistantContext(trip).quality).toEqual(assessTripQuality(trip.toObject()));
    expect(factualAnswer(trip, "quality")).toContain("does not guarantee");
  });
  it("plans across a DST transition without host timezone dependence", async () => {
    const trip = qualityScenario(DESTINATIONS[0], 4, "relaxed", 1000, "2026-10-24");
    const planned = await planTrip({ pois: toSchedulablePois(trip.attractions), durationDays: 4, pace: "relaxed", startDate: trip.analysis.startDate, timeZone: "Europe/Paris", routing: { provider: fixtureRouter } });
    trip.itinerary = toItineraryRecord(planned, new Date(0));
    expect(validateItinerary(trip).issues.filter(i => i.severity === "error")).toEqual([]);
  });
  it("detects missing travel, impossible windows and route endpoint inconsistency", async () => {
    const trip = qualityScenario(DESTINATIONS[1]);
    const planned = await planTrip({ pois: toSchedulablePois(trip.attractions.slice(0, 2)), durationDays: 1, startDate: trip.analysis.startDate, timeZone: "Europe/Prague", routing: { provider: fixtureRouter } });
    trip.itinerary = toItineraryRecord(planned, new Date(0));
    trip.itinerary.days[0].segments[0].durationSeconds = 10000;
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code: "TRAVEL_WINDOW_IMPOSSIBLE", severity: "error" }));
    trip.itinerary.days[0].segments = [];
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code: "ROUTE_MISSING", severity: "warning" }));
    trip.itinerary.days[0].segments = [{ fromIndex: 100, toIndex: 101, durationSeconds: 10, distanceMeters: 20, geometry: null }];
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code: "ROUTE_SEGMENT_INVALID", severity: "error" }));
  });
  it("uses walking preferences to flag outliers without rejecting remote attractions", async () => {
    const trip = await fixture(); const day = trip.itinerary!.days[0]; day.travelMode = "walking";
    trip.analysis.maxWalkingDistanceKm = 1; day.stops[0].lat += 1;
    expect(validateItinerary(trip).issues).toContainEqual(expect.objectContaining({ code: "GEOGRAPHIC_OUTLIER", severity: "warning" }));
    day.travelMode = "driving";
    expect(validateItinerary(trip).issues.some(i => i.code === "GEOGRAPHIC_OUTLIER")).toBe(false);
  });
  it("repairs overlaps using known travel while preserving manually selected sequence", async () => {
    const trip = qualityScenario(DESTINATIONS[1]);
    const planned = await planTrip({ pois: toSchedulablePois(trip.attractions.slice(0, 2)), durationDays: 1, startDate: trip.analysis.startDate, timeZone: "Europe/Prague", routing: { provider: fixtureRouter } });
    trip.itinerary = toItineraryRecord(planned, new Date(0));
    const day = trip.itinerary.days[0]; const visit = day.activities.filter(a => a.type === "attraction")[1];
    visit.startTime = "2026-10-12T09:00:00"; visit.endTime = "2026-10-12T09:30:00";
    const ids = day.activities.map(a => a.placeId);
    const result = repairItinerary(trip);
    expect(result.validation.valid).toBe(true);
    expect(result.trip.itinerary!.days[0].activities.map(a => a.placeId)).toEqual(ids);
    expect(validateItinerary(result.trip)).toEqual(result.validation);
  });
  it("supports day and activity scoped validation and configured windows", async () => {
    const trip = await fixture(); const day = trip.itinerary!.days[0];
    const report = validateItinerary(trip, { dayIndex: day.dayIndex, activityId: "node/1", dayWindows: [{ dayIndex: day.dayIndex, startMinutes: 720, endMinutes: 780 }] });
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "DAILY_WINDOW_EXCEEDED", severity: "error" }));
    expect(report.issues.every(i => !i.dayId || i.dayId === String(day.dayIndex))).toBe(true);
  });
});
