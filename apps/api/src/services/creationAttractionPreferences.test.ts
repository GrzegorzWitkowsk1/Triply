import { afterEach, describe, expect, it, vi } from "vitest";
import { creationContextSchema, type TripAnalysis, type TripAttraction } from "@triply/shared";
import { finalizeCreationOutcomes, prioritizeCreationCandidates, resolveCreationAttractions } from "./creationAttractionPreferences.js";
import { lookupCreationAttractions } from "./attractions.js";
import { planTrip } from "./tripPlanner.js";
import { toSchedulablePois } from "./tripGeneration.js";

const place: TripAttraction = { name: "Colosseum", lat: 41.8902, lng: 12.4922, placeId: "way/42", category: "culture", score: 55, visitDurationMinutes: 60, openingHours: { raw: "24/7", source: "osm", checkedAt: null } };
const analysis: TripAnalysis = { destination: "Rome", country: "Italy", startDate: "2030-07-01", endDate: "2030-07-01", durationDays: 1, travelers: 1,
  budget: { amount: null, currency: null, type: null }, interests: ["culture"], pace: "balanced", maxWalkingDistanceKm: 5, notes: null, location: { lat: 41.89, lng: 12.49 } };
const adopted = { ...analysis, requestedAttractions: [], excludedAttractions: [] };
delete (adopted as Partial<typeof adopted>).notes; delete (adopted as Partial<typeof adopted>).location;
const context = (requestedAttractions = ["Colosseum"], excludedAttractions: string[] = []) => creationContextSchema.parse({ requestedAttractions, excludedAttractions, adopted });
afterEach(() => vi.unstubAllGlobals());
describe("requested places during initial creation", () => {
  it("uses existing candidates before network discovery", async () => {
    const lookup = vi.fn(); const result = await resolveCreationAttractions(context(), analysis, [place], lookup);
    expect(lookup).not.toHaveBeenCalled(); expect(result.outcomes[0]).toMatchObject({ placeId: "way/42", status: "not_scheduled" });
  });
  it("adds and prioritizes a verified provider place without inventing coordinates", async () => {
    const result = await resolveCreationAttractions(context(), analysis, [], vi.fn(async () => ({ available: true, matches: [{ name: "Colosseum", place }] })));
    expect(result.candidates[0]).toMatchObject({ lat: place.lat, lng: place.lng });
    const ordinary = Array.from({ length: 10 }, (_, index) => ({ ...place, name: `Park ${index}`, placeId: `node/${index}`, score: 90 }));
    expect(prioritizeCreationCandidates([...ordinary, ...result.candidates], result.outcomes, 1, "balanced")[0].placeId).toBe("way/42");
  });
  it("rejects similarly named places in other destinations and re-resolves destination changes", async () => {
    const lookup = vi.fn(async () => ({ available: true, matches: [{ name: "Colosseum", place }] }));
    const result = await resolveCreationAttractions(context(), { ...analysis, destination: "Paris", location: { lat: 48.85, lng: 2.35 } }, [place], lookup);
    expect(lookup).toHaveBeenCalledWith(48.85, 2.35, ["Colosseum"]); expect(result.outcomes[0].status).toBe("unresolved"); expect(result.candidates).toEqual([]);
  });
  it("reports unavailable and ambiguous results without blocking", async () => {
    const missing = await resolveCreationAttractions(context(), analysis, [], async () => ({ available: false, matches: [] }));
    expect(missing.outcomes[0]).toMatchObject({ status: "unresolved", reason: "provider_unavailable" });
    const ambiguous = await resolveCreationAttractions(context(), analysis, [], async () => ({ available: true, matches: [{ name: "Colosseum", place }, { name: "Colosseum", place: { ...place, lat: 41.9, placeId: "way/44" } }] }));
    expect(ambiguous.outcomes[0].status).toBe("unresolved");
  });
  it("honours explicit exclusions without lookup", async () => {
    const lookup = vi.fn(); const result = await resolveCreationAttractions(context(["Colosseum"], ["Colosseum"]), analysis, [place], lookup);
    expect(result.outcomes[0]).toMatchObject({ status: "excluded", reason: "user_excluded" }); expect(result.candidates).toEqual([]); expect(lookup).not.toHaveBeenCalled();
  });
  it("parses real Overpass response fixtures and bounds/escapes names", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ elements: [{ type: "way", id: 42, center: { lat: place.lat, lon: place.lng }, tags: { name: "Colosseo", "name:en": "Colosseum", tourism: "museum", opening_hours: "24/7" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await lookupCreationAttractions(41.89, 12.49, ["Colosseum"]);
    expect(result.matches[0]).toMatchObject({ name: "Colosseum", place: { name: "Colosseo", placeId: "way/42", lat: place.lat } });
    const query = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body)).get("data");
    expect(query).toContain("around:5000"); expect(query).toContain("out center tags 60");
    await lookupCreationAttractions(41.89, 12.49, ['A.*"; out;']);
    expect(new URLSearchParams(String(fetchMock.mock.calls[1]?.[1]?.body)).get("data")).toContain("A\\\\.\\\\*");
  });
  it("only claims inclusion after a real deterministic schedule includes the place", async () => {
    const resolved = await resolveCreationAttractions(context(), analysis, [place]);
    const plan = await planTrip({ pois: toSchedulablePois(resolved.candidates), durationDays: 1, pace: "balanced", startDate: "2030-07-01", timeZone: "Europe/Rome", routing: { provider: null, mode: "walking", start: analysis.location! } });
    const itinerary = { days: plan.days.map(day => ({ ...day, stops: [], segments: [], geometry: null })), unscheduled: [] };
    // Finalization only needs actual activities, not route geometry.
    expect(finalizeCreationOutcomes(resolved.outcomes, itinerary as Parameters<typeof finalizeCreationOutcomes>[1])[0].status).toBe("included");
  });
  it("closed requested venues cannot bypass scheduling and are reported accurately", async () => {
    const resolved = await resolveCreationAttractions(context(), analysis, [{ ...place, openingHours: { raw: "off", source: "osm", checkedAt: null } }]);
    const plan = await planTrip({ pois: toSchedulablePois(resolved.candidates), durationDays: 1, startDate: "2030-07-01", timeZone: "Europe/Rome", routing: { provider: null, mode: "walking", start: analysis.location! } });
    const result = finalizeCreationOutcomes(resolved.outcomes, { days: plan.days, unscheduled: plan.unscheduledPlaces } as unknown as Parameters<typeof finalizeCreationOutcomes>[1]);
    expect(result[0].status).not.toBe("included"); expect(result[0].reason).toBe("constraints");
  });
  it("reports resolved places absent from the itinerary as capacity failures", () => {
    expect(finalizeCreationOutcomes([{ name: "Colosseum", placeId: "way/42", status: "not_scheduled", reason: "capacity" }], { days: [], unscheduled: [] })[0]).toMatchObject({ status: "not_scheduled", reason: "capacity" });
  });
});
