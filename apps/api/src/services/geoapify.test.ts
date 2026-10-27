import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripAttractionSchema } from "@triply/shared";
import { env } from "../config/env.js";
import { fetchAttractions } from "./attractions.js";
import { fetchGeoapifyPlaces } from "./geoapify.js";
import { reserveGeoapifyCredits, settleGeoapifyCredits, utcUsageDate } from "./geoapifyUsage.js";
import { planTrip } from "./tripPlanner.js";
import { toSchedulablePois } from "./tripGeneration.js";

vi.mock("./geoapifyUsage.js", async original => ({
  ...await original<typeof import("./geoapifyUsage.js")>(),
  reserveGeoapifyCredits: vi.fn(), settleGeoapifyCredits: vi.fn(async () => {}),
}));
const config = { ...env };
const transport = { endpoints: ["https://overpass.test/api/interpreter"], backoffMs: [], totalBudgetMs: 1000 };
const feature = (index = 0, raw?: Record<string, unknown>) => ({ type: "Feature", geometry: { type: "Point", coordinates: [2.35, 48.85] },
  properties: { place_id: `long-provider-id-${index}`, name: `Museum ${index}`, categories: ["entertainment.museum"], formatted: "Paris", description: "Collection", ...(raw ? { datasource: { raw } } : {}) } });
const places = (count = 1, raw?: Record<string, unknown>) => ({ type: "FeatureCollection", features: Array.from({ length: count }, (_, i) => feature(i, raw)) });
const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers });

it.each(["en", "pl"] as const)("preserves %s through Overpass fallback and Geoapify retry with supplied descriptions", async locale => {
  const http = vi.fn().mockResolvedValueOnce(json({}, 503))
    .mockResolvedValueOnce(json({}, 503, { "Retry-After": "0" }))
    .mockResolvedValueOnce(json(places(1, { "description:pl": "Polska kolekcja" })));
  vi.stubGlobal("fetch", http);
  const result = await fetchAttractions(48.85, 2.35, ["culture"], { ...transport, locale });
  expect(result?.[0]).toMatchObject({ name: "Museum 0", address: "Paris", description: locale === "pl" ? "Polska kolekcja" : "Collection" });
  expect(http).toHaveBeenCalledTimes(3);
});

beforeEach(() => {
  env.GEOAPIFY_ENABLED = true;
  env.GEOAPIFY_API_KEY = "test-secret";
  vi.mocked(reserveGeoapifyCredits).mockResolvedValue({ id: "reservation", date: utcUsageDate(), credits: 3 });
});
afterEach(() => { Object.assign(env, config); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("Overpass fallback orchestration", () => {
  it("returns successful Overpass attractions without reserving Geoapify credits", async () => {
    const http = vi.fn().mockResolvedValue(json({ elements: [{ type: "node", id: 1, lat: 48.85, lon: 2.35, tags: { name: "OSM Museum", tourism: "museum" } }] }));
    vi.stubGlobal("fetch", http);
    expect((await fetchAttractions(48.85, 2.35, ["culture"], transport))?.[0].placeId).toBe("node/1");
    expect(http).toHaveBeenCalledTimes(1); expect(reserveGeoapifyCredits).not.toHaveBeenCalled();
  });
  it("keeps valid empty Overpass responses and spends no credits", async () => {
    const http = vi.fn().mockResolvedValue(json({ elements: [] })); vi.stubGlobal("fetch", http);
    expect(await fetchAttractions(48.85, 2.35, ["culture"], transport)).toEqual([]);
    expect(http).toHaveBeenCalledTimes(1); expect(reserveGeoapifyCredits).not.toHaveBeenCalled();
  });
  it.each([429, 502, 503, 504])("activates fallback for HTTP %s", async status => {
    const http = vi.fn().mockResolvedValueOnce(json({}, status)).mockResolvedValueOnce(json(places())); vi.stubGlobal("fetch", http);
    const result = await fetchAttractions(48.85, 2.35, ["culture"], transport);
    expect(result?.[0]?.source).toBe("geoapify"); expect(http).toHaveBeenCalledTimes(2);
    expect(reserveGeoapifyCredits).toHaveBeenCalledWith(3, 2500);
  });
  it.each([new DOMException("timeout", "TimeoutError"), new TypeError("network")])("activates fallback for transport failure", async error => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(json(places())));
    expect(await fetchAttractions(48.85, 2.35, ["culture"], transport)).toHaveLength(1);
  });
  it("activates fallback for invalid Overpass response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({})).mockResolvedValueOnce(json(places())));
    expect(await fetchAttractions(48.85, 2.35, ["culture"], transport)).toHaveLength(1);
  });
  it("does not fallback for application/input errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 400)));
    expect(await fetchAttractions(48.85, 2.35, [], transport)).toBeNull();
    expect(reserveGeoapifyCredits).not.toHaveBeenCalled();
  });
  it.each(["disabled", "missing-key"])("skips %s Geoapify", async setting => {
    if (setting === "disabled") env.GEOAPIFY_ENABLED = false; else env.GEOAPIFY_API_KEY = null;
    const http = vi.fn().mockResolvedValue(json({}, 502)); vi.stubGlobal("fetch", http);
    expect(await fetchAttractions(48.85, 2.35, [], transport)).toBeNull();
    expect(http).toHaveBeenCalledTimes(1); expect(reserveGeoapifyCredits).not.toHaveBeenCalled();
  });
});

