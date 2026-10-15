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
    expect(imported.json()).toEqual({ importedCount: count, alreadyImported: false });
    expect((await status(account.cookie)).json()).toEqual({ status: "completed", importedCount: count });
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
    expect((await confirm(cookie)).json()).toEqual({ importedCount: 2, alreadyImported: false });
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
    expect((await confirm(account.cookie)).json()).toEqual({ importedCount: 6, alreadyImported: true });
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
    expect((await confirm(cookieOf(winner))).json()).toEqual({ importedCount: 1, alreadyImported: false });
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
    expect((await confirm(account.cookie)).json()).toEqual({ importedCount: 6, alreadyImported: false });
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
    expect((await confirm(account.cookie)).json()).toEqual({ importedCount: 1, alreadyImported: false });
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
    expect((await confirm(account.cookie)).json()).toEqual({ importedCount: 1, alreadyImported: false });
  });
  it("remains authorized when the retired guest cookie expires after authentication", async () => {
    const source = await guest(); await seed(source.id); const account = await register(source.cookie);
    expect((await confirm(account.cookie)).statusCode).toBe(200);
    const sessionId = decodeURIComponent(source.cookie.split("=")[1]).slice(2).split(".")[0];
    expect(await app.triplySessionStore.get(storageId(sessionId))).toBeNull();
    expect((await call(account.cookie, "GET", "/api/auth/session?identity=1")).json().status).toBe("authenticated");
  });
});
