import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import { ASKABLE_FIELDS, type TripAnalysis } from "@triply/shared";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { handoffs } from "../models/GuestHandoff.js";
import { guestActivityWrites } from "../middleware/guestActivity.js";
import { fetchAttractions } from "./attractions.js";
import { backfillTripAttractions, confirmTripRequirements, saveTripRequirements, toTripDetail } from "./tripDraft.js";

vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
vi.mock("./attractions.js", () => ({ fetchAttractions: vi.fn() }));
vi.mock("./weather.js", async original => ({
  ...await original<typeof import("./weather.js")>(),
  ensureWeatherData: vi.fn(async () => ({ days: [], fetchedAt: null })),
}));

const owner = new mongoose.Types.ObjectId();
const analysis: TripAnalysis = {
  destination: "Paris", country: "France", startDate: "2030-06-01", endDate: "2030-06-01",
  durationDays: 1, travelers: 2, budget: { amount: 500, currency: "EUR", type: "total" },
  interests: ["culture"], pace: "balanced", maxWalkingDistanceKm: 5, notes: null,
  location: { lat: 48.85, lng: 2.35 },
};
const rome = { lat: 41.9, lng: 12.5 };
const place = { name: "Paris museum", category: "culture", lat: 48.85, lng: 2.35, placeId: "node/1", score: 80 };
let mongo: MongoMemoryReplSet;
let app: FastifyInstance;
async function load(trip: TripDocument) { return TripModel.findById(trip._id).orFail().exec(); }
async function legacyDraft() {
  const trip = await TripModel.create({ user: owner, analysis });
  // Raw insertion models old data that current request validators would reject.
  await TripModel.collection.updateOne({ _id: trip._id }, { $set: { "analysis.location": { lat: 999, lng: 2.35 } } });
  return load(trip);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
/** Pause immediately before the native write, after the confirmation snapshot check. */
function pauseWrite() {
  const entered = deferred(), gate = deferred();
  const original = TripModel.collection.findOneAndUpdate;
  vi.spyOn(TripModel.collection, "findOneAndUpdate").mockImplementationOnce(async (...args) => {
    entered.resolve(); await gate.promise;
    return original.apply(TripModel.collection, args);
  });
  return { entered: entered.promise, release: gate.resolve };
}
function call(cookie: string | undefined, url: string, payload?: Record<string, unknown>) {
  return app.inject({ method: "POST", url, headers: { origin: env.WEB_ORIGIN, ...(cookie ? { cookie } : {}) },
    ...(payload ? { payload } : {}) });
}
function cookieOf(response: { headers: Record<string, unknown> }) { return String(response.headers["set-cookie"]).split(";")[0]; }
async function guestDraft() {
  const response = await call(undefined, "/api/auth/guest");
  expect(response.statusCode).toBe(200);
  const id = response.json().guest.id as string;
  const trip = await TripModel.create({ guestId: id, guestSlot: 0, analysis });
  return { id, trip, cookie: cookieOf(response) };
}

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await TripModel.init();
  app = await createApp();
}, 120_000);
beforeEach(() => {
  vi.mocked(fetchAttractions).mockReset().mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected live provider request"); }));
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const collection of await mongoose.connection.db!.listCollections().toArray()) {
    await mongoose.connection.db!.collection(collection.name).deleteMany({});
  }
});
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });

