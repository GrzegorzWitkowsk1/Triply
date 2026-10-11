import { afterEach, describe, expect, it, vi } from "vitest";
import type { ItineraryEditOperation, TripAttraction } from "@triply/shared";
import { TripModel } from "../models/Trip.js";
import { fetchAttractions } from "./attractions.js";
import { planTrip } from "./tripPlanner.js";
import { toItineraryRecord, toSchedulablePois } from "./tripGeneration.js";
import { applyItineraryOperation, recalculateEditedDay } from "./tripItineraryEditor.js";
import { regenerateTripDay } from "./tripRegeneration.js";
import { buildAssistantContext, factualAnswer, resolveAttraction } from "./assistantContext.js";

const hours = (raw: string) => ({ raw, source: "osm" as const, checkedAt: "2026-09-01" });
const place = (id: number, raw?: string): TripAttraction => ({ name: `Museum ${id}`, category: "culture",
  lat: 48.85 + id * .001, lng: 2.35, placeId: `node/${id}`, score: 90, visitDurationMinutes: 30,
  ...(raw ? { openingHours: hours(raw) } : {}) });
async function fixture() {
  const attractions = [place(1, "Tu-Su 10:00-18:00; Mo off"), place(2), place(3), place(4), place(5), place(6)];
  const planned = await planTrip({ pois: toSchedulablePois(attractions.slice(1, 3)), durationDays: 2,
    startDate: "2026-10-12", timeZone: "Europe/Paris", routing: { provider: null, returnToStart: false } });
  return new TripModel({ user: "507f1f77bcf86cd799439012", status: "ready", itineraryVersion: 1,
    analysis: { destination: "Paris", country: "France", durationDays: 2, startDate: "2026-10-12", endDate: "2026-10-13",
      pace: "balanced", interests: ["culture"], location: { lat: 48.85, lng: 2.35 } },
    attractions, itinerary: toItineraryRecord(planned, new Date()) });
}
afterEach(() => vi.unstubAllGlobals());
describe("opening-hours integration", () => {
  it("preserves Overpass metadata through scoring, contracts, scheduling and Mongoose casting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ elements: [{ type: "node", id: 100,
      lat: 48.851, lon: 2.35, tags: { name: "Gallery", tourism: "museum", opening_hours: "Tu-Su 10:00-18:00; Mo off",
        "opening_hours:covid19": "off", "check_date:opening_hours": "2026-09-01", "contact:website": "https://gallery.example" } }] }))));
    const found = await fetchAttractions(48.85, 2.35, ["culture"], { endpoints: ["https://overpass.example"], backoffMs: [] });
    expect(found![0].openingHours).toMatchObject({ ...hours("Tu-Su 10:00-18:00; Mo off"), legacyCovid19: "off", website: "https://gallery.example" });
    const result = await planTrip({ pois: toSchedulablePois(found!), durationDays: 1, startDate: "2026-10-13",
      timeZone: "Europe/Paris", routing: { provider: null, returnToStart: false } });
    expect(result.days[0].activities.find(a => a.type === "attraction")?.startTime).toContain("T10:00");
    const model = new TripModel({ attractions: found, itinerary: toItineraryRecord(result, new Date()) });
    const restored = new TripModel(model.toObject());
    expect(restored.attractions[0].openingHours?.raw).toBe(found![0].openingHours!.raw);
    expect(restored.itinerary!.days[0].activities.find(a => a.type === "attraction")?.openingHoursCheck?.status).toBe("open");
  });
  it("generation retains closed POIs as structured conflicts and still schedules feasible places", async () => {
    const result = await planTrip({ pois: toSchedulablePois([place(1, "Mo off"), place(2)]), durationDays: 1,
      startDate: "2026-10-12", timeZone: "Europe/Paris", routing: { provider: null, returnToStart: false } });
    expect(result.unscheduledPlaces).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "opening-hours-conflict", place: expect.objectContaining({ placeId: "node/1" }) })]));
    expect(result.days[0].activities.filter(a => a.type === "attraction").map(a => a.placeId)).toEqual(["node/2"]);
  });
  it.each(["add", "replace", "move", "reorder", "remove"] as const)("rechecks hours for manual %s while retaining user order", async type => {
    const trip = await fixture();
    const days = trip.toObject().itinerary!.days;
    // A controlled legacy schedule with both places on Tuesday before editing.
    const source = days[1];
    source.stops = trip.attractions.slice(0, 2).map(p => ({ ...p, placeId: p.placeId!, score: p.score ?? null }));
    source.activities = source.stops.map(p => ({ type: "attraction", placeId: p.placeId!, title: p.name, startTime: `${source.date}T10:00:00`, endTime: `${source.date}T10:30:00`, durationMinutes: 30 }));
    const target = days[0];
    target.stops = []; target.activities = [];
    let operation: ItineraryEditOperation;
    if (type === "add") operation = { type, dayIndex: 1, attractionId: "node/3" };
    else if (type === "replace") operation = { type, dayIndex: 2, oldAttractionId: "node/2", newAttractionId: "node/3" };
    else if (type === "move") operation = { type, sourceDayIndex: 2, targetDayIndex: 1, attractionId: "node/1" };
    else if (type === "reorder") operation = { type, dayIndex: 2, attractionIds: ["node/2", "node/1"] };
    else operation = { type, dayIndex: 2, attractionId: "node/2" };
    const affected = applyItineraryOperation(days, trip.attractions, { operation, expectedVersion: 1 });
    if (type === "move") {
      await expect(recalculateEditedDay(trip, days[0], null)).rejects.toMatchObject({ status: 422,
        conflicts: expect.arrayContaining([expect.objectContaining({ reason: "opening-hours-conflict" })]) });
    } else for (const index of affected) {
      const selected = days.find(d => d.dayIndex === index)!;
      const result = await recalculateEditedDay(trip, selected, null);
      expect(result.activities.filter(a => a.type === "attraction").map(a => a.placeId)).toEqual(selected.stops.map(p => p.placeId));
      expect(result.activities.filter(a => a.type === "attraction").every(a => a.openingHoursCheck)).toBe(true);
    }
  });
  it("regeneration uses the actual Monday and keeps other days untouched", async () => {
    const trip = await fixture();
    const before = JSON.stringify(trip.itinerary!.days[1]);
    const result = await regenerateTripDay({ trip, dayIndex: 1,
      preferences: { lessWalking: false, moreFood: false, relaxedPace: false, preferIndoor: false, surpriseMe: true },
      provider: null, fetchCandidates: vi.fn(async () => null) });
    expect(result.day.activities.some(a => a.placeId === "node/1")).toBe(false);
    expect(result.warnings.some(w => w.includes("Museum 1") && w.includes("Closed"))).toBe(true);
    expect(JSON.stringify(trip.itinerary!.days[1])).toBe(before);
    expect(result.day.activities.filter(a => a.type === "attraction").every(a => a.openingHoursCheck?.status === "unknown")).toBe(true);
  });
  it.each(["add", "replace"] as const)("rejects manual %s of a confirmed-closed attraction", async type => {
    const trip = await fixture();
    const days = trip.toObject().itinerary!.days;
    const target = days[0];
    const existing = trip.attractions[1];
    target.stops = [{ ...existing, placeId: existing.placeId!, score: existing.score ?? null }];
    target.activities = [{ type: "attraction", placeId: existing.placeId!, title: existing.name,
      startTime: `${target.date}T09:00:00`, endTime: `${target.date}T09:30:00`, durationMinutes: 30 }];
    days[1].activities = []; days[1].stops = [];
    const operation: ItineraryEditOperation = type === "add" ? { type, dayIndex: 1, attractionId: "node/1" }
      : { type, dayIndex: 1, oldAttractionId: "node/2", newAttractionId: "node/1" };
    applyItineraryOperation(days, trip.attractions, { operation, expectedVersion: 1 });
    await expect(recalculateEditedDay(trip, target, null)).rejects.toMatchObject({ status: 422,
      conflicts: expect.arrayContaining([expect.objectContaining({ reason: "opening-hours-conflict" })]) });
  });
  it("grounds assistant answers in persisted metadata and full visit checks", async () => {
    const trip = await fixture();
    const day = trip.itinerary!.days[1];
    day.activities = [{ type: "attraction", placeId: "node/1", title: "Museum 1", startTime: `${day.date}T10:00:00`, endTime: `${day.date}T11:30:00`, durationMinutes: 90 }];
    expect(factualAnswer(trip, "opening_hours", day, "node/1", "Can I visit at 17:00?")).toContain("closed for the 90-minute visit");
    expect(factualAnswer(trip, "opening_hours", day, "node/1")).toContain("open for the 90-minute visit");
    expect(buildAssistantContext(trip).openingHours.find(p => p.id === "node/1")?.metadata?.source).toBe("osm");
    expect(factualAnswer(trip, "opening_hours", trip.itinerary!.days[0], "node/1")).toContain("Closed on the selected date");
    expect(resolveAttraction(trip, "Museum 1", trip.itinerary!.days[0], null, false, true)[0].id).toBe("node/1");
  });
  it("automatic scheduling retries a feasible constrained order while manual edits reject it", async () => {
    const attractions = [place(1, "Mo 14:00-18:00"), place(2, "Mo 09:00-11:00")];
    const result = await planTrip({ pois: toSchedulablePois(attractions), durationDays: 1, startDate: "2026-10-12",
      timeZone: "Europe/Paris", routing: { provider: null, returnToStart: false } });
    expect(result.unscheduledPlaces).toHaveLength(0);
    expect(result.days[0].activities.filter(a => a.type === "attraction").map(a => a.placeId)).toEqual(["node/2", "node/1"]);
    const trip = new TripModel({ analysis: { pace: "balanced" }, attractions, itinerary: toItineraryRecord(result, new Date()) });
    const day = trip.toObject().itinerary!.days[0];
    day.stops.reverse();
    await expect(recalculateEditedDay(trip, day, null)).rejects.toMatchObject({ status: 422 });
  });
});
