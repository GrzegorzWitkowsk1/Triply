import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import argon2 from "argon2";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import type { TripAnalysis, ItineraryDay } from "@triply/shared";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { UserModel } from "../models/User.js";
import { handoffs } from "../models/GuestHandoff.js";
import { migrationWrites, MIGRATION_WINDOW_MS } from "../services/guestMigration.js";
import { reserveGuestDraft } from "../services/guestLimits.js";
import { storageId } from "../config/session.js";
import { hashShareToken } from "./sharing.js";
import { SavedDestinationModel } from "../models/SavedDestination.js";
import { SavedAttractionModel } from "../models/SavedAttraction.js";
import { mergeSnapshot, earliestSavedAt } from "../services/savedMigration.js";

vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
vi.mock("../services/weather.js", async original => ({ ...await original<typeof import("../services/weather.js")>(), ensureWeatherData: vi.fn(async () => ({ days: [], fetchedAt: new Date() })) }));
vi.mock("../services/attractions.js", () => ({ fetchAttractions: vi.fn(async () => []) }));
const analysis: TripAnalysis = { destination: "Paris", country: "France", startDate: "2030-06-02", endDate: "2030-06-02", durationDays: 1, travelers: 1, budget: { amount: 100, currency: "EUR", type: "total" }, interests: ["culture"], pace: "balanced", maxWalkingDistanceKm: 5, notes: "Manually edited notes", location: { lat: 48.85, lng: 2.35 } };
const day: ItineraryDay = { dayIndex: 1, date: "2030-06-02", timeZone: "Europe/Paris", activities: [{ type: "attraction", placeId: "node/1", title: "Edited museum", startTime: "2030-06-02T09:00:00+02:00", endTime: "2030-06-02T10:00:00+02:00", durationMinutes: 60 }], stops: [{ name: "Edited museum", placeId: "node/1", category: "culture", lat: 48.85, lng: 2.35, score: 90 }], geometry: null, segments: [], totalVisitMinutes: 60, totalTravelMinutes: 0, totalDistanceMeters: 0, partiallyEstimated: false, warnings: ["Saved diagnostic"] };
const credentials = { email: "migration@example.com", password: "Password123!Aa" };
let mongo: MongoMemoryReplSet;
let app: FastifyInstance;
let ip = 0;
const origin = env.WEB_ORIGIN;
const emptySavedReceipt = { importedDestinationCount: 0, importedAttractionCount: 0, mergedDestinationCount: 0, mergedAttractionCount: 0 };
const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers["set-cookie"]).split(";")[0];
function call(cookie: string | undefined, method: "GET" | "POST" | "DELETE" | "PATCH", url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, remoteAddress: `198.51.100.${ip}`, headers: { origin, ...(cookie ? { cookie } : {}) }, ...(payload === undefined ? {} : { payload }) });
}
async function guest() {
  const response = await call(undefined, "POST", "/api/auth/guest");
  expect(response.statusCode).toBe(200);
  return { id: response.json().guest.id as string, cookie: cookieOf(response) };
}
async function seed(guestId: string, count = 1, shared = false) {
  const trips = [];
  for (let i = 0; i < count; i++) {
    const trip = await reserveGuestDraft(`guest:${guestId}`, "Paris", ["culture"]);
    trip.set({ analysis, status: "ready", itineraryVersion: 7, attractions: [{ name: "Edited museum", placeId: "node/1", category: "culture", lat: 48.85, lng: 2.35, score: 90 }], itinerary: { timeZone: "Europe/Paris", routingSource: "approximation", days: [day], unscheduled: [] }, ...(shared ? { sharing: { enabled: true, tokenHash: hashShareToken("x".repeat(43)), createdAt: new Date(), updatedAt: new Date() } } : {}) });
    await trip.save(); trips.push(trip);
  }
  return trips;
}
const status = (cookie: string) => call(cookie, "GET", "/api/auth/guest-migration/status");

it.each(["en", "pl"] as const)("guest migration preserves %s trip content language without rewriting content", async contentLocale => {
  const source = await guest(); const [trip] = await seed(source.id);
  trip!.contentLocale = contentLocale; await trip!.save();
  const before = trip!.toObject();
  const account = await register(source.cookie);
  expect((await confirm(account.cookie)).statusCode).toBe(200);
  const migrated = (await TripModel.findById(trip!._id))!;
  expect(migrated.contentLocale).toBe(contentLocale);
  expect(migrated.toObject().itinerary).toEqual(before.itinerary);
  expect(migrated.analysis.notes).toBe(before.analysis.notes);
});
const confirm = (cookie: string, body?: Record<string, unknown>) => call(cookie, "POST", "/api/auth/guest-migration/confirm", body);
async function register(cookie?: string, email = credentials.email) {
  const response = await call(cookie, "POST", "/api/auth/register", { ...credentials, email });
  expect(response.statusCode, response.body).toBe(201);
  return { cookie: cookieOf(response), user: response.json().user };
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri()); app = await createApp(); await TripModel.init(); await UserModel.init();
}, 120_000);
beforeEach(() => { ip++; vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected provider call during migration"); })); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const c of await mongoose.connection.db!.listCollections().toArray()) await mongoose.connection.db!.collection(c.name).deleteMany({}); });
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });

