import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { TripAttraction } from "@triply/shared";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { fetchAttractions } from "./attractions.js";
import { backfillTripAttractions, saveTripRequirements, toTripDetail } from "./tripDraft.js";
import { itineraryCandidates } from "./tripItineraryEditor.js";
import { claimTripForGeneration, runTripGeneration } from "./tripGeneration.js";
import { env } from "../config/env.js";

vi.mock("./attractions.js", () => ({ fetchAttractions: vi.fn() }));
vi.mock("./weather.js", async importOriginal => ({
  ...await importOriginal<typeof import("./weather.js")>(),
  ensureWeatherData: vi.fn(async () => ({ days: [], fetchedAt: null })),
}));
vi.mock("../routing/index.js", () => ({ createRoutingProvider: () => null }));

const owner = new mongoose.Types.ObjectId();
const oldPlace: TripAttraction = { name: "Old Paris museum", category: "culture", lat: 48.85, lng: 2.35, placeId: "node/1", visitDurationMinutes: 30, score: 80 };
const newPlace: TripAttraction = { ...oldPlace, name: "Current museum", lat: 48.851, lng: 2.351, placeId: "node/2" };
const analysis = {
  destination: "Paris", country: "France", startDate: "2030-06-01", endDate: "2030-06-01",
  durationDays: 1, travelers: 2, budget: { amount: 500, currency: "EUR", type: "total" },
  interests: ["culture"], pace: "balanced", maxWalkingDistanceKm: 5, notes: null,
  location: { lat: 48.85, lng: 2.35 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function delayedAttractions() {
  const started = deferred<void>();
  const response = deferred<TripAttraction[] | null>();
  vi.mocked(fetchAttractions).mockImplementationOnce(() => {
    started.resolve();
    return response.promise;
  });
  return { started: started.promise, release: response.resolve };
}

async function draft(guest = false) {
  return TripModel.create({ ...(guest ? { guestId: "a".repeat(32), guestSlot: 0 } : { user: owner }), status: "draft", analysis });
}

async function load(trip: TripDocument) {
  return TripModel.findById(trip._id).orFail().exec();
}

const backfill = backfillTripAttractions;

async function generate(trip: TripDocument) {
  const claimed = await claimTripForGeneration(trip.id, owner.toString(), trip.updatedAt);
  expect(claimed).not.toBeNull();
  return runTripGeneration(claimed!);
}

async function legacyReady() {
  const trip = await generate(await draft());
  // Legacy persisted itineraries can exist without the subsequently added pool.
  await TripModel.collection.updateOne({ _id: trip._id }, { $unset: {
    attractions: "", attractionsFetchedAt: "", attractionsQuery: "", clustering: "",
    "analysis.destinationId": "", "analysis.location.city": "", "analysis.location.country": "",
  } });
  return load(trip);
}

let database: MongoMemoryServer;
beforeAll(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  await TripModel.init();
}, 120_000);
beforeEach(() => {
  vi.mocked(fetchAttractions).mockReset().mockResolvedValue([newPlace]);
  // Fail closed if a test accidentally reaches any unmocked provider.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected live provider request"); }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await TripModel.deleteMany({});
});
afterAll(async () => { await mongoose.disconnect(); await database?.stop(); });

describe("attraction backfill persistence", () => {
  it.each(["destination", "pace"] as const)("discards enrichment when %s requirements change during the lookup", async change => {
    const trip = await draft();
    const provider = delayedAttractions();
    const pending = backfill(trip);
    await provider.started;
    const changed = await saveTripRequirements(await load(trip), change === "destination"
      ? { destination: "Rome", country: "Italy", location: { lat: 41.9, lng: 12.5 }, interests: ["food"] }
      : { pace: "relaxed" }, []);
    const authoritative = changed.toObject();
    provider.release([oldPlace]);
    const result = await pending;
    const saved = (await load(trip)).toObject();
    expect(saved.attractions).toEqual(authoritative.attractions);
    expect(saved.clustering).toEqual(authoritative.clustering);
    expect(saved.analysis).toEqual(authoritative.analysis);
    expect(saved.itineraryVersion).toBe(authoritative.itineraryVersion);
    expect(toTripDetail(result)).toEqual(toTripDetail(changed));
  });

  it.each([false, true])("preserves explicit discovery during legacy backfill (same timestamp: %s)", async sameTimestamp => {
    if (sameTimestamp) vi.spyOn(mongoose, "now").mockReturnValue(new Date("2030-01-01T00:00:00Z"));
    const trip = await legacyReady();
    const provider = delayedAttractions();
    const pending = backfill(trip);
    await provider.started;
    await itineraryCandidates(trip.id, owner.toString(), "", true);
    const current = await load(trip);
    expect(current.attractions.map(place => place.placeId)).toEqual([newPlace.placeId]);
    expect(current.itineraryVersion).toBe(trip.itineraryVersion);
    expect(current.__v).toBe(trip.__v);
    if (sameTimestamp) expect(current.updatedAt).toEqual(trip.updatedAt);
    provider.release([oldPlace]);
    const result = await pending;
    expect((await load(trip)).toObject()).toEqual(current.toObject());
    expect(toTripDetail(result)).toEqual(toTripDetail(current));
  });

  it.each(["claimed", "completed"] as const)("cannot replace candidates or clustering after generation is %s", async stage => {
    const trip = await draft();
    const provider = delayedAttractions();
    const pending = backfill(trip);
    await provider.started;
    const claimed = await claimTripForGeneration(trip.id, owner.toString(), trip.updatedAt);
    expect(claimed).not.toBeNull();
    const current = stage === "completed" ? await runTripGeneration(claimed!) : claimed!;
    provider.release([oldPlace]);
    const result = await pending;
    expect((await load(trip)).toObject()).toEqual(current.toObject());
    expect(toTripDetail(result)).toEqual(toTripDetail(current));
  });

  it("converges concurrent identical backfills without a losing stale save", async () => {
    const trip = await draft();
    const secondTrip = await load(trip);
    const bothStarted = deferred<void>();
    const response = deferred<TripAttraction[]>();
    let calls = 0;
    vi.mocked(fetchAttractions).mockImplementation(() => {
      if (++calls === 2) bothStarted.resolve();
      return response.promise;
    });
    const pending = Promise.all([backfill(trip), backfill(secondTrip)]);
    await bothStarted.promise;
    response.resolve([newPlace]);
    const results = await pending;
    const saved = await load(trip);
    expect(saved.attractions.map(place => place.placeId)).toEqual([newPlace.placeId]);
    expect(saved.clustering?.clusters.flatMap(cluster => cluster.pois.map(place => place.placeId))).toEqual([newPlace.placeId]);
    for (const result of results) expect(toTripDetail(result)).toEqual(toTripDetail(saved));
  });

  it("recovers a legacy pool without changing the saved itinerary or domain revisions", async () => {
    const trip = await legacyReady();
    const original = trip.toObject();
    const result = await backfill(trip);
    const saved = await load(trip);
    expect(saved.attractions.map(place => place.placeId)).toEqual([newPlace.placeId]);
    expect(saved.clustering?.clusters).toHaveLength(1);
    expect(saved.toObject().itinerary).toEqual(original.itinerary);
    expect(saved.itineraryVersion).toBe(original.itineraryVersion);
    expect(saved.visitRevision).toBe(original.visitRevision);
    expect(saved.budgetRevision).toBe(original.budgetRevision);
    expect(toTripDetail(result)).toEqual(toTripDetail(saved));
  });

  it("recovers guest drafts without persisting unrelated dirty document fields", async () => {
    const trip = await draft(true);
    const original = trip.toObject();
    trip.set("prompt", "Unsaved local value");
    trip.set("weather", [{ date: "2030-06-01", temperatureMax: 20, weatherCode: 0 }]);
    await backfill(trip);
    const saved = (await load(trip)).toObject();
    expect(saved.attractions.map(place => place.placeId)).toEqual([newPlace.placeId]);
    for (const key of ["guestId", "prompt", "weather", "expenses", "visits", "automaticAdmissions", "equipment", "budgetRevision", "visitRevision", "itineraryVersion"] as const) {
      expect(saved[key], key).toEqual(original[key]);
    }
  });

  it("returns authoritative HTTP detail after requirements change during a GET lookup", async () => {
    const app = await (await import("../app.js")).createApp();
    try {
      const registered = await app.inject({ method: "POST", url: "/api/auth/register", headers: { origin: env.WEB_ORIGIN },
        payload: { email: "backfill@example.com", password: "Password123!Aa" } });
      expect(registered.statusCode).toBe(201);
      const cookie = registered.cookies[0];
      const cookies = { [cookie.name]: cookie.value };
      const trip = await TripModel.create({ user: registered.json().user.id, status: "draft", analysis });
      const provider = delayedAttractions();
      const pending = app.inject({ method: "GET", url: `/api/trips/${trip.id}`, cookies }).then(response => response);
      await provider.started;
      const changed = await app.inject({ method: "PATCH", url: `/api/trips/${trip.id}/requirements`, cookies,
        headers: { origin: env.WEB_ORIGIN }, payload: { answers: { pace: "relaxed" }, confirmedFields: [] } });
      expect(changed.statusCode, changed.body).toBe(200);
      const current = await load(trip);
      provider.release([oldPlace]);
      const response = await pending;
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual(JSON.parse(JSON.stringify(toTripDetail(current))));
      expect((await load(trip)).toObject()).toEqual(current.toObject());
    } finally { await app.close(); }
  });

  it("does not resurrect or return a trip deleted during enrichment", async () => {
    const trip = await draft();
    const provider = delayedAttractions();
    const pending = backfill(trip);
    const rejected = expect(pending).rejects.toMatchObject({ status: 404, message: "Trip not found" });
    await provider.started;
    await TripModel.findOneAndDelete({ _id: trip._id, user: owner });
    provider.release([oldPlace]);
    await rejected;
    expect(await TripModel.findById(trip._id)).toBeNull();
  });
});
