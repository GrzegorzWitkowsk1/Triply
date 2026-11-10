import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { fetchAttractions } from "../services/attractions.js";
import { acquireAdmission, admissionPolicy } from "../services/resourceAdmission.js";
import { generationContext } from "../services/generationContext.js";
import { guestUsage } from "../services/guestLimits.js";
import { claimTripForGeneration, runTripGeneration } from "../services/tripGeneration.js";
import { ApiUsageModel } from "../models/ApiUsage.js";
import { createRoutingProvider } from "../routing/index.js";
import { guestActivityWrites } from "../middleware/guestActivity.js";
import * as locationService from "../services/location.js";

vi.mock("../services/weather.js", async original => ({ ...await original<typeof import("../services/weather.js")>(), ensureWeatherData: vi.fn(async () => ({ days: [], fetchedAt: null })) }));
vi.mock("../services/attractions.js", () => ({ fetchAttractions: vi.fn() }));
vi.mock("../routing/index.js", () => ({ createRoutingProvider: vi.fn(() => null) }));
const pool = [{ name: "Museum", category: "culture", lat: 48.85, lng: 2.35, placeId: "node/1", score: 90, visitDurationMinutes: 30 }];
const analysis = { destination: "Paris", country: "France", durationDays: 1, startDate: "2030-06-01", endDate: "2030-06-01", interests: ["culture"], pace: "relaxed", location: { lat: 48.85, lng: 2.35 } };
let mongo: MongoMemoryReplSet;
let first: FastifyInstance;
let second: FastifyInstance;
let lastRequest: FastifyRequest;
const origin = env.WEB_ORIGIN;
const headers = (cookie: string) => ({ cookie, origin });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
let serial = 0;
async function user() {
  const response = await first.inject({ method: "POST", url: "/api/auth/register", remoteAddress: `192.0.2.${++serial}`, headers: { origin }, payload: { email: `resource${serial}@example.com`, password: "Password123!Aa" } });
  expect(response.statusCode, response.body).toBe(201);
  return { cookie: String(response.headers["set-cookie"]).split(";")[0], id: response.json().user.id as string };
}
async function seed(owner: string) {
  return TripModel.create({ ...(owner.startsWith("guest:") ? { guestId: owner.slice(6), guestSlot: 0 } : { user: new mongoose.Types.ObjectId(owner) }), analysis, status: "draft" });
}
const generate = (app: FastifyInstance, cookie: string, id: string) => app.inject({ method: "POST", url: `/api/trips/${id}/generate`, headers: headers(cookie) }).then(r => r);
function pauseAttractions() {
  const entered = deferred();
  const gate = deferred();
  let signal: AbortSignal | undefined;
  vi.mocked(fetchAttractions).mockImplementationOnce(async () => {
    signal = generationContext.getStore()?.signal;
    entered.resolve(); await gate.promise; return pool;
  });
  return { entered: entered.promise, release: gate.resolve, signal: () => signal };
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  first = await createApp({ configure: app => { app.addHook("preHandler", async req => { lastRequest = req; }); } });
  second = await createApp();
}, 120_000);
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  vi.mocked(fetchAttractions).mockReset().mockResolvedValue(pool);
  admissionPolicy.generation.max = env.GENERATION_REQUESTS_PER_10M;
  admissionPolicy.location.max = env.LOCATION_REQUESTS_PER_MINUTE;
  for (const name of await mongoose.connection.db!.listCollections().toArray()) await mongoose.connection.db!.collection(name.name).deleteMany({});
});
afterAll(async () => { await first?.close(); await second?.close(); await mongoose.disconnect(); await mongo?.stop(); });

