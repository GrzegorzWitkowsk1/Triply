import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import type { MemoryStore } from "express-rate-limit";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { addDays, regenerationPreferencesSchema } from "@triply/shared";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { aiService } from "../ai/index.js";
import { planTrip } from "../services/tripPlanner.js";
import { editTripItinerary } from "../services/tripItineraryEditor.js";
import { createDayRegenerationPreview, applyDayRegeneration } from "../services/tripRegeneration.js";
import { refreshTripWeather } from "../services/tripWeather.js";
import { toTripDetail } from "../services/tripDraft.js";

vi.mock("../ai/index.js", () => ({ aiService: { parseTrip: vi.fn(), parseRegeneration: vi.fn() } }));
vi.mock("../services/tripPlanner.js", () => ({ planTrip: vi.fn() }));
vi.mock("../routing/index.js", () => ({ createRoutingProvider: () => null }));
const stores = vi.hoisted(() => [] as MemoryStore[]);
vi.mock("express-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("express-rate-limit")>();
  return { ...actual, rateLimit: (options: Parameters<typeof actual.rateLimit>[0]) => {
    const store = new actual.MemoryStore(); stores.push(store); return actual.rateLimit({ ...options, store });
  } };
});

let app: Express;
let mongod: MongoMemoryServer;
const NOW = new Date("2026-10-12T12:00:00Z");
const DAY = "2026-10-12";
const NEXT = addDays(DAY, 1);
const relaxedPreferences = regenerationPreferencesSchema.parse({ relaxedPace: true });
const stops = [
  { placeId: "node/1", name: "Colosseum", category: "culture", lat: 41.89, lng: 12.49 },
  { placeId: "node/2", name: "Forum", category: "culture", lat: 41.892, lng: 12.485 },
  { placeId: "node/3", name: "Pantheon", category: "culture", lat: 41.898, lng: 12.477 },
  { placeId: "node/4", name: "Trevi Fountain", category: "culture", lat: 41.901, lng: 12.483 },
];
const itineraryDay = (date: string, dayIndex: number) => ({ dayIndex, date, timeZone: "Europe/Rome", stops: stops.slice((dayIndex - 1) * 2, dayIndex * 2),
  activities: stops.slice((dayIndex - 1) * 2, dayIndex * 2).map((stop, i) => ({ type: "attraction", placeId: stop.placeId, title: stop.name,
    startTime: `${date}T${i === 0 ? "09" : "10"}:00:00`, endTime: `${date}T${i === 0 ? "10" : "11"}:00:00`, durationMinutes: 60 })),
  geometry: { type: "LineString", coordinates: [[12.49, 41.89], [12.485, 41.892]] },
  segments: [], totalVisitMinutes: 120, totalTravelMinutes: 0, totalDistanceMeters: 0, partiallyEstimated: false, warnings: [] });

beforeAll(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()); app = (await import("../app.js")).createApp(); }, 120_000);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks();
  for (const store of stores) store.resetAll();
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
});
afterAll(async () => { await mongoose.disconnect(); await mongod?.stop(); });