describe("session-bound guest import", () => {
  it.each([0, 1, 6])("registers and atomically imports %i trips without changing saved content", async count => {
    const source = await guest(); const trips = await seed(source.id, count);
    const before = await TripModel.collection.find({ guestId: source.id }).sort({ _id: 1 }).toArray();
    const account = await register(source.cookie);
    expect(account.cookie).not.toBe(source.cookie);
    const current = (await status(account.cookie)).json();
    if (!count) { expect(current).toEqual({ status: "none" }); return; }
    expect(current).toMatchObject({ status: "pending", tripCount: count, busy: false });
    expect(await TripModel.countDocuments({ user: account.user.id })).toBe(0);
    const imported = await confirm(account.cookie);
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toEqual({ ...emptySavedReceipt, importedCount: count, alreadyImported: false });
    expect((await status(account.cookie)).json()).toEqual({ status: "completed", ...emptySavedReceipt, importedCount: count });
    const after = await TripModel.collection.find({ user: new mongoose.Types.ObjectId(account.user.id) }).sort({ _id: 1 }).toArray();
    expect(after).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      const { guestId: _guest, guestSlot: _slot, ...oldContent } = before[i];
      const { user, ...newContent } = after[i];
      expect(String(user)).toBe(account.user.id); expect(newContent).toEqual(oldContent);
      expect(after[i].guestId).toBeUndefined(); expect(after[i].itineraryVersion).toBe(7);
    }
    expect((await call(account.cookie, "GET", "/api/trips")).json().map((t: { id: string }) => t.id).sort()).toEqual(trips.map(t => t.id).sort());
    expect(fetch).not.toHaveBeenCalled();
  });
  it("logs into an existing account and preserves its trips and account preferences", async () => {
    const account = await register();
    const existing = await TripModel.create({ user: account.user.id, analysis, prompt: "Existing account trip" });
    const before = await TripModel.collection.findOne({ _id: existing._id });
    const profile = await UserModel.findById(account.user.id).lean();
    const source = await guest(); await seed(source.id, 2);
    const loggedIn = await call(source.cookie, "POST", "/api/auth/login", credentials);
    expect(loggedIn.statusCode).toBe(200); const cookie = cookieOf(loggedIn);
    expect((await status(cookie)).json()).toMatchObject({ status: "pending", tripCount: 2 });
    expect((await confirm(cookie)).json()).toEqual({ ...emptySavedReceipt, importedCount: 2, alreadyImported: false });
    expect(await TripModel.collection.findOne({ _id: existing._id })).toEqual(before);
    expect(await UserModel.findById(account.user.id).lean()).toEqual(profile);
    expect((await call(cookie, "GET", "/api/trips")).json()).toHaveLength(3);
  });
  it("keeps failed login/register flows from capturing guest ownership", async () => {
    await register(); const source = await guest(); await seed(source.id);
    expect((await call(source.cookie, "POST", "/api/auth/login", { ...credentials, password: "incorrect" })).statusCode).toBe(401);
    expect((await call(source.cookie, "POST", "/api/auth/register", credentials)).statusCode).toBe(409);
    expect((await call(source.cookie, "GET", "/api/trips")).json()).toHaveLength(1);
    expect(await handoffs().findOne({ _id: source.id })).toMatchObject({ state: "active" });
  });
  it("is idempotent under simultaneous confirmations and a lost response retry", async () => {
    const source = await guest(); await seed(source.id, 6); const account = await register(source.cookie);
    const responses = await Promise.all([confirm(account.cookie), confirm(account.cookie)]);
    expect(responses.map(r => r.statusCode)).toEqual([200, 200]);
    expect(responses.map(r => r.json().alreadyImported).sort()).toEqual([false, true]);
    expect((await confirm(account.cookie)).json()).toEqual({ ...emptySavedReceipt, importedCount: 6, alreadyImported: true });
    expect(await TripModel.countDocuments()).toBe(6);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("lets only one already-started login capture a guest handoff across two accounts/tabs", async () => {
    await register(); await register(undefined, "other@example.com");
    const source = await guest(); await seed(source.id);
    let release!: () => void; let entered!: () => void; let arrivals = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const verify = argon2.verify;
    vi.spyOn(argon2, "verify").mockImplementation(async (...args) => {
      if (++arrivals === 2) entered();
      await gate; return verify(...args);
    });
    const attempts = [credentials.email, "other@example.com"].map(email =>
      call(source.cookie, "POST", "/api/auth/login", { ...credentials, email }).then(r => r));
    await started; release();
    const results = await Promise.all(attempts);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const winner = results.find(r => r.statusCode === 200)!;
    expect(results.find(r => r.statusCode === 409)!.headers["set-cookie"]).toBeUndefined();
    expect((await confirm(cookieOf(winner))).json()).toEqual({ ...emptySavedReceipt, importedCount: 1, alreadyImported: false });
    expect(await TripModel.countDocuments({ user: winner.json().user.id })).toBe(1);
  });
  it("rolls back an interruption after trip writes and retries the same context safely", async () => {
    const source = await guest(); await seed(source.id, 6); const account = await register(source.cookie);
    const before = await TripModel.collection.find({}).toArray();
    const transfer = migrationWrites.transfer;
    vi.spyOn(migrationWrites, "transfer").mockImplementationOnce(async (...args) => { await transfer(...args); throw new Error("Simulated write interruption"); });
    expect((await confirm(account.cookie)).statusCode).toBe(503);
    expect(await TripModel.collection.find({}).toArray()).toEqual(before);
    expect((await status(account.cookie)).json()).toMatchObject({ status: "pending", tripCount: 6 });
    expect((await confirm(account.cookie)).json()).toEqual({ ...emptySavedReceipt, importedCount: 6, alreadyImported: false });
    expect(await TripModel.countDocuments({ user: account.user.id })).toBe(6);
  });
  it("binds authority to the exact handoff session and rejects arbitrary IDs and other accounts", async () => {
    const source = await guest(); const otherGuest = await guest(); const [trip] = await seed(source.id); await seed(otherGuest.id);
    const account = await register(source.cookie);
    expect((await confirm(account.cookie, { guestId: otherGuest.id, userId: account.user.id })).statusCode).toBe(400);
    const otherAccount = await register(undefined, "other@example.com");
    expect((await confirm(otherAccount.cookie)).statusCode).toBe(403);
    expect((await status(otherAccount.cookie)).json()).toEqual({ status: "none" });
    // Even another valid session for the same user cannot replay this handoff.
    const sameAccount = await call(undefined, "POST", "/api/auth/login", credentials);
    expect((await confirm(cookieOf(sameAccount))).statusCode).toBe(403);
    // Knowing the internal context ID still cannot bind another authenticated session.
    const contextId = (await handoffs().findOne({ _id: source.id }))!.contextId!;
    for (const cookie of [otherAccount.cookie, cookieOf(sameAccount)]) {
      const sessionId = decodeURIComponent(cookie.split("=")[1]).slice(2).split(".")[0];
      const data = (await app.triplySessionStore.get(sessionId))!;
      data.guestMigrationId = contextId;
      await app.triplySessionStore.save(sessionId, data);
      expect((await confirm(cookie)).statusCode).toBe(403);
      expect((await status(cookie)).json()).toEqual({ status: "expired" });
    }
    expect((await confirm(account.cookie)).statusCode).toBe(200);
    expect((await call(otherGuest.cookie, "GET", `/api/trips/${trip.id}`)).statusCode).toBe(404);
    expect(await TripModel.countDocuments({ guestId: otherGuest.id })).toBe(1);
    expect((await confirm(otherAccount.cookie)).statusCode).toBe(403);
  });
  it("never accepts public share tokens as migration proof and protects origins", async () => {
    const source = await guest(); await seed(source.id, 1, true); const account = await register(source.cookie);
    expect((await confirm(account.cookie, { shareToken: "x".repeat(43) })).statusCode).toBe(400);
    expect((await confirm(source.cookie)).statusCode).toBe(401);
    for (const path of ["confirm", "discard"]) expect((await app.inject({ method: "POST", url: `/api/auth/guest-migration/${path}`, headers: { cookie: account.cookie, origin: "https://evil.example" } })).statusCode).toBe(403);
  });
  it("preserves public sharing, revoked links, and owner/public PDF and ICS exports", async () => {
    const source = await guest(); const [trip] = await seed(source.id, 1, true);
    const revoked = (await seed(source.id))[0];
    await TripModel.collection.updateOne({ _id: revoked._id }, { $set: { sharing: { enabled: false, tokenHash: hashShareToken("y".repeat(43)), updatedAt: new Date() } } });
    const sharing = await TripModel.collection.findOne({ _id: trip._id });
    const account = await register(source.cookie); await confirm(account.cookie);
    expect((await TripModel.collection.findOne({ _id: trip._id }))!.sharing).toEqual(sharing!.sharing);
    for (const suffix of ["", "/export/pdf", "/export/calendar"]) {
      expect((await call(undefined, "GET", `/api/public/trips/${"x".repeat(43)}${suffix}`)).statusCode).toBe(200);
      expect((await call(undefined, "GET", `/api/public/trips/${"y".repeat(43)}${suffix}`)).statusCode).toBe(404);
    }
    for (const type of ["pdf", "calendar"]) {
      const response = await call(account.cookie, "GET", `/api/trips/${trip.id}/export/${type}`);
      expect(response.statusCode, response.body.slice(0, 100)).toBe(200);
      expect((await call(source.cookie, "GET", `/api/trips/${trip.id}/export/${type}`)).statusCode).toBe(401);
    }
    expect((await call(account.cookie, "DELETE", `/api/trips/${trip.id}/sharing`)).statusCode).toBe(200);
    expect((await call(source.cookie, "DELETE", `/api/trips/${trip.id}/sharing`)).statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("expires the context, retains trips and quota, and does not attach on a later account login", async () => {
    const source = await guest(); await seed(source.id, 2);
    const quota = { _id: source.id, entries: [{ id: "charged", at: new Date(), kind: "generation", state: "started" }], expiresAt: new Date(Date.now() + 86400_000) };
    await mongoose.connection.db!.collection("guest_usage").insertOne(quota as never);
    const account = await register(source.cookie);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + MIGRATION_WINDOW_MS + 1);
    expect((await status(account.cookie)).json()).toEqual({ status: "expired" });
    expect((await confirm(account.cookie)).statusCode).toBe(410);
    expect(await TripModel.countDocuments({ guestId: source.id })).toBe(2);
    expect(await mongoose.connection.db!.collection("guest_usage").findOne({ _id: source.id } as never)).toEqual(quota);
    await call(account.cookie, "POST", "/api/auth/logout");
    const login = await call(undefined, "POST", "/api/auth/login", credentials);
    expect((await status(cookieOf(login))).json()).toEqual({ status: "none" });
  });
  it("discards authority without deleting trips or affecting the authenticated session", async () => {
    const source = await guest(); await seed(source.id, 2); const account = await register(source.cookie);
    expect((await call(account.cookie, "POST", "/api/auth/guest-migration/discard")).json()).toEqual({ status: "discarded" });
    expect((await confirm(account.cookie)).statusCode).toBe(410);
    expect(await TripModel.countDocuments({ guestId: source.id })).toBe(2);
    expect((await call(account.cookie, "GET", "/api/auth/session?identity=1")).json().status).toBe("authenticated");
    expect((await call(source.cookie, "GET", "/api/auth/session?identity=1")).json()).toEqual({ status: "anonymous", reason: "GUEST_SESSION_EXPIRED" });
  });
  it("retains guest quota unchanged after successful import", async () => {
    const source = await guest(); await seed(source.id);
    await mongoose.connection.db!.collection("guest_usage").insertOne({ _id: source.id, entries: [{ id: "charged", kind: "generation", at: new Date(), state: "completed" }] } as never);
    const before = await mongoose.connection.db!.collection("guest_usage").findOne({ _id: source.id } as never);
    const account = await register(source.cookie); await confirm(account.cookie); await confirm(account.cookie);
    expect(await mongoose.connection.db!.collection("guest_usage").findOne({ _id: source.id } as never)).toEqual(before);
  });
  it("waits for in-flight guest creation and fences new guest mutations", async () => {
    const source = await guest(); const context = { _id: source.id, state: "active" as const, activeRequests: ["in-flight"], cleanupAt: new Date(Date.now() + 86400_000) };
    await handoffs().insertOne(context);
    const account = await register(source.cookie);
    expect((await status(account.cookie)).json()).toMatchObject({ status: "pending", busy: true });
    expect((await confirm(account.cookie)).statusCode).toBe(409);
    // Represents an already admitted creation finishing before its lease is released.
    await seed(source.id, 1);
    await handoffs().updateOne({ _id: source.id }, { $pull: { activeRequests: "in-flight" } });
    expect((await call(source.cookie, "POST", "/api/trips/analyze", { prompt: "blocked" })).statusCode).toBe(401);
    expect((await confirm(account.cookie)).json()).toEqual({ ...emptySavedReceipt, importedCount: 1, alreadyImported: false });
  });
  it("tracks a real paused guest create and suppresses its obsolete response cookie", async () => {
    const source = await guest();
    const { aiService } = await import("../ai/index.js");
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(aiService, "parseTrip").mockImplementationOnce(async () => { entered(); await gate; return analysis; });
    const creation = call(source.cookie, "POST", "/api/trips/analyze", { prompt: "Paris" }).then(r => r);
    await started;
    const account = await register(source.cookie);
    expect((await confirm(account.cookie)).statusCode).toBe(409);
    expect((await status(account.cookie)).json()).toMatchObject({ status: "pending", busy: true });
    release(); const result = await creation;
    expect(result.statusCode, result.body).toBe(200);
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect((await confirm(account.cookie)).json()).toEqual({ ...emptySavedReceipt, importedCount: 1, alreadyImported: false });
  });
  it("remains authorized when the retired guest cookie expires after authentication", async () => {
    const source = await guest(); await seed(source.id); const account = await register(source.cookie);
    expect((await confirm(account.cookie)).statusCode).toBe(200);
    const sessionId = decodeURIComponent(source.cookie.split("=")[1]).slice(2).split(".")[0];
    expect(await app.triplySessionStore.get(storageId(sessionId))).toBeNull();
    expect((await call(account.cookie, "GET", "/api/auth/session?identity=1")).json().status).toBe("authenticated");
  });
});

const snapshot = { name: "Guest museum", category: "culture", coordinates: { lat: 48.85, lng: 2.35 }, destinationName: "Paris", country: "France", address: "Museum street", description: "Guest description" };
async function seedSaved(ownerType: "guest" | "user", ownerId: string, destinationIds = ["city-001"], attractionKeys = ["osm:node:1"]) {
  for (const destinationId of destinationIds) await SavedDestinationModel.create({ ownerType, ownerId, destinationId, createdAt: new Date("2025-01-02") });
  for (const attractionKey of attractionKeys) await SavedAttractionModel.create({ ownerType, ownerId, attractionKey, provider: "overpass", providerPlaceId: attractionKey.slice(4).replace(":", "/"), snapshot, createdAt: new Date("2025-01-02") });
}
describe("unified Saved migration", () => {
  it.each(["register", "login"] as const)("imports trips and both Saved kinds after %s, preserving content and sessions", async mode => {
    if (mode === "login") await register();
    const source = await guest(); const [trip] = await seed(source.id, 1, true); await seedSaved("guest", source.id);
    const beforeTrip = await TripModel.collection.findOne({ _id: trip._id });
    const beforeAttraction = await SavedAttractionModel.findOne({ ownerId: source.id }).lean();
    const account = mode === "register" ? await register(source.cookie) : await call(source.cookie, "POST", "/api/auth/login", credentials).then(response => ({ cookie: cookieOf(response), user: response.json().user }));
    expect((await status(account.cookie)).json()).toMatchObject({ status: "pending", tripCount: 1, destinationCount: 1, attractionCount: 1 });
    const result = await confirm(account.cookie);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual({ importedCount: 1, importedDestinationCount: 1, importedAttractionCount: 1, mergedDestinationCount: 0, mergedAttractionCount: 0, alreadyImported: false });
    expect((await call(account.cookie, "GET", "/api/saved/destinations")).json().destinations).toHaveLength(1);
    expect((await call(account.cookie, "GET", "/api/saved/attractions")).json().attractions[0].snapshot).toEqual(snapshot);
    const afterAttraction = await SavedAttractionModel.findOne({ ownerId: account.user.id }).lean();
    expect(afterAttraction!._id).toEqual(beforeAttraction!._id);
    expect(afterAttraction!.createdAt).toEqual(beforeAttraction!.createdAt);
    expect(afterAttraction!.attractionKey).toBe(beforeAttraction!.attractionKey);
    expect(afterAttraction!.providerPlaceId).toBe(beforeAttraction!.providerPlaceId);
    const afterTrip = await TripModel.collection.findOne({ _id: trip._id });
    expect(afterTrip!.itinerary).toEqual(beforeTrip!.itinerary); expect(afterTrip!.sharing).toEqual(beforeTrip!.sharing);
    for (const path of ["/api/saved/destinations", "/api/saved/attractions"]) expect((await call(source.cookie, "GET", path)).statusCode).toBe(401);
    expect((await call(account.cookie, "GET", "/api/auth/session?identity=1")).json().status).toBe("authenticated");
    expect(await SavedDestinationModel.countDocuments({ ownerType: "guest", ownerId: source.id })).toBe(0);
    expect(await SavedAttractionModel.countDocuments({ ownerType: "guest", ownerId: source.id })).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["destinations", "attractions", "both"] as const)("offers and imports Saved-only %s with zero trips", async kind => {
    const source = await guest(); await seedSaved("guest", source.id, kind === "attractions" ? [] : ["city-001"], kind === "destinations" ? [] : ["osm:node:1"]);
    const account = await register(source.cookie);
    const counts = { tripCount: 0, destinationCount: kind === "attractions" ? 0 : 1, attractionCount: kind === "destinations" ? 0 : 1 };
    expect((await status(account.cookie)).json()).toMatchObject({ status: "pending", ...counts });
    expect((await confirm(account.cookie)).json()).toMatchObject({ importedCount: 0, importedDestinationCount: counts.destinationCount, importedAttractionCount: counts.attractionCount });
    expect(await TripModel.countDocuments()).toBe(0);
  });
  it("merges by canonical key, preserves account fields, fills missing snapshot data and keeps earliest dates", async () => {
    const target = await register();
    await seedSaved("user", target.user.id, ["city-001", "city-005"], ["osm:node:1"]);
    await SavedDestinationModel.collection.updateMany({ ownerId: target.user.id }, { $set: { createdAt: new Date("2026-02-01") } });
    await SavedAttractionModel.collection.updateOne({ ownerId: target.user.id }, { $set: { createdAt: new Date("2024-01-01"), snapshot: { name: "Account museum", category: "culture", coordinates: { lat: 48.9, lng: 2.3 }, description: "Reliable account description" } } });
    const profile = await UserModel.findById(target.user.id).lean();
    const source = await guest(); await seedSaved("guest", source.id, ["city-001", "city-003"], ["osm:node:1", "osm:node:2"]);
    const login = await call(source.cookie, "POST", "/api/auth/login", credentials); const cookie = cookieOf(login);
    const first = (await confirm(cookie)).json();
    expect(first).toEqual({ importedCount: 0, importedDestinationCount: 2, importedAttractionCount: 2, mergedDestinationCount: 1, mergedAttractionCount: 1, alreadyImported: false });
    expect(await SavedDestinationModel.countDocuments({ ownerId: target.user.id })).toBe(3);
    expect(await SavedAttractionModel.countDocuments({ ownerId: target.user.id })).toBe(2);
    const merged = await SavedAttractionModel.findOne({ ownerId: target.user.id, attractionKey: "osm:node:1" }).lean();
    expect(merged!.snapshot).toMatchObject({ name: "Account museum", description: "Reliable account description", address: snapshot.address, country: "France", coordinates: { lat: 48.9, lng: 2.3 } });
    expect(merged!.createdAt).toEqual(new Date("2024-01-01"));
    expect((await SavedDestinationModel.findOne({ ownerId: target.user.id, destinationId: "city-001" }))!.createdAt).toEqual(new Date("2025-01-02"));
    const beforeRetry = await SavedAttractionModel.find({ ownerId: target.user.id }).sort({ attractionKey: 1 }).lean();
    expect((await confirm(cookie)).json()).toEqual({ ...first, alreadyImported: true });
    expect((await status(cookie)).json()).toEqual({ status: "completed", ...Object.fromEntries(Object.entries(first).filter(([key]) => key !== "alreadyImported")) });
    expect(await SavedAttractionModel.find({ ownerId: target.user.id }).sort({ attractionKey: 1 }).lean()).toEqual(beforeRetry);
    expect(await UserModel.findById(target.user.id).lean()).toEqual(profile);
  });
  it("rolls back trips, Saved writes and receipt together after an interruption, then retries", async () => {
    const source = await guest(); await seed(source.id); await seedSaved("guest", source.id);
    const account = await register(source.cookie);
    const before = { trips: await TripModel.collection.find({}).toArray(), destinations: await SavedDestinationModel.collection.find({}).toArray(), attractions: await SavedAttractionModel.collection.find({}).toArray() };
    const transfer = migrationWrites.transferSaved;
    vi.spyOn(migrationWrites, "transferSaved").mockImplementationOnce(async (...args) => { await transfer(...args); throw new Error("Interrupted after all saved writes"); });
    expect((await confirm(account.cookie)).statusCode).toBe(503);
    expect(await TripModel.collection.find({}).toArray()).toEqual(before.trips);
    expect(await SavedDestinationModel.collection.find({}).toArray()).toEqual(before.destinations);
    expect(await SavedAttractionModel.collection.find({}).toArray()).toEqual(before.attractions);
    expect((await status(account.cookie)).json()).toMatchObject({ status: "pending", tripCount: 1, destinationCount: 1, attractionCount: 1 });
    expect((await confirm(account.cookie)).json()).toMatchObject({ importedCount: 1, importedDestinationCount: 1, importedAttractionCount: 1 });
  });
  it("keeps a durable exact receipt for concurrent confirmations and lost-response retries", async () => {
    const source = await guest(); await seedSaved("guest", source.id); const account = await register(source.cookie);
    const responses = await Promise.all([confirm(account.cookie), confirm(account.cookie), confirm(account.cookie)]);
    expect(responses.map(response => response.statusCode)).toEqual([200, 200, 200]);
    expect(responses.map(response => response.json().alreadyImported).sort()).toEqual([false, true, true]);
    for (const response of responses) expect(response.json()).toMatchObject({ importedCount: 0, importedDestinationCount: 1, importedAttractionCount: 1 });
    expect((await confirm(account.cookie)).json()).toMatchObject({ alreadyImported: true, importedDestinationCount: 1, importedAttractionCount: 1 });
    expect(await SavedDestinationModel.countDocuments()).toBe(1); expect(await SavedAttractionModel.countDocuments()).toBe(1);
  });
  it("retries an E11000 transaction from a fresh snapshot without double-counting", async () => {
    const source = await guest(); await seedSaved("guest", source.id); const account = await register(source.cookie);
    const transfer = migrationWrites.transferSaved;
    const spy = vi.spyOn(migrationWrites, "transferSaved").mockImplementationOnce(async (...args) => { await transfer(...args); throw Object.assign(new Error("unique index contention"), { code: 11000 }); });
    const result = await confirm(account.cookie); expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({ importedDestinationCount: 1, importedAttractionCount: 1 }); expect(spy).toHaveBeenCalledTimes(2);
    expect(await SavedDestinationModel.countDocuments()).toBe(1);
  });
  it("resolves an actual concurrent account save under the unique index", async () => {
    const target = await register(); const source = await guest(); await seedSaved("guest", source.id);
    const login = await call(source.cookie, "POST", "/api/auth/login", credentials);
    const transfer = migrationWrites.transferSaved; let inserted = false;
    vi.spyOn(migrationWrites, "transferSaved").mockImplementation(async (...args) => {
      if (!inserted) { inserted = true; await seedSaved("user", target.user.id, ["city-001"], []); }
      return transfer(...args);
    });
    const result = await confirm(cookieOf(login)); expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({ importedDestinationCount: 1, mergedDestinationCount: 1 });
    expect(await SavedDestinationModel.countDocuments()).toBe(1);
  });
  it("retains Saved data on failed credentials, expiration and discard without creating a later handoff", async () => {
    await register(); const source = await guest(); await seedSaved("guest", source.id);
    expect((await call(source.cookie, "POST", "/api/auth/login", { ...credentials, password: "incorrect" })).statusCode).toBe(401);
    expect((await call(source.cookie, "POST", "/api/auth/register", credentials)).statusCode).toBe(409);
    expect((await call(source.cookie, "GET", "/api/saved/attractions")).json().attractions).toHaveLength(1);
    const login = await call(source.cookie, "POST", "/api/auth/login", credentials); const cookie = cookieOf(login);
    await handoffs().updateOne({ _id: source.id }, { $set: { expiresAt: new Date(0) } });
    expect((await status(cookie)).json()).toEqual({ status: "expired" }); expect((await confirm(cookie)).statusCode).toBe(410);
    expect(await SavedAttractionModel.countDocuments({ ownerId: source.id })).toBe(1);
    const later = await call(undefined, "POST", "/api/auth/login", credentials); expect((await status(cookieOf(later))).json()).toEqual({ status: "none" });
    const second = await guest(); await seedSaved("guest", second.id); const auth = await call(second.cookie, "POST", "/api/auth/login", credentials);
    expect((await call(cookieOf(auth), "POST", "/api/auth/guest-migration/discard")).json()).toEqual({ status: "discarded" });
    expect(await SavedDestinationModel.countDocuments({ ownerType: "guest" })).toBe(2);
  });
  it("enforces the handoff binding for Saved-only imports and keeps other owners private", async () => {
    const a = await guest(); const b = await guest(); await seedSaved("guest", a.id); await seedSaved("guest", b.id);
    const target = await register(a.cookie); const outsider = await register(undefined, "outsider@example.com");
    expect((await confirm(outsider.cookie)).statusCode).toBe(403);
    expect((await confirm(target.cookie, { guestId: b.id, ownerId: target.user.id })).statusCode).toBe(400);
    expect((await confirm(b.cookie)).statusCode).toBe(401);
    await confirm(target.cookie);
    expect((await call(outsider.cookie, "GET", "/api/saved/attractions")).json().attractions).toEqual([]);
    expect((await call(b.cookie, "GET", "/api/saved/attractions")).json().attractions).toHaveLength(1);
    expect((await call(a.cookie, "DELETE", "/api/saved/attractions/osm%3Anode%3A1")).statusCode).toBe(401);
  });
  it("imports independent Saved data after all source trips are deleted without changing quotas", async () => {
    const source = await guest(); const [trip] = await seed(source.id); await seedSaved("guest", source.id);
    await mongoose.connection.db!.collection("guest_usage").insertOne({ _id: source.id, entries: [{ id: "used", kind: "generation", at: new Date(), state: "completed" }] } as never);
    const quota = await mongoose.connection.db!.collection("guest_usage").findOne({ _id: source.id } as never);
    await call(source.cookie, "DELETE", `/api/trips/${trip.id}`);
    const account = await register(source.cookie); expect((await status(account.cookie)).json()).toMatchObject({ tripCount: 0, destinationCount: 1, attractionCount: 1 });
    await confirm(account.cookie);
    expect((await call(account.cookie, "GET", "/api/saved/attractions")).json().attractions[0].snapshot).toEqual(snapshot);
    expect((await call(account.cookie, "DELETE", "/api/saved/attractions/osm%3Anode%3A1")).statusCode).toBe(204);
    expect(await SavedDestinationModel.countDocuments({ ownerId: account.user.id })).toBe(1);
    expect(await mongoose.connection.db!.collection("guest_usage").findOne({ _id: source.id } as never)).toEqual(quota);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("processes every cursor batch without imposing a Saved limit", async () => {
    const source = await guest();
    await seedSaved("guest", source.id, [], Array.from({ length: 130 }, (_, i) => `osm:node:${i + 1}`));
    const account = await register(source.cookie); const result = await confirm(account.cookie);
    expect(result.json()).toMatchObject({ importedAttractionCount: 130, mergedAttractionCount: 0 });
    expect(await SavedAttractionModel.countDocuments({ ownerId: account.user.id })).toBe(130);
    expect((await call(account.cookie, "GET", "/api/saved/attractions/status")).json().attractionKeys).toHaveLength(130);
  });
  it("fails closed for an invalid persisted snapshot, preserving every source record", async () => {
    const source = await guest(); await seedSaved("guest", source.id);
    await SavedAttractionModel.collection.updateOne({ ownerId: source.id }, { $set: { "snapshot.image": "javascript:alert(1)" } });
    const account = await register(source.cookie); const response = await confirm(account.cookie);
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain("javascript");
    expect(await SavedDestinationModel.countDocuments({ ownerId: source.id })).toBe(1);
    expect(await SavedAttractionModel.countDocuments({ ownerId: source.id })).toBe(1);
    expect((await status(account.cookie)).json()).toMatchObject({ status: "pending", destinationCount: 1, attractionCount: 1 });
  });
  it.each(["destination-save", "destination-unsave", "attraction-save", "attraction-unsave"])("fences a real in-flight %s until it finishes", async operation => {
    const source = await guest(); const [trip] = await seed(source.id);
    const attraction = operation.startsWith("attraction"); const unsave = operation.endsWith("unsave");
    if (!attraction && !unsave) await (await import("../seed/destinations.js")).seedDestinations();
    if (unsave) await seedSaved("guest", source.id);
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const collection = attraction ? SavedAttractionModel.collection : SavedDestinationModel.collection;
    const method = unsave ? "deleteOne" : "updateOne";
    const original = collection[method].bind(collection);
    vi.spyOn(collection, method).mockImplementationOnce(async (...args: unknown[]) => { entered(); await gate; return Reflect.apply(original, collection, args); });
    const path = `/api/saved/${attraction ? "attractions" : "destinations"}`;
    const request = call(source.cookie, unsave ? "DELETE" : "POST", unsave ? `${path}/${attraction ? "osm%3Anode%3A1" : "city-001"}` : path,
      unsave ? undefined : attraction ? { tripId: trip.id, attractionKey: "osm:node:1" } : { destinationId: "city-001" }).then(response => response);
    await started;
    const account = await register(source.cookie);
    expect((await status(account.cookie)).json()).toMatchObject({ status: "pending", busy: true });
    expect((await confirm(account.cookie)).statusCode).toBe(409);
    release(); const response = await request; expect(response.statusCode).toBe(unsave ? 204 : 200); expect(response.headers["set-cookie"]).toBeUndefined();
    const completed = await confirm(account.cookie); expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json()).toMatchObject({ importedCount: 1, importedDestinationCount: attraction ? (unsave ? 1 : 0) : (unsave ? 0 : 1), importedAttractionCount: attraction ? (unsave ? 0 : 1) : (unsave ? 1 : 0) });
    expect(await SavedDestinationModel.countDocuments({ ownerType: "guest" })).toBe(0);
    expect(await SavedAttractionModel.countDocuments({ ownerType: "guest" })).toBe(0);
  });
  it("uses valid earliest timestamps and never overwrites complete account snapshot fields with blanks", () => {
    expect(earliestSavedAt(new Date("invalid"), new Date("2025-01-01"))).toEqual(new Date("2025-01-01"));
    expect(mergeSnapshot(snapshot, { ...snapshot, address: "", description: "" })).toEqual(snapshot);
  });
});

it("preserves packing provenance, packed state and generation metadata during guest import", async () => {
  const source = await guest(); const [trip] = await seed(source.id);
  const metadata = { generatedAt: new Date().toISOString(), contextFingerprint: "a".repeat(64), suggestionCount: 2 };
  trip!.set({ packingGeneration: metadata, equipment: [
    { name: "Passport", count: 1, category: "documents", packed: true, source: "manual" },
    { name: "Walking shoes", count: 1, category: "clothing", packed: false, source: "ai", reason: "For your scheduled walking days." },
  ] });
  await trip!.save();
  const before = await TripModel.collection.findOne({ _id: trip!._id });
  const account = await register(source.cookie);
  expect((await confirm(account.cookie)).statusCode).toBe(200);
  const after = await TripModel.collection.findOne({ _id: trip!._id });
  expect(after?.packingGeneration).toEqual(before?.packingGeneration);
  expect(after?.equipment).toEqual(before?.equipment);
  const response = await call(account.cookie, "GET", `/api/trips/${trip!.id}/equipment`);
  expect(response.json().equipment[1]).toMatchObject({ source: "ai", reason: "For your scheduled walking days." });
});
