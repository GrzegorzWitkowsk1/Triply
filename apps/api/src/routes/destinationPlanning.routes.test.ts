import { afterAll, beforeAll, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { seedDestinations } from "../seed/destinations.js";
import { DestinationModel } from "../models/Destination.js";
import { TripModel } from "../models/Trip.js";
import { aiService } from "../ai/index.js";
import { resolveDestination } from "../services/location.js";
import { env } from "../config/env.js";

vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
vi.mock("../ai/index.js", () => ({ aiService: { parseTrip: vi.fn(async () => ({ destination: "Rome", country: "Italy", location: { lat: 41.9, lng: 12.5 },
  startDate: null, endDate: null, durationDays: null, travelers: 1, budget: { amount: 500, currency: "EUR", type: "total" }, interests: ["food"], pace: "balanced", maxWalkingDistanceKm: 5, notes: null })) } }));
vi.mock("../services/location.js", async original => ({ ...await original<typeof import("../services/location.js")>(), resolveDestination: vi.fn(async (city: string, country: string) => ({ lat: 41.3874, lng: 2.1686, city, country })) }));
vi.mock("../services/weather.js", async original => ({ ...await original<typeof import("../services/weather.js")>(), ensureWeatherData: vi.fn(async () => ({ days: [], fetchedAt: new Date() })) }));
vi.mock("../services/attractions.js", () => ({ fetchAttractions: vi.fn(async () => []) }));
let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await seedDestinations(); app = await createApp(); }, 120_000);
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });
it("resolves the canonical city and country publicly without geocoding, sessions, trips or quota consumption", async () => {
  const response = await app.inject({ url: "/api/destinations/city-003?lat=0&lng=0" });
  expect(response.statusCode).toBe(200); expect(response.cookies).toEqual([]);
  expect(response.json()).toMatchObject({ id: "city-003", city: "Barcelona", country: "Spain" });
  for (const key of ["_id", "coordinates", "location", "user", "ownerId", "searchText"]) expect(response.json()).not.toHaveProperty(key);
  expect(resolveDestination).not.toHaveBeenCalled(); expect(aiService.parseTrip).not.toHaveBeenCalled();
  expect(await TripModel.countDocuments()).toBe(0);
  expect(await mongoose.connection.db!.collection("guest_usage").countDocuments()).toBe(0);
  expect(await mongoose.connection.db!.collection("sessions").countDocuments()).toBe(0);
});
it.each(["not-an-id", "city-003%25", "x".repeat(150)])("rejects malformed ID %s", async value => {
  expect((await app.inject({ url: `/api/destinations/${value}` })).statusCode).toBe(400);
});
it("returns recoverable 404s for unknown, deleted and incomplete destinations", async () => {
  expect((await app.inject({ url: "/api/destinations/city-999" })).statusCode).toBe(404);
  await DestinationModel.updateOne({ id: "city-003" }, { $set: { country: "" } });
  expect((await app.inject({ url: "/api/destinations/city-003" })).statusCode).toBe(404);
  await DestinationModel.updateOne({ id: "city-003" }, { $set: { country: "Spain" } });
  await DestinationModel.deleteOne({ id: "city-004" });
  expect((await app.inject({ url: "/api/destinations/city-004" })).statusCode).toBe(404);
  await seedDestinations();
});
it.each(["guest", "register"] as const)("keeps selected destination authoritative for %s and reuses geocoding safeguards", async kind => {
  const session = await app.inject({ method: "POST", url: `/api/auth/${kind}`, headers: { origin: env.WEB_ORIGIN },
    ...(kind === "register" ? { payload: { email: "planning@example.com", password: "Original123!Aa" } } : {}) });
  const headers = { origin: env.WEB_ORIGIN, cookie: session.cookies.map(row => `${row.name}=${row.value}`).join("; ") };
  const earlier = kind === "register" ? await TripModel.create({ user: session.json().user.id, status: "draft", prompt: "Keep my Rome work", analysis: { destination: "Rome", country: "Italy" } }) : null;
  const result = await app.inject({ method: "POST", url: "/api/trips/analyze", headers, payload: { destinationId: "city-003", prompt: "Plan Rome", location: { lat: 0, lng: 0 }, badges: ["food"] } });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().analysis).toMatchObject({ destinationId: "city-003", destination: "Barcelona", country: "Spain", location: { lat: 41.3874, lng: 2.1686 } });
  expect(resolveDestination).toHaveBeenCalledWith("Barcelona", "Spain");
  expect(aiService.parseTrip).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("selected destination is Barcelona, Spain") }));
  const stored = await TripModel.findById(result.json().draftId).lean();
  if (earlier) {
    expect(stored?._id.toString()).not.toBe(earlier.id);
    expect(await TripModel.findById(earlier.id).lean()).toMatchObject({ prompt: "Keep my Rome work", analysis: { destination: "Rome", country: "Italy" } });
  }
  expect(stored?.analysis).toMatchObject({ destinationId: "city-003", destination: "Barcelona", country: "Spain" });
  expect(await mongoose.connection.db!.collection("guest_usage").countDocuments()).toBe(0);
  const unknown = await app.inject({ method: "POST", url: "/api/trips/analyze", headers, payload: { destinationId: "city-999", prompt: "Rome" } });
  expect(unknown.statusCode).toBe(404);
});

it("persists explicitly selected editable preferences instead of parser suggestions, without consuming generation quota", async () => {
  const session = await app.inject({ method: "POST", url: "/api/auth/guest", headers: { origin: env.WEB_ORIGIN } });
  const headers = { origin: env.WEB_ORIGIN, cookie: session.cookies.map(row => `${row.name}=${row.value}`).join("; ") };
  const result = await app.inject({ method: "POST", url: "/api/trips/analyze", headers,
    payload: { destinationId: "city-003", prompt: "Barcelona", badges: ["culture"], interests: ["culture", "nature"], pace: "relaxed" } });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().analysis).toMatchObject({ destinationId: "city-003", interests: ["culture", "nature"], pace: "relaxed" });
  expect((await TripModel.findById(result.json().draftId).lean())?.analysis).toMatchObject({ interests: ["culture", "nature"], pace: "relaxed" });
  const reviewed = await app.inject({ method: "PATCH", url: `/api/trips/${result.json().draftId}/requirements`, headers,
    payload: { answers: { interests: ["Nature", "food", "nature"], pace: "balanced" }, confirmedFields: [] } });
  expect(reviewed.statusCode, reviewed.body).toBe(200);
  expect(reviewed.json().analysis).toMatchObject({ interests: ["nature", "food"], pace: "balanced" });
  expect((await TripModel.findById(result.json().draftId).lean())?.analysis.interests).toEqual(["nature", "food"]);
  expect(await mongoose.connection.db!.collection("guest_usage").countDocuments()).toBe(0);
  const invalid = await app.inject({ method: "POST", url: "/api/trips/analyze", headers,
    payload: { prompt: "Barcelona", interests: ["x".repeat(61)] } });
  expect(invalid.statusCode).toBe(400);
});
