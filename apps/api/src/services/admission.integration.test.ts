import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeAdmission, type ItineraryEditOperation, type TripAttraction } from "@triply/shared";
import { TripModel } from "../models/Trip.js";
import { fetchAttractions } from "./attractions.js";
import { normalizeAdmission } from "./admissionPricingService.js";
import { planTrip } from "./tripPlanner.js";
import { toItineraryRecord, toSchedulablePois } from "./tripGeneration.js";
import { toTripDetail } from "./tripDraft.js";
import { applyItineraryOperation, recalculateEditedDay } from "./tripItineraryEditor.js";
import { regenerateTripDay } from "./tripRegeneration.js";
import { buildAssistantContext, factualAnswer } from "./assistantContext.js";
const place = (id: number): TripAttraction => ({ name: `Museum ${id}`, category: "culture", lat: 48.85 + id * .001, lng: 2.35,
  placeId: `node/${id}`, score: 90, visitDurationMinutes: 30, admission: normalizeAdmission({ tourism: "museum", fee: "yes", charge: "12 EUR/person" }) });
async function fixture() {
  const attractions = [1, 2, 3, 4, 5, 6].map(place);
  const planned = await planTrip({ pois: toSchedulablePois(attractions.slice(0, 2)), durationDays: 2, startDate: "2026-10-12", timeZone: "Europe/Paris", routing: { provider: null, returnToStart: false } });
  return new TripModel({ user: "507f1f77bcf86cd799439012", status: "ready", itineraryVersion: 1,
    analysis: { travelers: 2, destination: "Paris", durationDays: 2, startDate: "2026-10-12", pace: "balanced", interests: ["culture"], location: { lat: 48.85, lng: 2.35 } }, attractions, itinerary: toItineraryRecord(planned, new Date()) });
}
afterEach(() => vi.unstubAllGlobals());
describe("admission integration", () => {
  it("preserves Overpass pricing through normalization, selection, scheduling, Mongoose and serialization", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ elements: [{ type: "node", id: 100, lat: 48.851, lon: 2.35,
      tags: { name: "Gallery", tourism: "museum", fee: "yes", charge: "8.50 EUR/person", "contact:website": "https://gallery.example" } }] }))));
    const found = await fetchAttractions(48.85, 2.35, ["culture"], { endpoints: ["https://overpass.example"], backoffMs: [] });
    expect(found![0].admission).toMatchObject({ status: "paid", rawCharge: "8.50 EUR/person", sourceUrl: "https://gallery.example", price: { amountMinor: 850 } });
    const planned = await planTrip({ pois: toSchedulablePois(found!), durationDays: 1, startDate: "2026-10-12", timeZone: "Europe/Paris", routing: { provider: null, returnToStart: false } });
    const trip = new TripModel({ attractions: found, analysis: { travelers: 2 }, itinerary: toItineraryRecord(planned, new Date()) });
    const restored = new TripModel(trip.toObject());
    expect(restored.itinerary!.days[0].stops[0].admission?.price?.amountMinor).toBe(850);
    expect(toTripDetail(restored).admissionSummary?.knownAdmissionTotals[0].amountMinor).toBe(1700);
  });
  it.each(["add", "remove", "replace", "move", "reorder"] as const)("retains pricing and recalculates summaries after manual %s", async type => {
    const trip = await fixture();
    const days = trip.toObject().itinerary!.days;
    days[0].stops = trip.attractions.slice(0, 2).map(p => ({ ...p, placeId: p.placeId!, score: 90 }));
    days[0].activities = days[0].stops.map(p => ({ type: "attraction", placeId: p.placeId!, title: p.name, startTime: "2026-10-12T09:00:00", endTime: "2026-10-12T09:30:00", durationMinutes: 30 }));
    days[1].stops = []; days[1].activities = [];
    const operation: ItineraryEditOperation = type === "add" ? { type, dayIndex: 1, attractionId: "node/3" }
      : type === "remove" ? { type, dayIndex: 1, attractionId: "node/1" }
      : type === "replace" ? { type, dayIndex: 1, oldAttractionId: "node/1", newAttractionId: "node/3" }
      : type === "move" ? { type, sourceDayIndex: 1, targetDayIndex: 2, attractionId: "node/1" }
      : { type, dayIndex: 1, attractionIds: ["node/2", "node/1"] };
    const affected = applyItineraryOperation(days, trip.attractions, { operation, expectedVersion: 1 });
    for (const index of affected) {
      const pos = days.findIndex(d => d.dayIndex === index);
      days[pos] = await recalculateEditedDay(trip, days[pos], null);
    }
    expect(days.flatMap(d => d.stops).every(p => p.admission?.price?.amountMinor === 1200)).toBe(true);
    expect(summarizeAdmission(days, trip.attractions, 2).knownAdmissionTotals[0].amountMinor).toBe(type === "add" ? 7200 : type === "remove" ? 2400 : 4800);
  });
  it("regeneration exposes pricing in preview and preserves other days", async () => {
    const trip = await fixture(); const before = JSON.stringify(trip.itinerary!.days[1]);
    const preview = await regenerateTripDay({ trip, dayIndex: 1, preferences: { lessWalking: false, moreFood: false, relaxedPace: false, preferIndoor: false, surpriseMe: true }, provider: null, fetchCandidates: vi.fn(async () => null) });
    expect(preview.day.stops.length).toBeGreaterThan(0);
    expect(preview.day.stops.every(p => p.admission?.price?.amountMinor === 1200)).toBe(true);
    expect(JSON.stringify(trip.itinerary!.days[1])).toBe(before);
  });
  it("answers pricing using persisted evidence and keeps totals partial when units are unknown", async () => {
    const trip = await fixture();
    expect(factualAnswer(trip, "admission", undefined, undefined, "How much for two people?")).toContain("€48.00");
    trip.attractions[0].admission!.price!.unit = "unknown";
    expect(factualAnswer(trip, "admission", undefined, "node/1", "How much does Museum 1 cost?")).toContain("€12.00");
    expect(factualAnswer(trip, "admission")).toContain("This is partial");
    expect(buildAssistantContext(trip).admission.length).toBe(2);
  });
});