describe("shared expensive-work admission and lifecycle", () => {
  it("bounds different drafts across app instances before providers and releases success/failure capacity", async () => {
    vi.mocked(fetchAttractions).mockResolvedValue(pool);
    const account = await user(); const a = await seed(account.id); const b = await seed(account.id);
    const pause = pauseAttractions(); const running = generate(first, account.cookie, a.id);
    await pause.entered;
    try {
      const rejected = await generate(second, account.cookie, b.id);
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().code).toBe("TOO_MANY_CONCURRENT_OPERATIONS");
      expect(rejected.headers["retry-after"]).toBeDefined();
      expect(fetchAttractions).toHaveBeenCalledTimes(1);
    } finally { pause.release(); }
    expect((await running).statusCode).toBe(200);
    vi.mocked(fetchAttractions).mockRejectedValueOnce(new Error("provider failure"));
    expect((await generate(second, account.cookie, b.id)).statusCode).toBe(502);
    expect((await generate(first, account.cookie, b.id)).statusCode).toBe(200);
  });

  it("enforces request windows across instances and retry keys without provider work", async () => {
    admissionPolicy.generation.max = 2;
    const account = await user();
    for (let i = 0; i < 2; i++) {
      const lease = await acquireAdmission(account.id, "generation"); await lease.release();
    }
    const trip = await seed(account.id);
    const denied = await generate(second, account.cookie, trip.id);
    expect(denied.statusCode).toBe(429); expect(denied.json().code).toBe("RESOURCE_RATE_LIMITED");
    expect(fetchAttractions).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 600_001);
    vi.mocked(fetchAttractions).mockResolvedValue(pool);
    expect((await generate(first, account.cookie, trip.id)).statusCode).toBe(200);
  });

  it("rejects guest work before quota or durable credit reservation", async () => {
    admissionPolicy.generation.max = 2;
    const response = await first.inject({ method: "POST", url: "/api/auth/guest", headers: { origin }, remoteAddress: "192.0.2.200" });
    const cookie = String(response.headers["set-cookie"]).split(";")[0];
    const owner = `guest:${response.json().guest.id}`;
    const trip = await seed(owner); const lease = await acquireAdmission(owner, "generation");
    try {
      const denied = await generate(second, cookie, trip.id);
      expect(denied.statusCode).toBe(409);
      expect((await guestUsage(owner)).aiGenerationsRemaining).toBe(env.GUEST_AI_GENERATIONS_PER_24H);
      expect(await mongoose.connection.db!.collection("guest_usage").countDocuments()).toBe(0);
      expect(await ApiUsageModel.countDocuments()).toBe(0);
      expect(fetchAttractions).not.toHaveBeenCalled();
    } finally { await lease.release(); }
    admissionPolicy.generation.max = 1;
    const rateDenied = await generate(first, cookie, trip.id);
    expect(rateDenied.statusCode).toBe(429);
    expect(rateDenied.json().code).toBe("RESOURCE_RATE_LIMITED");
    expect((await guestUsage(owner)).aiGenerationsRemaining).toBe(env.GUEST_AI_GENERATIONS_PER_24H);
    expect(await ApiUsageModel.countDocuments()).toBe(0);
  });

  it("validates distinct location queries, shares identical requests, and limits across replicas", async () => {
    const account = await user(); admissionPolicy.location.max = 4;
    const gate = deferred(); const entered = deferred();
    const fetch = vi.fn(async () => { entered.resolve(); await gate.promise; return Response.json({ results: [{ name: "Paris", country: "France", latitude: 48.85, longitude: 2.35 }] }); });
    vi.stubGlobal("fetch", fetch);
    for (const query of ["q=a", `q=${"x".repeat(121)}`, "q=Paris&q=Rome", "q=%00Paris"]) {
      expect((await first.inject({ url: `/api/location/search?${query}`, headers: headers(account.cookie) })).statusCode).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
    // Invalid inputs count toward admission but never call the provider.
    admissionPolicy.location.max = 8;
    const bothEntered = deferred(); let lookups = 0;
    const geocode = locationService.geocodeLocation;
    vi.spyOn(locationService, "geocodeLocation").mockImplementation(query => {
      const result = geocode(query);
      if (++lookups === 2) bothEntered.resolve();
      return result;
    });
    const a = first.inject({ url: "/api/location/search?q=Paris", headers: headers(account.cookie) }).then(r => r);
    await entered.promise;
    const b = second.inject({ url: "/api/location/search?q=Paris", headers: headers(account.cookie) }).then(r => r);
    await bothEntered.promise;
    gate.resolve(); expect((await a).statusCode).toBe(200); expect((await b).statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const query of ["London", "Rome"]) await first.inject({ url: `/api/location/search?q=${query}`, headers: headers(account.cookie) });
    const denied = await second.inject({ url: "/api/location/search?q=Berlin", headers: headers(account.cookie) });
    expect(denied.statusCode).toBe(429); expect(fetch).toHaveBeenCalledTimes(3);
    const head = await second.inject({ method: "HEAD", url: "/api/location/search?q=Berlin", headers: headers(account.cookie) });
    expect(head.statusCode).toBe(429); expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("protects active work after two minutes and recovers expired work without late commits or slot release", async () => {
    vi.mocked(fetchAttractions).mockResolvedValue(pool);
    const account = await user(); const trip = await seed(account.id);
    const pause = pauseAttractions(); const running = generate(first, account.cookie, trip.id);
    await pause.entered;
    vi.useFakeTimers({ toFake: ["Date"] }); const start = Date.now(); vi.setSystemTime(start + 130_000);
    expect((await generate(second, account.cookie, trip.id)).statusCode).toBe(409);
    vi.setSystemTime(start + 241_000);
    expect((await generate(second, account.cookie, trip.id)).statusCode).toBe(200);
    const saved = (await TripModel.findById(trip.id))!.toObject();
    const newSlot = await acquireAdmission(account.id, "generation");
    pause.release(); expect((await running).statusCode).toBe(504);
    expect((await TripModel.findById(trip.id))!.toObject()).toEqual(saved);
    await expect(acquireAdmission(account.id, "generation")).rejects.toMatchObject({ code: "TOO_MANY_CONCURRENT_OPERATIONS" });
    await newSlot.release();
  });

  it("cancels a disconnected request, retains capacity until settlement, and never commits its late result", async () => {
    vi.mocked(fetchAttractions).mockResolvedValue(pool);
    const account = await user(); const trip = await seed(account.id);
    const pause = pauseAttractions(); const running = generate(first, account.cookie, trip.id);
    await pause.entered;
    lastRequest.raw.emit("aborted");
    expect(pause.signal()?.aborted).toBe(true);
    expect((await generate(second, account.cookie, trip.id)).statusCode).toBe(409);
    pause.release(); const cancelled = await running;
    expect(cancelled.statusCode).toBe(499); expect(cancelled.json().code).toBe("REQUEST_CANCELLED");
    expect((await TripModel.findById(trip.id))?.itinerary).toBeNull();
    expect((await generate(second, account.cookie, trip.id)).statusCode).toBe(200);
  });

  it("recovers a crashed claim and fences the old worker even without an HTTP context", async () => {
    vi.mocked(fetchAttractions).mockResolvedValue(pool);
    const owner = new mongoose.Types.ObjectId().toString(); const trip = await seed(owner);
    const old = (await claimTripForGeneration(trip.id, owner))!;
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 240_001);
    const fresh = (await claimTripForGeneration(trip.id, owner))!;
    expect(fresh.generation.runId).not.toBe(old.generation.runId);
    await expect(runTripGeneration(old)).rejects.toMatchObject({ code: "GENERATION_DEADLINE_EXCEEDED" });
    expect((await runTripGeneration(fresh)).status).toBe("ready");
  });

  it("recovers an abandoned authenticated legacy generation that still needs coordinates", async () => {
    vi.mocked(fetchAttractions).mockResolvedValue(pool);
    const account = await user(); const trip = await seed(account.id);
    await TripModel.updateOne({ _id: trip._id }, { $set: { status: "generating", "analysis.location": null,
      "generation.startedAt": new Date(Date.now() - 300_000) } });
    const fetch = vi.fn(async () => Response.json({ results: [{ name: "Paris", country: "France", latitude: 48.85, longitude: 2.35 }] }));
    vi.stubGlobal("fetch", fetch);
    const result = await generate(first, account.cookie, trip.id);
    expect(result.statusCode, result.body).toBe(200);
    expect((await TripModel.findById(trip.id))?.analysis.location).toMatchObject({ lat: 48.85, lng: 2.35 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("caps admission to remaining guest authority rather than extending it", async () => {
    const now = new Date(Date.now()); const ceiling = new Date(now.getTime() + 30_000);
    const lease = await acquireAdmission("guest:remaining-authority", "generation", now, ceiling);
    expect(lease.deadline).toEqual(ceiling);
    await lease.release();
    await expect(acquireAdmission("guest:expired-authority", "generation", now, new Date(now.getTime() - 1))).rejects.toMatchObject({ code: "GENERATION_DEADLINE_EXCEEDED" });
  });

  it("fences a worker whose local clock says active when MongoDB considers its claim expired", async () => {
    vi.mocked(fetchAttractions).mockResolvedValue(pool);
    const owner = new mongoose.Types.ObjectId().toString(); const trip = await seed(owner);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(vi.getRealSystemTime() - 300_000);
    const claimed = (await claimTripForGeneration(trip.id, owner))!;
    await expect(runTripGeneration(claimed)).rejects.toMatchObject({ code: "GENERATION_SUPERSEDED" });
    expect((await TripModel.findById(trip.id))?.itinerary).toBeNull();
  });

  it("keeps optional provider timeout fallback within the generation budget", async () => {
    vi.mocked(fetchAttractions).mockResolvedValue([...pool, { ...pool[0], name: "Second museum", placeId: "node/2", lat: 48.851 }]);
    const matrix = vi.fn(async () => { throw new DOMException("provider timeout", "TimeoutError"); });
    vi.mocked(createRoutingProvider).mockReturnValue({ name: "controlled", supportedModes: ["walking"], supportsMode: () => true,
      getTravelMatrix: matrix, getRoute: vi.fn() });
    try {
      const account = await user(); const trip = await seed(account.id);
      const response = await generate(first, account.cookie, trip.id);
      expect(response.statusCode, response.body).toBe(200);
      expect(matrix).toHaveBeenCalled();
      expect(response.json().itinerary.routingSource).toBe("approximation");
    } finally { vi.mocked(createRoutingProvider).mockReturnValue(null); }
  });

  it("rechecks cancellation after the guest fence and before the actual generation write", async () => {
    const response = await first.inject({ method: "POST", url: "/api/auth/guest", headers: { origin }, remoteAddress: "192.0.2.201" });
    const cookie = String(response.headers["set-cookie"]).split(";")[0];
    const trip = await seed(`guest:${response.json().guest.id}`);
    const provider = pauseAttractions(); const running = generate(first, cookie, trip.id);
    await provider.entered;
    const entered = deferred(); const gate = deferred();
    const original = guestActivityWrites.check;
    vi.spyOn(guestActivityWrites, "check").mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return original(...args); });
    provider.release(); await entered.promise;
    lastRequest.raw.emit("aborted"); gate.resolve();
    expect((await running).statusCode).toBe(499);
    expect((await TripModel.findById(trip.id))?.itinerary).toBeNull();
    expect((await guestUsage(`guest:${response.json().guest.id}`)).aiGenerationsRemaining).toBe(env.GUEST_AI_GENERATIONS_PER_24H - 1);
  });
});