describe("requirements confirmation persistence", () => {
  it("preserves Rome coordinates repaired by real requirements persistence after legacy snapshot A was loaded", async () => {
    const snapshotA = await legacyDraft();
    const snapshotB = await load(snapshotA);
    const repaired = await saveTripRequirements(snapshotB, { destination: "Rome", country: "Italy", location: rome }, []);
    expect(repaired.analysis.location).toMatchObject(rome);

    const outcome = await confirmTripRequirements(snapshotA).catch((error: unknown) => error);
    const saved = await load(snapshotA);
    expect(saved.analysis.location).toMatchObject(rome);
    expect(saved.analysis.destination).toBe("Rome");
    expect(saved.analysis.country).toBe("Italy");
    expect(outcome).toMatchObject({ status: 409, expose: true });
    expect(saved.toObject()).toEqual(repaired.toObject());
  });

  it.each(["before-read", "before-write"] as const)("rejects concurrent requirements changes %s even with identical timestamps", async when => {
    vi.spyOn(mongoose, "now").mockReturnValue(new Date("2030-01-01T00:00:00Z"));
    const trip = await TripModel.create({ user: owner, analysis });
    const pause = when === "before-write" ? pauseWrite() : undefined;
    const pending = pause ? confirmTripRequirements(trip).catch((error: unknown) => error) : undefined;
    if (pause) await pause.entered;
    try {
      const edited = await saveTripRequirements(await load(trip), { pace: "relaxed" }, []);
      expect(edited.updatedAt).toEqual(trip.updatedAt);
      const before = await TripModel.collection.findOne({ _id: trip._id });
      pause?.release();
      const outcome = await (pending ?? confirmTripRequirements(trip).catch((error: unknown) => error));
      expect(outcome).toMatchObject({ status: 409, expose: true });
      expect(await TripModel.collection.findOne({ _id: trip._id })).toEqual(before);
    } finally { pause?.release(); await pending; }
  });

  it("serializes two simultaneous confirmations with a controlled losing conflict", async () => {
    const trip = await TripModel.create({ user: owner, analysis });
    const second = await load(trip);
    const results = await Promise.allSettled([confirmTripRequirements(trip), confirmTripRequirements(second)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409, expose: true } });
    const saved = await load(trip);
    expect(saved.confirmedFields).toEqual(ASKABLE_FIELDS);
    expect(saved.toObject().analysis).toEqual(trip.toObject().analysis);
    // A new confirmation of current state remains supported.
    expect(toTripDetail(await confirmTripRequirements(saved)).requirementsComplete).toBe(true);
  });

  it.each(["delete", "transfer", "generating"] as const)("rejects a %s between snapshot validation and atomic persistence", async change => {
    const trip = await legacyDraft();
    const pause = pauseWrite();
    const pending = confirmTripRequirements(trip).catch((error: unknown) => error);
    await pause.entered;
    try {
      if (change === "delete") await TripModel.collection.deleteOne({ _id: trip._id });
      else await TripModel.collection.updateOne({ _id: trip._id }, { $set: change === "transfer"
        ? { user: new mongoose.Types.ObjectId() } : { status: "generating" } });
      const before = await TripModel.collection.findOne({ _id: trip._id });
      pause.release();
      expect(await pending).toMatchObject({ status: 409, expose: true });
      expect(await TripModel.collection.findOne({ _id: trip._id })).toEqual(before);
    } finally { pause.release(); await pending; }
  });

  it("fences a paused guest confirmation after real guest-to-account migration", async () => {
    const source = await guestDraft();
    const entered = deferred(), gate = deferred();
    const original = guestActivityWrites.check;
    vi.spyOn(guestActivityWrites, "check").mockImplementationOnce(async (...args) => {
      entered.resolve(); await gate.promise; return original(...args);
    });
    const pending = call(source.cookie, `/api/trips/${source.trip.id}/confirm`).then(response => response);
    await entered.promise;
    try {
      const account = await call(source.cookie, "/api/auth/register", { email: "confirmation@example.com", password: "Password123!Aa" });
      expect(account.statusCode).toBe(201);
      const cookie = cookieOf(account);
      expect((await call(cookie, "/api/auth/guest-migration/confirm")).statusCode).toBe(409);
      // Expire only this disposable fixture's durable lease; no sleeps or clock races.
      await handoffs().updateOne({ _id: source.id }, { $set: { "activeRequests.$[].expiresAt": new Date(0) } });
      expect((await call(cookie, "/api/auth/guest-migration/confirm")).statusCode).toBe(200);
      const imported = await TripModel.collection.findOne({ _id: source.trip._id });
      const fence = await handoffs().findOne({ _id: source.id });
      gate.resolve();
      expect((await pending).statusCode).toBe(409);
      expect(await TripModel.collection.findOne({ _id: source.trip._id })).toEqual(imported);
      expect(await handoffs().findOne({ _id: source.id })).toEqual(fence);
      expect((await load(source.trip)).user?.toString()).toBe(account.json().user.id);
    } finally { gate.resolve(); await pending; }
  });

  it("preserves enrichment that commits while confirmation is paused", async () => {
    const trip = await TripModel.create({ user: owner, analysis });
    const pause = pauseWrite();
    const pending = confirmTripRequirements(trip);
    await pause.entered;
    try {
      vi.mocked(fetchAttractions).mockResolvedValueOnce([place]);
      const enriched = await backfillTripAttractions(await load(trip));
      expect(enriched.attractions).toHaveLength(1);
      pause.release();
      const confirmed = await pending;
      expect(confirmed.toObject().attractions).toEqual(enriched.toObject().attractions);
      expect(confirmed.toObject().clustering).toEqual(enriched.toObject().clustering);
      expect(confirmed.confirmedFields).toEqual(ASKABLE_FIELDS);
    } finally { pause.release(); await pending; }
  });

  it("keeps confirmation authoritative when an older backfill finishes later", async () => {
    const trip = await TripModel.create({ user: owner, analysis });
    const entered = deferred(), gate = deferred();
    vi.mocked(fetchAttractions).mockImplementationOnce(async () => { entered.resolve(); await gate.promise; return [place]; });
    const pending = backfillTripAttractions(trip);
    await entered.promise;
    try {
      const confirmed = await confirmTripRequirements(await load(trip));
      gate.resolve();
      await pending;
      const saved = await load(trip);
      expect(saved.confirmedFields).toEqual(ASKABLE_FIELDS);
      expect(saved.missingFields).toEqual([]);
      expect(saved.toObject().analysis).toEqual(confirmed.toObject().analysis);
      expect(saved.itineraryVersion).toBe(confirmed.itineraryVersion);
    } finally { gate.resolve(); await pending; }
  });

  it.each(["malformed", "absent"] as const)("normalizes %s legacy coordinates without changing unrelated persisted data", async kind => {
    const trip = await legacyDraft();
    if (kind === "absent") await TripModel.collection.updateOne({ _id: trip._id }, { $unset: {
      "analysis.location": "", "analysis.destinationId": "", confirmedFields: "", missingFields: "",
    } });
    const before = await load(trip);
    const confirmed = await confirmTripRequirements(before);
    expect(confirmed.analysis.location).toBeNull();
    expect(confirmed.confirmedFields).toEqual(ASKABLE_FIELDS);
    expect(confirmed.missingFields).toEqual([]);
    expect(confirmed.analysis.destination).toBe("Paris");
    expect(fetch).not.toHaveBeenCalled();
    expect((await load(trip)).analysis.location).toBeNull();
  });

  it("does not persist dirty unrelated fields or alter itinerary, visit, budget or generation revisions", async () => {
    const trip = await TripModel.create({ user: owner, analysis, status: "ready", itineraryVersion: 7,
      visitRevision: 3, budgetRevision: 5,
      itinerary: { timeZone: "Europe/Paris", routingSource: "approximation", days: [], unscheduled: [] } });
    const before = await TripModel.collection.findOne({ _id: trip._id });
    trip.prompt = "Unsaved unrelated text";
    trip.budgetRevision = 99;
    const confirmed = await confirmTripRequirements(trip);
    const after = await TripModel.collection.findOne({ _id: trip._id });
    for (const key of ["prompt", "status", "itinerary", "itineraryVersion", "visitRevision", "budgetRevision",
      "visits", "expenses", "automaticAdmissions", "equipment", "generation", "weather", "attractions"] as const) {
      expect(after?.[key], key).toEqual(before?.[key]);
    }
    expect(confirmed.budgetRevision).toBe(5);
  });

  it.each(["conflict", "database-failure"] as const)("rolls back the guest fence and confirmation during %s", async failure => {
    const source = await guestDraft();
    const before = await TripModel.collection.findOne({ _id: source.trip._id });
    const fenceBefore = await handoffs().findOne({ _id: source.id });
    const original = TripModel.collection.findOneAndUpdate;
    const pause = failure === "conflict" ? pauseWrite() : undefined;
    if (failure === "database-failure") vi.spyOn(TripModel.collection, "findOneAndUpdate").mockImplementationOnce(async (...args) => {
      await original.apply(TripModel.collection, args);
      throw new Error("Interrupted after confirmation write");
    });
    const pending = call(source.cookie, `/api/trips/${source.trip.id}/confirm`).then(response => response);
    try {
      if (pause) {
        await pause.entered;
        await saveTripRequirements(await load(source.trip), { pace: "relaxed" }, []);
        pause.release();
      }
      const response = await pending;
      expect(response.statusCode, response.body).toBe(failure === "conflict" ? 409 : 503);
      const after = await TripModel.collection.findOne({ _id: source.trip._id });
      if (failure === "database-failure") expect(after).toEqual(before);
      else {
        expect(after?.analysis.pace).toBe("relaxed");
        expect(after?.confirmedFields).toEqual([]);
      }
      const fenceAfter = await handoffs().findOne({ _id: source.id });
      expect(fenceAfter?.writeRevision).toBe(fenceBefore?.writeRevision);
      expect(fenceAfter?.activeRequests).toEqual([]);
    } finally { pause?.release(); await pending; }
  });

  it("keeps successful and incomplete guest HTTP confirmation contracts", async () => {
    const source = await guestDraft();
    const response = await call(source.cookie, `/api/trips/${source.trip.id}/confirm`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ id: source.trip.id, status: "draft", requirementsComplete: true, missingFields: [] });
    expect((await handoffs().findOne({ _id: source.id }))?.writeRevision).toBe(1);
    await TripModel.collection.updateOne({ _id: source.trip._id }, { $set: {
      "analysis.destination": null, confirmedFields: [], missingFields: ["destination"],
    } });
    const before = await TripModel.collection.findOne({ _id: source.trip._id });
    const rejected = await call(source.cookie, `/api/trips/${source.trip.id}/confirm`);
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().missingFields).toContain("destination");
    expect(await TripModel.collection.findOne({ _id: source.trip._id })).toEqual(before);
    expect((await handoffs().findOne({ _id: source.id }))?.writeRevision).toBe(1);
  });
});