describe("metered Geoapify client", () => {
  it("supports cancellation before reservation", async () => {
    const controller = new AbortController(); controller.abort();
    const http = vi.fn(); vi.stubGlobal("fetch", http);
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [], { signal: controller.signal })).toBeNull();
    expect(reserveGeoapifyCredits).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });
  it("releases credits only when cancellation definitely precedes HTTP", async () => {
    const controller = new AbortController();
    vi.mocked(reserveGeoapifyCredits).mockImplementationOnce(async () => {
      controller.abort(); return { id: "cancelled", date: utcUsageDate(), credits: 3 };
    });
    const http = vi.fn(); vi.stubGlobal("fetch", http);
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [], { signal: controller.signal })).toBeNull();
    expect(settleGeoapifyCredits).toHaveBeenCalledWith(expect.anything(), 0); expect(http).not.toHaveBeenCalled();
  });
  it("reserves today's capacity again if reservation crossed midnight", async () => {
    vi.mocked(reserveGeoapifyCredits).mockResolvedValueOnce({ id: "old", date: "2000-01-01", credits: 3 });
    const http = vi.fn().mockResolvedValue(json(places())); vi.stubGlobal("fetch", http);
    expect(await fetchGeoapifyPlaces(48.85, 2.35, ["culture"])).toHaveLength(1);
    expect(reserveGeoapifyCredits).toHaveBeenCalledTimes(2);
    expect(settleGeoapifyCredits).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "old" }), 0);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("passes a configured timeout signal and conservatively counts timeout", async () => {
    const http = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.redirect).toBe("error");
      throw new DOMException("timeout", "TimeoutError");
    });
    vi.stubGlobal("fetch", http);
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [], { timeoutMs: 10 })).toBeNull();
    expect(settleGeoapifyCredits).toHaveBeenCalledWith(expect.anything(), 3); expect(http).toHaveBeenCalledTimes(1);
  });
  it("never sends HTTP without a reservation", async () => {
    vi.mocked(reserveGeoapifyCredits).mockResolvedValue(null);
    const http = vi.fn(); vi.stubGlobal("fetch", http);
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [])).toBeNull(); expect(http).not.toHaveBeenCalled();
  });
  it("counts all returned features before filtering or deduplication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(places(21))));
    await fetchGeoapifyPlaces(48.85, 2.35, ["culture"]);
    expect(settleGeoapifyCredits).toHaveBeenCalledWith(expect.objectContaining({ credits: 3 }), 2);
  });
  it.each([json({ features: [] }), json({ type: "FeatureCollection", features: [{ bad: true }] }), new Response("not json")])("retains maximum accounting for malformed responses", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [])).toBeNull();
    expect(settleGeoapifyCredits).toHaveBeenCalledWith(expect.anything(), 3);
  });
  it("accounts conservatively for network failures without logging the key", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("https://provider?apiKey=test-secret")));
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [])).toBeNull();
    expect(settleGeoapifyCredits).toHaveBeenCalledWith(expect.anything(), 3);
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-secret");
  });
  it("reserves separately for each retry", async () => {
    const http = vi.fn().mockResolvedValueOnce(json({}, 503, { "Retry-After": "0" })).mockResolvedValueOnce(json(places()));
    vi.stubGlobal("fetch", http); await fetchGeoapifyPlaces(48.85, 2.35, ["culture"]);
    expect(reserveGeoapifyCredits).toHaveBeenCalledTimes(2);
    expect(settleGeoapifyCredits).toHaveBeenNthCalledWith(1, expect.anything(), 3);
    expect(settleGeoapifyCredits).toHaveBeenNthCalledWith(2, expect.anything(), 1);
  });
  it("blocks retry once credits are exhausted", async () => {
    vi.mocked(reserveGeoapifyCredits).mockResolvedValueOnce({ id: "one", date: utcUsageDate(), credits: 3 }).mockResolvedValueOnce(null);
    const http = vi.fn().mockResolvedValue(json({}, 503, { "Retry-After": "0" })); vi.stubGlobal("fetch", http);
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [])).toBeNull(); expect(http).toHaveBeenCalledTimes(1);
  });
  it.each([429, 401, 403])("does not retry quota/auth status %s", async status => {
    const http = vi.fn().mockResolvedValue(json({}, status)); vi.stubGlobal("fetch", http);
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [])).toBeNull(); expect(http).toHaveBeenCalledTimes(1);
  });
  it("does not shorten Retry-After to fit retry budget", async () => {
    const http = vi.fn().mockResolvedValue(json({}, 503, { "Retry-After": "60" })); vi.stubGlobal("fetch", http);
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [])).toBeNull(); expect(http).toHaveBeenCalledTimes(1);
  });
  it("preserves stable identity, metadata and unknown hours/admission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(places())));
    const result = await fetchGeoapifyPlaces(48.85, 2.35, ["culture"]);
    expect(result?.[0]).toMatchObject({ name: "Museum 0", category: "culture", lat: 48.85, lng: 2.35, source: "geoapify", sourceId: "long-provider-id-0", address: "Paris", description: "Collection", admission: { status: "unknown", price: null } });
    expect(result?.[0].openingHours?.raw ?? null).toBeNull();
    expect(result?.[0].placeId).toMatch(/^geoapify\/[a-f0-9]{64}$/);
    expect(tripAttractionSchema.safeParse(result?.[0]).success).toBe(true);
  });
  it("preserves actual OSM opening hours and admission data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(places(1, { tourism: "museum", opening_hours: "Mo-Su 09:00-18:00", fee: "yes", charge: "10 EUR" }))));
    const result = await fetchGeoapifyPlaces(48.85, 2.35, ["culture"]);
    expect(result?.[0].openingHours?.raw).toBe("Mo-Su 09:00-18:00");
    expect(result?.[0].admission).toMatchObject({ status: "paid", price: { amountMinor: 1000, currency: "EUR" } });
  });
  it("accepts Geoapify results in the existing trip planner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(places())));
    const attractions = await fetchGeoapifyPlaces(48.85, 2.35, ["culture"]);
    const result = await planTrip({ pois: toSchedulablePois(attractions!), durationDays: 1, startDate: "2026-10-12", pace: "balanced", routing: { provider: null } });
    expect(result.days).toHaveLength(1);
    expect(result.days[0].activities.some(activity => activity.placeId === attractions![0].placeId)).toBe(true);
  });
});
