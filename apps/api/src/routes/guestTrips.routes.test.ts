import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import type { TripAnalysis, ItineraryDay, RegenerationPreferences } from "@triply/shared";
import { TripModel } from "../models/Trip.js";
import { UserModel } from "../models/User.js";
import { env } from "../config/env.js";
import { reserveGuestDraft, guestOperation, guestUsage, validateGuestDuration } from "../services/guestLimits.js";
import { aiService } from "../ai/index.js";
import { runTripGeneration } from "../services/tripGeneration.js";

vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
vi.mock("../ai/index.js", () => ({ aiService: { parseTrip: vi.fn(), parseRegeneration: vi.fn() } }));
vi.mock("../services/location.js", async original => ({ ...await original<typeof import("../services/location.js")>(), resolveDestination: vi.fn(async () => ({ lat: 48.85, lng: 2.35 })) }));
vi.mock("../services/weather.js", async original => ({ ...await original<typeof import("../services/weather.js")>(), ensureWeatherData: vi.fn(async () => ({ days: [], fetchedAt: new Date() })) }));
vi.mock("../services/attractions.js", () => ({ fetchAttractions: vi.fn(async () => pool) }));
vi.mock("../services/tripGeneration.js", async original => {
  const actual = await original<typeof import("../services/tripGeneration.js")>();
  return { ...actual, runTripGeneration: vi.fn(async (trip) => {
    return TripModel.findOneAndUpdate({ _id: trip._id, "generation.startedAt": trip.generation.startedAt }, { $set: { status: "ready", itinerary: { timeZone: "Europe/Paris", routingSource: "approximation", days: [day], unscheduled: [] } }, $inc: { itineraryVersion: 1 } }, { new: true }).orFail();
  }) };
});
vi.mock("../routing/index.js", () => ({ createRoutingProvider: () => null }));
const pool = [0, 1, 2].map(i => ({ placeId: `node/${i}`, name: `Museum ${i}`, category: "culture", lat: 48.85 + i * .001, lng: 2.35, score: 90, environment: "indoor", visitDurationMinutes: 30 }));
const analysis: TripAnalysis = { destination: "Paris", country: "France", startDate: "2030-06-02", endDate: "2030-06-02", durationDays: 1, travelers: 1, budget: { amount: 500, currency: "EUR", type: "total" }, interests: ["culture"], pace: "relaxed", maxWalkingDistanceKm: 5, notes: null, location: { lat: 48.85, lng: 2.35 } };
const day: ItineraryDay = { dayIndex: 1, date: "2030-06-02", timeZone: "Europe/Paris", activities: pool.slice(0, 2).map((p, i) => ({ type: "attraction", placeId: p.placeId, title: p.name, startTime: `2030-06-02T${9 + i}:00:00+02:00`, endTime: `2030-06-02T${9 + i}:30:00+02:00`, durationMinutes: 30 })), stops: pool.slice(0, 2), segments: [], geometry: null, warnings: [], totalVisitMinutes: 60, totalTravelMinutes: 0, totalDistanceMeters: 0, partiallyEstimated: false };
const preferences: RegenerationPreferences = { lessWalking: false, moreFood: false, relaxedPace: true, preferIndoor: false, surpriseMe: false };
let db: MongoMemoryServer;
let app: FastifyInstance;
const origin = env.WEB_ORIGIN;
let counter = 0;
let network = 0;
async function guest() {
  const response = await app.inject({ method: "POST", url: "/api/auth/guest", remoteAddress: `192.0.2.${++counter}`, headers: { origin } });
  const cookie = String(response.headers["set-cookie"]).split(";")[0];
  return { cookie, id: response.json().guest.id as string, owner: `guest:${response.json().guest.id}` };
}
function call(cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>, key?: string) {
  return app.inject({ method, url, remoteAddress: `198.51.100.${network}`, headers: { origin, cookie, ...(key ? { "idempotency-key": key } : {}) }, ...(payload !== undefined ? { payload } : {}) });
}
async function seed(owner: string, ready = false) {
  const draft = await reserveGuestDraft(owner, "Paris", []);
  draft.set({ analysis, attractions: pool, attractionsFetchedAt: new Date(), attractionsQuery: { lat: 48.85, lng: 2.35, interests: ["culture"] }, status: ready ? "ready" : "draft", ...(ready ? { itinerary: { timeZone: "Europe/Paris", routingSource: "approximation", days: [day], unscheduled: [] }, itineraryVersion: 1 } : {}) });
  return draft.save();
}
beforeAll(async () => { db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri()); app = await (await import("../app.js")).createApp(); await TripModel.init(); }, 120_000);
beforeEach(() => { network++; vi.mocked(aiService.parseTrip).mockResolvedValue(analysis); vi.mocked(aiService.parseRegeneration).mockResolvedValue(preferences); });
afterEach(async () => { vi.useRealTimers(); vi.clearAllMocks(); for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({}); await mongoose.connection.db!.collection("guest_usage").deleteMany({}); });
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await db?.stop(); });

