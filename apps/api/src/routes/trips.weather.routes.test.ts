import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import type { MemoryStore } from "express-rate-limit";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { addDays } from "@triply/shared";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { aiService } from "../ai/index.js";
import { planTrip } from "../services/tripPlanner.js";
import { destinationToday } from "../services/weather.js";
import { refreshTripWeather } from "../services/tripWeather.js";
import { toTripDetail } from "../services/tripDraft.js";

vi.mock("../ai/index.js", () => ({ aiService: { parseTrip: vi.fn(), parseRegeneration: vi.fn() } }));
vi.mock("../services/tripPlanner.js", () => ({ planTrip: vi.fn() }));
const stores = vi.hoisted(() => [] as MemoryStore[]);
vi.mock("express-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("express-rate-limit")>();
  return { ...actual, rateLimit: (options: Parameters<typeof actual.rateLimit>[0]) => {
    const store = new actual.MemoryStore(); stores.push(store); return actual.rateLimit({ ...options, store });
  } };
});

let app: Express;
let mongod: MongoMemoryServer;
const DAY = destinationToday(41.9, 12.5).today;
const NEXT = addDays(DAY, 1);
const stops = [
  { placeId: "node/1", name: "Colosseum", category: "culture", lat: 41.89, lng: 12.49 },
  { placeId: "node/2", name: "Forum", category: "culture", lat: 41.892, lng: 12.485 },
];
const itineraryDay = (date: string, dayIndex: number) => ({ dayIndex, date, timeZone: "Europe/Rome", stops,
  activities: stops.map((stop, i) => ({ type: "attraction", placeId: stop.placeId, title: stop.name,
    startTime: `${date}T${i === 0 ? "09" : "10"}:00:00`, endTime: `${date}T${i === 0 ? "10" : "11"}:00:00`, durationMinutes: 60 })),
  geometry: { type: "LineString", coordinates: [[12.49, 41.89], [12.485, 41.892]] },
  segments: [], totalVisitMinutes: 120, totalTravelMinutes: 0, totalDistanceMeters: 0, partiallyEstimated: false, warnings: [] });

beforeAll(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()); app = (await import("../app.js")).createApp(); }, 120_000);
afterEach(async () => {
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