async function setup() {
  const agent = request.agent(app);
  const user = await agent.post("/api/auth/register").set("Origin", env.WEB_ORIGIN)
    .send({ email: "weather@example.com", password: "Password123!Aa" });
  expect(user.status).toBe(201);
  const metrics = { attractionCount: 2, walkingMeters: 0, travelMinutes: 0, visitMinutes: 120 };
  const trip = await TripModel.create({ user: new mongoose.Types.ObjectId(user.body.user.id), status: "ready", prompt: "Rome", badges: ["culture"],
    analysis: { destination: "Rome", country: "Italy", location: { lat: 41.9, lng: 12.5 }, startDate: DAY, endDate: NEXT,
      durationDays: 2, travelers: 2, budget: { amount: 500, currency: "EUR", type: "total" }, interests: ["culture"], pace: "balanced", notes: "Keep preferences" },
    attractions: stops, itineraryVersion: 8,
    itinerary: { timeZone: "Europe/Rome", routingSource: "provider", days: [itineraryDay(DAY, 1), itineraryDay(NEXT, 2)], unscheduled: [] },
    expenses: [{ id: "expense-1", title: "Lunch", category: "food_drinks", amountMinor: 1500, currency: "EUR", type: "actual", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    budgetAllocations: { food_drinks: 10_000 }, budgetRevision: 3, budgetAllocationCurrency: "EUR",
    regeneration: { previewId: "preview-1", dayIndex: 1, baseItineraryVersion: 8, preferences: {}, day: itineraryDay(DAY, 1),
      comparison: { original: metrics, proposed: metrics, added: [], removed: [] }, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
  });
  const path = `/api/trips/${trip.id}/weather/refresh`;
  return { agent, trip, path };
}

function forecast(temperature = 22, dates = [DAY, NEXT]) {
  return new Response(JSON.stringify({ daily: { time: dates, weather_code: dates.map(() => 0), temperature_2m_max: dates.map(() => temperature) } }));
}

describe("POST /api/trips/:id/weather/refresh", () => {
  it("automatically backfills missing Rome weather on retrieval and reuses it on subsequent reads", async () => {
    const { agent, trip } = await setup();
    const before = trip.toObject();
    const fetch = vi.fn(async () => forecast()); vi.stubGlobal("fetch", fetch);
    const loaded = await agent.get(`/api/trips/${trip.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.weatherAvailability.status).toBe("available");
    expect(loaded.body.weather).toHaveLength(2);
    const after = (await TripModel.findById(trip._id))!.toObject();
    expect(after.weather).toEqual(loaded.body.weather);
    expect(after.weatherFetchedAt).toEqual(NOW);
    const unrelated = (record: typeof after) => {
      const { weather, weatherFetchedAt, weatherAvailability, updatedAt, ...rest } = record;
      return rest;
    };
    expect(unrelated(after)).toEqual(unrelated(before));
    expect((await agent.get(`/api/trips/${trip.id}`)).body.weather).toEqual(loaded.body.weather);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves edited routes, times, budget and a new regeneration preview during weather refresh", async () => {
    const { agent, trip, path } = await setup();
    const reordered = await editTripItinerary(trip.id, trip.user.toString(), {
      expectedVersion: 8, operation: { type: "reorder", dayIndex: 1, attractionIds: ["node/2", "node/1"] },
    }, { provider: null });
    expect(reordered.itineraryVersion).toBe(9);
    const preview = await createDayRegenerationPreview({ trip: reordered.trip, dayIndex: 1,
      preferences: relaxedPreferences, provider: null, fetchCandidates: async () => [], now: NOW });
    const before = (await TripModel.findById(trip._id))!.toObject();
    const fetch = vi.fn(async () => forecast()); vi.stubGlobal("fetch", fetch);
    const response = await agent.post(path).set("Origin", env.WEB_ORIGIN);
    expect(response.status).toBe(200);
    expect(response.body.weatherAvailability.status).toBe("available");
    const refreshed = (await TripModel.findById(trip._id))!;
    const after = refreshed.toObject();
    expect(after.itinerary).toEqual(before.itinerary);
    expect(after.regeneration).toEqual(before.regeneration);
    expect(after.expenses).toEqual(before.expenses);
    expect(after.budgetAllocations).toEqual(before.budgetAllocations);
    expect(after.analysis).toEqual(before.analysis);
    expect(after.attractions).toEqual(before.attractions);
    expect(after.itineraryVersion).toBe(9);
    const applied = await applyDayRegeneration(refreshed, preview.previewId, 1);
    expect(applied.itineraryVersion).toBe(10);
    expect(applied.toObject().weather).toEqual(after.weather);
    expect(applied.toObject().expenses).toEqual(before.expenses);
    expect(applied.toObject().itinerary!.days[1]).toEqual(before.itinerary!.days[1]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps recovered weather and financial data through removal/recalculation and rejects a stale preview", async () => {
    const { agent, trip, path } = await setup();
    const fetch = vi.fn(async () => forecast()); vi.stubGlobal("fetch", fetch);
    expect((await agent.post(path).set("Origin", env.WEB_ORIGIN)).status).toBe(200);
    const ready = (await TripModel.findById(trip._id))!;
    const preview = await createDayRegenerationPreview({ trip: ready, dayIndex: 1,
      preferences: relaxedPreferences, provider: null, fetchCandidates: async () => [], now: NOW });
    const stale = (await TripModel.findById(trip._id))!;
    const before = stale.toObject();
    const removed = await editTripItinerary(trip.id, trip.user.toString(), {
      expectedVersion: 8, operation: { type: "remove", dayIndex: 1, attractionId: "node/1" },
    }, { provider: null });
    const recalculated = await editTripItinerary(trip.id, trip.user.toString(), {
      expectedVersion: removed.itineraryVersion, operation: { type: "reroute", dayIndex: 1 },
    }, { provider: null });
    const after = recalculated.trip.toObject();
    expect(after.weather).toEqual(before.weather);
    expect(after.weatherAvailability).toEqual(before.weatherAvailability);
    expect(after.weatherFetchedAt).toEqual(before.weatherFetchedAt);
    expect(after.analysis).toEqual(before.analysis);
    expect(after.expenses).toEqual(before.expenses);
    expect(after.budgetRevision).toBe(before.budgetRevision);
    expect(after.budgetAllocations).toEqual(before.budgetAllocations);
    expect(after.itinerary!.days[1]).toEqual(before.itinerary!.days[1]);
    expect(after.itinerary!.days[0].stops.map(p => p.placeId)).toEqual(["node/2"]);
    await expect(applyDayRegeneration(stale, preview.previewId, 1)).rejects.toThrow("itinerary changed");
    expect((await TripModel.findById(trip._id))!.toObject().itinerary).toEqual(after.itinerary);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects weather from an obsolete snapshot when a manual reorder finishes during the request", async () => {
    const { trip } = await setup();
    let finish!: (response: Response) => void;
    let notify!: () => void;
    const started = new Promise<void>(resolve => { notify = resolve; });
    const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; notify(); }));
    vi.stubGlobal("fetch", fetch);
    const pending = refreshTripWeather(trip, { force: true });
    const rejected = expect(pending).rejects.toMatchObject({ status: 409 });
    await started;
    vi.setSystemTime(new Date(NOW.getTime() + 1));
    const edited = await editTripItinerary(trip.id, trip.user.toString(), {
      expectedVersion: 8, operation: { type: "reorder", dayIndex: 1, attractionIds: ["node/2", "node/1"] },
    }, { provider: null });
    finish(forecast()); await rejected;
    const stored = (await TripModel.findById(trip._id))!.toObject();
    expect(stored.itinerary).toEqual(edited.trip.toObject().itinerary);
    expect(stored.itineraryVersion).toBe(9);
    expect(stored.weather).toEqual([]);
    expect(stored.expenses).toEqual(trip.toObject().expenses);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("generates a real itinerary after Prague coordinate recovery and supports subsequent manual editing", async () => {
    const { agent, trip } = await setup();
    const places = stops.map((p, index) => ({ ...p, lat: 50.08 + index * .001, lng: 14.43, visitDurationMinutes: 30 }));
    await TripModel.collection.updateOne({ _id: trip._id }, { $set: {
      status: "draft", itinerary: null, "analysis.destination": "Prague", "analysis.country": "Czech Republic", "analysis.location": {},
      attractions: places, attractionsFetchedAt: NOW, attractionsQuery: { lat: 50.08, lng: 14.43, interests: ["culture"] },
    } });
    const actual = await vi.importActual<typeof import("../services/tripPlanner.js")>("../services/tripPlanner.js");
    vi.mocked(planTrip).mockImplementationOnce(actual.planTrip);
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "geocoding-api.open-meteo.com") return Response.json({ results: [{ name: "Prague", country: "Czechia", country_code: "CZ", latitude: 50.08, longitude: 14.43 }] });
      if (url.hostname === "api.open-meteo.com") return forecast();
      throw new Error(`Unexpected provider request: ${url.hostname}`);
    });
    vi.stubGlobal("fetch", fetch);
    const generated = await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", env.WEB_ORIGIN);
    expect(generated.status).toBe(200);
    expect(generated.body.status).toBe("ready");
    const ready = (await TripModel.findById(trip._id))!;
    expect(ready.analysis.location).toMatchObject({ lat: 50.08, lng: 14.43 });
    expect(ready.itinerary!.days.every(d => d.timeZone === "Europe/Prague")).toBe(true);
    const selected = ready.itinerary!.days.find(d => d.stops.length)!;
    const removed = await editTripItinerary(trip.id, trip.user.toString(), {
      expectedVersion: ready.itineraryVersion, operation: { type: "remove", dayIndex: selected.dayIndex, attractionId: selected.stops[0].placeId! },
    }, { provider: null });
    expect(removed.itineraryVersion).toBe(ready.itineraryVersion + 1);
    expect(removed.trip.itinerary!.days.find(d => d.dayIndex === selected.dayIndex)!.stops).toHaveLength(selected.stops.length - 1);
    expect(removed.trip.toObject().weather).toEqual(ready.toObject().weather);
    expect(removed.trip.toObject().expenses).toEqual(ready.toObject().expenses);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("recovers the Rome scenario and preserves itinerary, order, times, routes, budget, expenses and previews", async () => {
    const { agent, trip, path } = await setup();
    const before = trip.toObject();
    const previousIssues = toTripDetail(trip).quality!.issues;
    expect(previousIssues.some(issue => issue.code.startsWith("WEATHER_"))).toBe(true);
    const fetch = vi.fn(async () => forecast()); vi.stubGlobal("fetch", fetch);
    const response = await agent.post(path).set("Origin", env.WEB_ORIGIN);
    expect(response.status).toBe(200);
    expect(response.body.weatherAvailability.status).toBe("available");
    expect(response.body.weather).toHaveLength(2);
    expect(response.body.weatherIssues).toEqual([]);
    const after = (await TripModel.findById(trip._id))!.toObject();
    const unrelated = (record: typeof after) => {
      const { weather, weatherFetchedAt, weatherAvailability, updatedAt, ...rest } = record;
      return rest;
    };
    expect(unrelated(after)).toEqual(unrelated(before));
    expect(after.itineraryVersion).toBe(8);
    expect(after.weatherAvailability?.status).toBe("available");
    const finalIssues = toTripDetail((await TripModel.findById(trip._id))!).quality!.issues;
    expect(finalIssues.filter(issue => !issue.code.startsWith("WEATHER_"))).toEqual(previousIssues.filter(issue => !issue.code.startsWith("WEATHER_")));
    expect(finalIssues.some(issue => issue.code.startsWith("WEATHER_"))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(aiService.parseTrip).not.toHaveBeenCalled(); expect(planTrip).not.toHaveBeenCalled();
    expect(Date.parse(after.weatherAvailability!.retryAfter!) - Date.parse(after.weatherAvailability!.checkedAt!)).toBe(600_000);
    const retry = await agent.post(path).set("Origin", env.WEB_ORIGIN);
    expect(retry.status).toBe(200);
    expect(retry.body.weather).toEqual(response.body.weather);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("persists meaningful temporary failure and prevents immediate retry storms", async () => {
    const { agent, trip, path } = await setup();
    const fetch = vi.fn(async () => new Response("", { status: 503 })); vi.stubGlobal("fetch", fetch);
    const failed = await agent.post(path).set("Origin", env.WEB_ORIGIN);
    expect(failed.status).toBe(200);
    expect(failed.body.weatherAvailability).toMatchObject({ status: "temporarily_unavailable", reason: "http_error", canRetry: true });
    expect(failed.body.weatherIssues[0].message).toBe("Weather information is temporarily unavailable. Try again.");
    await agent.post(path).set("Origin", env.WEB_ORIGIN);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((await TripModel.findById(trip._id))?.itineraryVersion).toBe(8);
  });

  it("reports provider rate limiting without exceeding Retry-After", async () => {
    const { agent, path } = await setup();
    const fetch = vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "60" } })); vi.stubGlobal("fetch", fetch);
    const response = await agent.post(path).set("Origin", env.WEB_ORIGIN);
    expect(response.body.weatherAvailability.status).toBe("rate_limited");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated and foreign-trip requests", async () => {
    const { agent, trip } = await setup();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await request(app).post(`/api/trips/${trip.id}/weather/refresh`).set("Origin", env.WEB_ORIGIN)).status).toBe(401);
    const foreign = await TripModel.create({ user: new mongoose.Types.ObjectId(), analysis: trip.toObject().analysis });
    expect((await agent.post(`/api/trips/${foreign.id}/weather/refresh`).set("Origin", env.WEB_ORIGIN)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not query future-only dates and persists the correct quality warning", async () => {
    const { agent, trip, path } = await setup();
    const future = addDays(DAY, 30);
    await TripModel.updateOne({ _id: trip._id }, { $set: { "analysis.startDate": future, "analysis.endDate": addDays(future, 1) } });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await agent.post(path).set("Origin", env.WEB_ORIGIN);
    expect(response.body.weatherAvailability).toMatchObject({ status: "not_yet_available", canRetry: true });
    expect(response.body.weatherIssues[0].message).toContain("Forecast not available yet");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns partial days and diagnoses only the missing itinerary day", async () => {
    const { agent, path } = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => forecast(22, [NEXT])));
    const response = await agent.post(path).set("Origin", env.WEB_ORIGIN);
    expect(response.body.weatherAvailability.status).toBe("partial");
    expect(response.body.weather.map((day: { date: string }) => day.date)).toEqual([NEXT]);
    expect(response.body.weatherIssues).toHaveLength(1);
    expect(response.body.weatherIssues[0].dayId).toBe("1");
  });

  it("resolves missing coordinates using Step 11.1A before refreshing", async () => {
    const { agent, trip, path } = await setup();
    await TripModel.collection.updateOne({ _id: trip._id }, { $set: { "analysis.location": {} } });
    const fetch = vi.fn(async (url: string) => url.includes("geocoding")
      ? new Response(JSON.stringify({ results: [{ name: "Rome", country: "Italy", latitude: 41.9, longitude: 12.5 }] })) : forecast());
    vi.stubGlobal("fetch", fetch);
    const response = await agent.post(path).set("Origin", env.WEB_ORIGIN);
    expect(response.status).toBe(200); expect(response.body.weatherAvailability.status).toBe("available");
    expect((await TripModel.findById(trip._id))?.analysis.location).toMatchObject({ lat: 41.9, lng: 12.5 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects refresh while generation owns the trip", async () => {
    const { agent, trip, path } = await setup();
    await TripModel.updateOne({ _id: trip._id }, { $set: { status: "generating" } });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await agent.post(path).set("Origin", env.WEB_ORIGIN)).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares concurrent refreshes for the same saved snapshot", async () => {
    const { trip } = await setup();
    const fetch = vi.fn(async () => forecast()); vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([refreshTripWeather(trip, { force: true }), refreshTripWeather(trip, { force: true })]);
    expect(first.weather).toHaveLength(2); expect(second.weather).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("prevents an older request from overwriting newer saved weather or concurrent edits", async () => {
    const { trip } = await setup();
    let resolveOld!: (response: Response) => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    const fetch = vi.fn().mockImplementationOnce(() => { notifyStarted(); return new Promise<Response>(resolve => { resolveOld = resolve; }); })
      .mockResolvedValueOnce(forecast(30));
    vi.stubGlobal("fetch", fetch);
    const first = refreshTripWeather(trip, { force: true });
    const rejected = expect(first).rejects.toMatchObject({ status: 409 });
    await started;
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    await TripModel.updateOne({ _id: trip._id }, { $set: { "analysis.notes": "New edit", "weatherAvailability.retryAfter": null, updatedAt: new Date(trip.updatedAt.getTime() + 1000) } });
    const newer = (await TripModel.findById(trip._id))!;
    await refreshTripWeather(newer, { force: true });
    resolveOld(forecast(20)); await rejected;
    const stored = (await TripModel.findById(trip._id))!;
    expect(stored.weather[0].temperatureMax).toBe(30);
    expect(stored.analysis.notes).toBe("New edit"); expect(stored.itineraryVersion).toBe(8);
  });

  it("keeps a shared refresh alive when only one caller cancels", async () => {
    const { trip } = await setup();
    let resolveFetch!: (response: Response) => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    const fetch = vi.fn(() => new Promise<Response>(resolve => { resolveFetch = resolve; notifyStarted(); })); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const first = refreshTripWeather(trip, { force: true, signal: controller.signal });
    const second = refreshTripWeather(trip, { force: true });
    const rejected = expect(first).rejects.toThrow(); controller.abort();
    // Allow destination recovery's synchronous reuse to reach the provider request.
    await started;
    resolveFetch(forecast());
    await rejected; expect((await second).weather).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
