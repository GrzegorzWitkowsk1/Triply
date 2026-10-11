import { describe, expect, it } from "vitest";
import { summarizeAdmission, type ItineraryDay, type TripAttraction } from "@triply/shared";
import { normalizeAdmission } from "./admissionPricingService.js";
const place = (id: string, tags?: Record<string, string>): TripAttraction => ({ placeId: id, name: id, category: "culture", lat: 48, lng: 2,
  ...(tags ? { admission: normalizeAdmission({ tourism: "museum", ...tags }) } : {}) });
const day = (places: TripAttraction[]): ItineraryDay => ({ dayIndex: 1, date: "2026-10-12", timeZone: "UTC", stops: [],
  activities: places.map(p => ({ type: "attraction", placeId: p.placeId!, title: p.name, startTime: "2026-10-12T10:00:00", endTime: "2026-10-12T11:00:00", durationMinutes: 60 })),
  geometry: null, segments: [], totalVisitMinutes: 60, totalTravelMinutes: 0, totalDistanceMeters: 0, partiallyEstimated: false, warnings: [] });
describe("admission summaries", () => {
  it("counts only scheduled activities, separating currencies and units", () => {
    const places = [place("free", { fee: "no" }), place("paid", { fee: "yes" }), place("old"), place("EUR", { charge: "0.10 EUR/person" }), place("USD", { charge: "2 USD/group" }), place("general", { charge: "3 EUR" }), place("unused", { charge: "900 EUR" })];
    const scheduled = day(places.slice(0, -1)); scheduled.activities.push(scheduled.activities[3]);
    const summary = summarizeAdmission([scheduled], places, 3);
    expect(summary).toMatchObject({ freeAttractions: 1, paidWithKnownPrice: 3, paidWithUnknownPrice: 1, unknownAdmission: 1, isComplete: false });
    expect(summary.knownAdmissionTotals).toEqual([
      { currency: "EUR", fractionDigits: 2, amountMinor: 30, unit: "per_person" },
      { currency: "USD", fractionDigits: 2, amountMinor: 200, unit: "per_group" },
      { currency: "EUR", fractionDigits: 2, amountMinor: 300, unit: "unknown" },
    ]);
  });
  it("does not multiply unknown units or unreliable traveler counts", () => {
    const places = [place("person", { charge: "12 EUR/person" })];
    expect(summarizeAdmission([day(places)], places, null)).toMatchObject({ isComplete: false, knownAdmissionTotals: [{ amountMinor: 1200 }] });
    expect(summarizeAdmission([day(places)], places, 2)).toMatchObject({ isComplete: true, knownAdmissionTotals: [{ amountMinor: 2400 }] });
  });
  it("handles legacy trips and wholly free admission", () => {
    const old = [place("old")]; expect(summarizeAdmission([day(old)], old)).toMatchObject({ unknownAdmission: 1, isComplete: false });
    const free = [place("free", { fee: "no" })]; expect(summarizeAdmission([day(free)], free)).toMatchObject({ freeAttractions: 1, isComplete: true, knownAdmissionTotals: [] });
  });
});