describe("guest trip ownership and resource limits", () => {
  it("prevents HTTP caching of private trip responses across guest identities", async () => {
    const a = await guest(); const b = await guest(); const trip = await seed(a.owner, true);
    for (const path of ["/api/trips", `/api/trips/${trip.id}`, "/api/guest/usage", `/api/trips/${trip.id}/equipment`]) {
      const response = await call(a.cookie, "GET", path);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    const denied = await call(b.cookie, "GET", `/api/trips/${trip.id}`);
    expect(denied.statusCode).toBe(404); expect(denied.headers["cache-control"]).toBe("no-store");
  });
  it("creates separate guest drafts through the existing analysis API, restores and lists only owned data", async () => {
    const a = await guest(); const b = await guest();
    const created = await call(a.cookie, "POST", "/api/trips/analyze", { prompt: "Paris", ownerId: b.id, user: new mongoose.Types.ObjectId().toString() });
    expect(created.statusCode, created.body).toBe(200);
    const second = await call(a.cookie, "POST", "/api/trips/analyze", { prompt: "Paris again" });
    expect(second.json().draftId).not.toBe(created.json().draftId);
    const id = created.json().draftId;
    expect((await TripModel.findById(id))?.guestId).toBe(a.id);
    expect(await UserModel.countDocuments()).toBe(0);
    expect((await call(a.cookie, "GET", "/api/trips")).json()).toHaveLength(2);
    expect((await call(b.cookie, "GET", "/api/trips")).json()).toEqual([]);
    expect((await call(a.cookie, "GET", `/api/trips/${id}`)).statusCode).toBe(200);
    const otherApp = await (await import("../app.js")).createApp();
    try { expect((await otherApp.inject({ url: `/api/trips/${id}`, headers: { cookie: a.cookie } })).statusCode).toBe(200); } finally { await otherApp.close(); }
  });
  it("denies cross-guest and registered-owner access on every trip action", async () => {
    const a = await guest(); const b = await guest(); const trip = await seed(a.owner, true);
    const user = await UserModel.create({ email: "owner@example.com", passwordHash: "unused" });
    const privateTrip = await TripModel.create({ user: user._id, analysis, status: "draft" });
    const routes: ["GET" | "POST" | "PATCH" | "DELETE", string, Record<string, unknown>?][] = [
      ["GET", ""], ["DELETE", ""], ["POST", "/generate"], ["POST", "/confirm"], ["PATCH", "/requirements", { answers: {}, confirmedFields: [] }],
      ["GET", "/sharing"], ["POST", "/sharing"], ["POST", "/sharing/rotate"], ["DELETE", "/sharing"], ["GET", "/export/pdf"], ["GET", "/export/calendar"],
      ["GET", "/equipment"], ["POST", "/weather/refresh"], ["GET", "/budget"],
      ["POST", "/days/1/regenerate", { preferences }], ["POST", "/itinerary/edit", { expectedVersion: 1, operation: { type: "reroute", dayIndex: 1 } }],
    ];
    for (const id of [trip.id, privateTrip.id]) for (const [method, suffix, payload] of routes) {
      const response = await call(b.cookie, method, `/api/trips/${id}${suffix}`, payload);
      expect(response.statusCode, `${method} ${suffix}: ${response.body}`).toBe(404);
    }
    expect((await call(a.cookie, "GET", `/api/trips/${trip.id}/assistant/conversations`)).statusCode).toBe(401);
    expect((await call(a.cookie, "GET", "/api/profile")).statusCode).toBe(401);
    expect(aiService.parseRegeneration).not.toHaveBeenCalled();
  });
  it("allows exactly one concurrent creation at five slots and rejects the seventh before AI", async () => {
    const a = await guest(); for (let i = 0; i < 5; i++) await seed(a.owner);
    const results = await Promise.all([call(a.cookie, "POST", "/api/trips/analyze", { prompt: "one" }), call(a.cookie, "POST", "/api/trips/analyze", { prompt: "two" })]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(await TripModel.countDocuments({ guestId: a.id })).toBe(6);
    expect(aiService.parseTrip).toHaveBeenCalledTimes(1);
    const blocked = await call(a.cookie, "POST", "/api/trips/analyze", { prompt: "seven" });
    expect(blocked.json()).toMatchObject({ code: "GUEST_TRIP_LIMIT_REACHED", tripCount: 6, tripLimit: 6 });
    expect(aiService.parseTrip).toHaveBeenCalledTimes(1);
  });
  it("releases storage on parsing failure, and repeated deletion frees exactly one slot without refunding AI", async () => {
    const a = await guest(); vi.mocked(aiService.parseTrip).mockRejectedValueOnce(new Error("provider timeout"));
    expect((await call(a.cookie, "POST", "/api/trips/analyze", { prompt: "Paris" })).statusCode).toBe(500);
    expect(await TripModel.countDocuments()).toBe(0);
    const trips = []; for (let i = 0; i < 6; i++) trips.push(await seed(a.owner));
    for (const trip of trips.slice(0, 2)) expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/generate`)).statusCode).toBe(200);
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(0);
    expect((await call(a.cookie, "DELETE", `/api/trips/${trips[0].id}`)).statusCode).toBe(204);
    expect((await call(a.cookie, "DELETE", `/api/trips/${trips[0].id}`)).statusCode).toBe(404);
    expect((await call(a.cookie, "POST", "/api/trips/analyze", { prompt: "replacement" })).statusCode).toBe(200);
    expect((await guestUsage(a.owner))).toMatchObject({ tripCount: 6, aiGenerationsRemaining: 0 });
  });
  it("enforces rolling generation quotas atomically and restores allowance only after 24h", async () => {
    const a = await guest(); const trips = [await seed(a.owner), await seed(a.owner), await seed(a.owner)];
    expect((await call(a.cookie, "POST", `/api/trips/${trips[0].id}/generate`)).statusCode).toBe(200);
    const concurrent = await Promise.all(trips.slice(1).map(t => call(a.cookie, "POST", `/api/trips/${t.id}/generate`)));
    expect(concurrent.map(r => r.statusCode).sort()).toEqual([200, 429]);
    expect(runTripGeneration).toHaveBeenCalledTimes(2);
    const blockedTrip = trips.slice(1)[concurrent.findIndex(r => r.statusCode === 429)];
    const denied = await call(a.cookie, "POST", `/api/trips/${blockedTrip.id}/generate`);
    expect(denied.json()).toMatchObject({ code: "GUEST_AI_LIMIT_REACHED", resetsAt: expect.any(String) });
    expect(denied.headers["retry-after"]).toBeDefined();
    const now = Date.now(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1000);
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(2);
    expect((await call(a.cookie, "POST", `/api/trips/${blockedTrip.id}/generate`)).statusCode).toBe(200);
  });
  it("does not charge a duplicate active trip claim or malformed preflight", async () => {
    const a = await guest(); const trip = await seed(a.owner);
    trip.status = "generating"; trip.generation.startedAt = new Date(); await trip.save();
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/generate`)).statusCode).toBe(409);
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(2);
    await TripModel.updateOne({ _id: trip._id }, { $set: { status: "draft", "analysis.durationDays": null } });
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/generate`)).statusCode).toBe(400);
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(2);
  });
  it("keeps uncertain provider failures charged and retries with the same key do not run twice", async () => {
    const a = await guest(); const trip = await seed(a.owner);
    vi.mocked(runTripGeneration).mockRejectedValueOnce(new Error("uncertain timeout"));
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/generate`, undefined, "once")).statusCode).toBe(502);
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(1);
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/generate`, undefined, "once")).statusCode).toBe(409);
    expect(runTripGeneration).toHaveBeenCalledTimes(1);
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/generate`, undefined, "new-attempt")).statusCode).toBe(200);
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/generate`, undefined, "new-attempt")).statusCode).toBe(200);
    expect(runTripGeneration).toHaveBeenCalledTimes(2);
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(0);
  });
  it("supports independent AI day quota, replay and uncharged preview apply", async () => {
    const a = await guest(); const trip = await seed(a.owner, true);
    const first = await call(a.cookie, "POST", `/api/trips/${trip.id}/days/1/regenerate`, { preferences, customInstructions: "more relaxed" }, "preview-1");
    expect(first.statusCode, first.body).toBe(200);
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/days/1/regenerate`, { preferences, customInstructions: "more relaxed" }, "preview-1")).json()).toEqual(first.json());
    expect(aiService.parseRegeneration).toHaveBeenCalledTimes(1);
    const applied = await call(a.cookie, "POST", `/api/trips/${trip.id}/days/1/apply`, { previewId: first.json().previewId });
    expect(applied.statusCode, applied.body).toBe(200);
    expect((await guestUsage(a.owner))).toMatchObject({ aiGenerationsRemaining: 2, dayRegenerationsRemaining: 1 });
    const concurrent = await Promise.all(["second", "third"].map(text => call(a.cookie, "POST", `/api/trips/${trip.id}/days/1/regenerate`, { preferences, customInstructions: text })));
    expect(concurrent.map(r => r.statusCode).sort()).toEqual([200, 429]);
    expect(aiService.parseRegeneration).toHaveBeenCalledTimes(2);
    const blocked = concurrent.find(r => r.statusCode === 429)!;
    expect(blocked.json().code).toBe("GUEST_DAY_REGEN_LIMIT_REACHED");
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/days/1/regenerate`, { preferences })).statusCode).toBe(200);
    expect((await guestUsage(a.owner)).dayRegenerationsRemaining).toBe(0);
  });
  it("validates 7 calendar days including DST boundaries and rejects 8 days before enrichment", async () => {
    const a = await guest();
    expect(() => validateGuestDuration(a.owner, { startDate: "2026-10-22", endDate: "2026-10-28", durationDays: 7 })).not.toThrow();
    expect(() => validateGuestDuration(a.owner, { startDate: "2026-10-22", endDate: "2026-10-29", durationDays: 1 })).toThrow("at most 7");
    expect(() => validateGuestDuration(new mongoose.Types.ObjectId().toString(), { startDate: "2026-10-22", endDate: "2026-11-22", durationDays: 32 })).not.toThrow();
    vi.mocked(aiService.parseTrip).mockResolvedValueOnce({ ...analysis, durationDays: 8 });
    const tooLong = await call(a.cookie, "POST", "/api/trips/analyze", { prompt: "8 days" });
    expect(tooLong.json().code).toBe("GUEST_TRIP_DURATION_EXCEEDED"); expect(await TripModel.countDocuments()).toBe(0);
    const trip = await seed(a.owner);
    expect((await call(a.cookie, "PATCH", `/api/trips/${trip.id}/requirements`, { answers: { endDate: "2030-06-09" }, confirmedFields: [] })).json().code).toBe("GUEST_TRIP_DURATION_EXCEEDED");
  });
  it("reuses manual editing/recalculation and version conflicts without charging AI", async () => {
    const a = await guest(); const trip = await seed(a.owner, true);
    const result = await call(a.cookie, "POST", `/api/trips/${trip.id}/itinerary/edit`, { expectedVersion: 1, operation: { type: "remove", dayIndex: 1, attractionId: "node/0" } });
    expect(result.statusCode, result.body).toBe(200);
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/itinerary/edit`, { expectedVersion: 1, operation: { type: "reroute", dayIndex: 1 } })).statusCode).toBe(409);
    expect((await call(a.cookie, "POST", `/api/trips/${trip.id}/itinerary/edit`, { expectedVersion: 2, operation: { type: "reroute", dayIndex: 1 } })).statusCode).toBe(200);
    expect((await guestUsage(a.owner))).toMatchObject({ aiGenerationsRemaining: 2, dayRegenerationsRemaining: 2 });
  });
  it("supports owner export and sharing while anonymous access stays read-only", async () => {
    const a = await guest(); const trip = await seed(a.owner, true);
    expect((await call(a.cookie, "GET", `/api/trips/${trip.id}/export/pdf`)).headers["content-type"]).toBe("application/pdf");
    expect((await call(a.cookie, "GET", `/api/trips/${trip.id}/export/calendar`)).headers["content-type"]).toContain("text/calendar");
    const shared = await call(a.cookie, "POST", `/api/trips/${trip.id}/sharing`); expect(shared.statusCode).toBe(200);
    const publicPath = `/api/public/trips/${shared.json().token}`;
    const response = await app.inject({ url: publicPath }); expect(response.statusCode).toBe(200); expect(response.body).not.toContain(a.id);
    expect((await call(a.cookie, "DELETE", `/api/trips/${trip.id}/sharing`)).statusCode).toBe(200);
    expect((await app.inject({ url: publicPath })).statusCode).toBe(404);
  });
  it("expires sessions without reassigning old trips or refunding ongoing work", async () => {
    const a = await guest(); const trip = await seed(a.owner);
    await mongoose.connection.db!.collection("sessions").updateMany({}, { $set: { expires: new Date(0) } });
    const response = await call(a.cookie, "GET", `/api/trips/${trip.id}`);
    expect(response.statusCode).toBe(401); expect(response.json().code).toBe("GUEST_SESSION_EXPIRED");
    const b = await guest(); expect((await call(b.cookie, "GET", `/api/trips/${trip.id}`)).statusCode).toBe(404);
    expect((await call(b.cookie, "GET", "/api/trips")).json()).toEqual([]);
  });
});


describe("guest quota failure and concurrency boundaries", () => {
  it("counts retained slots when an operator lowers the storage limit", async () => {
    const a = await guest(); const trips = [];
    for (let i = 0; i < 6; i++) trips.push(await seed(a.owner));
    for (const index of [0, 2, 3, 4]) await TripModel.deleteOne({ _id: trips[index]._id });
    const previous = env.GUEST_MAX_TRIPS;
    try {
      env.GUEST_MAX_TRIPS = 2;
      await expect(reserveGuestDraft(a.owner, "blocked", [])).rejects.toMatchObject({ code: "GUEST_TRIP_LIMIT_REACHED" });
      await TripModel.deleteOne({ _id: trips[1]._id });
      const concurrent = await Promise.allSettled([reserveGuestDraft(a.owner, "one", []), reserveGuestDraft(a.owner, "two", [])]);
      expect(concurrent.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(await TripModel.countDocuments({ guestId: a.id })).toBe(2);
    } finally { env.GUEST_MAX_TRIPS = previous; }
  });
  function quotaRequest(id: string, key: string, payload = "same") {
    return { url: "/quota-test", headers: { "idempotency-key": key }, body: { payload }, triplySession: { data: { guest: { id, createdAt: new Date().toISOString() }, cookie: { expires: new Date(Date.now() + 86400000).toISOString() } } } } as unknown as import("fastify").FastifyRequest;
  }
  it("releases known pre-provider failures but retains abandoned reservations until rolling expiry", async () => {
    const a = await guest();
    await expect(guestOperation(quotaRequest(a.id, "preflight"), "generation", async () => { throw new Error("pre-provider"); })).rejects.toThrow("pre-provider");
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(2);
    await mongoose.connection.db!.collection("guest_usage").updateOne({ _id: a.id } as never, { $set: { entries: [
      { id: "abandoned1", kind: "generation", at: new Date(), state: "reserved" },
      { id: "abandoned2", kind: "generation", at: new Date(), state: "started" },
    ] } });
    const work = vi.fn(async () => "unexpected");
    await expect(guestOperation(quotaRequest(a.id, "blocked"), "generation", work)).rejects.toMatchObject({ code: "GUEST_AI_LIMIT_REACHED" });
    expect(work).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 86400001);
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(2);
  });
  it("replays completed keys, rejects concurrent duplicates and binds the key to input", async () => {
    const a = await guest();
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const work = vi.fn(async (start: () => Promise<void>) => { await start(); entered(); await gate; return { result: "saved" }; });
    const first = guestOperation(quotaRequest(a.id, "key"), "generation", work);
    await started;
    await expect(guestOperation(quotaRequest(a.id, "key"), "generation", work)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    release(); expect(await first).toEqual({ result: "saved" });
    expect(await guestOperation(quotaRequest(a.id, "key"), "generation", work)).toEqual({ result: "saved" });
    await expect(guestOperation(quotaRequest(a.id, "key", "changed"), "generation", work)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(work).toHaveBeenCalledTimes(1);
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(1);
  });
  it("does not refund a generation when the session expires while work continues", async () => {
    const a = await guest(); const trip = await seed(a.owner);
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = vi.mocked(runTripGeneration).getMockImplementation()!;
    vi.mocked(runTripGeneration).mockImplementationOnce(async input => { entered(); await gate; return original(input); });
    const operation = call(a.cookie, "POST", `/api/trips/${trip.id}/generate`).then(r => r);
    await started;
    await mongoose.connection.db!.collection("sessions").updateMany({}, { $set: { expires: new Date(0) } });
    release(); expect((await operation).statusCode).toBe(200);
    expect((await guestUsage(a.owner)).aiGenerationsRemaining).toBe(1);
    // A response from in-flight work cannot resurrect the expired MongoDB session.
    expect((await call(a.cookie, "GET", `/api/trips/${trip.id}`)).statusCode).toBe(401);
  });
  it("preserves edits when a day preview is based on an outdated itinerary version", async () => {
    const a = await guest(); const trip = await seed(a.owner, true);
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(aiService.parseRegeneration).mockImplementationOnce(async () => { entered(); await gate; return preferences; });
    const operation = call(a.cookie, "POST", `/api/trips/${trip.id}/days/1/regenerate`, { preferences, customInstructions: "relaxed" }).then(r => r);
    await started;
    const edited = await call(a.cookie, "POST", `/api/trips/${trip.id}/itinerary/edit`, { expectedVersion: 1, operation: { type: "remove", dayIndex: 1, attractionId: "node/0" } });
    expect(edited.statusCode).toBe(200);
    release(); expect((await operation).statusCode).toBe(409);
    expect((await TripModel.findById(trip._id))!.itinerary!.days[0].stops.some(p => p.placeId === "node/0")).toBe(false);
    expect((await guestUsage(a.owner)).dayRegenerationsRemaining).toBe(1);
  });
  it("throttles the network across distinct guest identities", async () => {
    const a = await guest(); const b = await guest();
    for (let i = 0; i < 120; i++) expect((await call(i % 2 ? a.cookie : b.cookie, "GET", "/api/trips")).statusCode).toBe(200);
    const blocked = await call(b.cookie, "GET", "/api/trips");
    expect(blocked.statusCode).toBe(429); expect(blocked.json().code).toBe("GUEST_RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeDefined();
  });
});
