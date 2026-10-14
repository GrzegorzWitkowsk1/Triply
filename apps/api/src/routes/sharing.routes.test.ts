import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { TripModel } from "../models/Trip.js";
import { env } from "../config/env.js";
import { hashShareToken } from "./sharing.js";

let db: MongoMemoryServer;
let app: FastifyInstance;
beforeAll(async () => { db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri());
  app = await (await import("../app.js")).createApp(); await TripModel.init(); }, 120_000);
afterEach(async () => { for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({}); });
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await db?.stop(); });
async function setup() {
  const owner = request.agent(app.server);
  const registered = await owner.post("/api/auth/register").set("Origin", env.WEB_ORIGIN).send({ email: "share@example.com", password: "Password123!Aa" });
  expect(registered.status).toBe(201);
  const trip = await TripModel.create({ user: registered.body.user.id, status: "ready", prompt: "PRIVATE PROMPT", itineraryVersion: 7,
    analysis: { destination: "Paris", country: "France", startDate: "2030-06-01", endDate: "2030-06-01", durationDays: 1,
      travelers: 2, budget: { amount: 12345, currency: "EUR", type: "total" }, notes: "PRIVATE NOTES", interests: ["culture"], pace: "balanced", maxWalkingDistanceKm: 5 },
    attractions: [{ name: "Museum", category: "culture", lat: 48, lng: 2, placeId: "provider-secret-id", description: "Public museum description", address: "Public address" }],
    weather: [{ date: "2030-06-01", weatherCode: 0, temperatureMax: 24 }],
    itinerary: { timeZone: "Europe/Paris", routingSource: "provider", unscheduled: [], days: [{ dayIndex: 1, date: "2030-06-01", timeZone: "Europe/Paris",
      activities: [{ type: "attraction", placeId: "provider-secret-id", title: "Museum", startTime: "2030-06-01T09:00", endTime: "2030-06-01T10:00", durationMinutes: 60, warnings: ["PRIVATE DIAGNOSTIC"] }],
      stops: [{ name: "Museum", category: "culture", lat: 48, lng: 2, placeId: "provider-secret-id", score: 80 }],
      geometry: { type: "LineString", coordinates: [[2, 48], [2.1, 48.1]] }, segments: [], totalVisitMinutes: 60, totalTravelMinutes: 0, totalDistanceMeters: 0, partiallyEstimated: false, warnings: ["PRIVATE DIAGNOSTIC"] }] },
  });
  const path = `/api/trips/${trip.id}/sharing`;
  const enable = () => owner.post(path).set("Origin", env.WEB_ORIGIN).send();
  const rotate = () => owner.post(`${path}/rotate`).set("Origin", env.WEB_ORIGIN).send();
  const disable = () => owner.delete(path).set("Origin", env.WEB_ORIGIN);
  const read = (token: string) => request(app.server).get(`/api/public/trips/${token}`);
  return { owner, trip, path, enable, rotate, disable, read };
}
describe("secure public sharing", () => {
  it("defaults to private, including legacy records without sharing fields", async () => {
    const { trip, owner, path, read } = await setup();
    expect(trip.sharing?.enabled).toBe(false);
    expect((await owner.get(path)).body).toEqual({ enabled: false, createdAt: null, updatedAt: null });
    await TripModel.collection.updateOne({ _id: trip._id }, { $unset: { sharing: "" } });
    expect((await owner.get(path)).body.enabled).toBe(false);
    expect((await read(trip.id)).status).toBe(404);
    expect((await read(randomBytes(32).toString("base64url"))).status).toBe(404);
  });
  it("allows owner creation, stores only a hash and leaves all unrelated data unchanged", async () => {
    const { trip, enable, owner, path } = await setup();
    const before = (await TripModel.findById(trip.id))!.toObject();
    const result = await enable(); expect(result.status).toBe(200); expect(result.body.token).toMatch(/^[\w-]{43}$/);
    const saved = (await TripModel.findById(trip.id).select("+sharing.tokenHash"))!.toObject();
    expect(saved.sharing?.tokenHash).toBe(hashShareToken(result.body.token));
    expect(JSON.stringify(saved)).not.toContain(result.body.token);
    for (const field of ["analysis", "itinerary", "itineraryVersion", "expenses", "budgetAllocations", "budgetRevision", "weather", "attractions", "generation", "equipment"] as const) expect(saved[field]).toEqual(before[field]);
    expect((await owner.get(path)).body).not.toHaveProperty("token");
    expect((await owner.get(`/api/trips/${trip.id}`)).body).not.toHaveProperty("sharing");
    expect(JSON.stringify((await owner.get(path)).body)).not.toContain(saved.sharing!.tokenHash);
  });
  it("rejects anonymous and non-owner management for every operation", async () => {
    const { path } = await setup();
    const other = request.agent(app.server);
    await other.post("/api/auth/register").set("Origin", env.WEB_ORIGIN).send({ email: "other@example.com", password: "Password123!Aa" });
    for (const agent of [request.agent(app.server), other]) {
      const code = agent === other ? 404 : 401;
      expect((await agent.get(path)).status).toBe(code);
      expect((await agent.post(path).set("Origin", env.WEB_ORIGIN)).status).toBe(code);
      expect((await agent.post(`${path}/rotate`).set("Origin", env.WEB_ORIGIN)).status).toBe(code);
      expect((await agent.delete(path).set("Origin", env.WEB_ORIGIN)).status).toBe(code);
    }
  });
  it("returns an allowlisted anonymous itinerary and safe invalid-token errors", async () => {
    const { enable, read, trip } = await setup(); const created = await enable();
    const result = await read(created.body.token); expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store"); expect(result.headers["referrer-policy"]).toBe("no-referrer");
    expect(Object.keys(result.body).sort()).toEqual(["destination", "country", "startDate", "endDate", "durationDays", "location", "weather", "days"].sort());
    expect(result.body.days[0].activities[0]).toMatchObject({ title: "Museum", stopIndex: 0, startTime: "2030-06-01T09:00" });
    expect(result.body.days[0].stops[0]).toMatchObject({ description: "Public museum description", address: "Public address" });
    expect(result.body.days[0].warnings).toEqual(["opening-hours-unknown"]);
    for (const secret of ["PRIVATE", "provider-secret-id", trip.id, String(trip.user), "tokenHash", "budget", "expenses", "generation", "admission", "prompt", "notes"]) expect(result.text).not.toContain(secret);
    for (const token of ["invalid", randomBytes(32).toString("base64url"), "%ZZ"]) { const invalid = await read(token); expect(invalid.status).toBe(404); expect(invalid.body).toEqual({ error: "Shared trip not found" }); }
    expect([401, 404]).toContain((await request(app.server).post(`/api/public/trips/${created.body.token}`).set("Origin", env.WEB_ORIGIN)).status);
  });
  it("rotates and revokes links immediately", async () => {
    const { enable, rotate, disable, read } = await setup(); const first = await enable(); const second = await rotate();
    expect(second.status).toBe(200); expect(second.body.token).not.toBe(first.body.token);
    expect((await read(first.body.token)).status).toBe(404); expect((await read(second.body.token)).status).toBe(200);
    await disable(); expect((await read(second.body.token)).status).toBe(404); expect((await rotate()).status).toBe(409);
  });
  it("concurrent and repeated enables produce exactly one current link", async () => {
    const { enable, read } = await setup(); const results = await Promise.all([enable(), enable()]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]); expect((await enable()).status).toBe(409);
    expect((await read(results.find(r => r.status === 200)!.body.token)).status).toBe(200);
  });
  it.each(["enable", "rotate"] as const)("serializes %s vs disable without inconsistent state", async operation => {
    const ctx = await setup(); if (operation === "rotate") await ctx.enable();
    const results = await Promise.all([operation === "enable" ? ctx.enable() : ctx.rotate(), ctx.disable()]);
    const stored = (await TripModel.findById(ctx.trip.id).select("+sharing.tokenHash"))!;
    expect(stored.sharing?.enabled ? typeof stored.sharing.tokenHash === "string" : stored.sharing?.tokenHash === null).toBe(true);
    if (results[0].status === 200) expect((await ctx.read(results[0].body.token)).status).toBe(stored.sharing?.enabled ? 200 : 404);
    expect(stored.itineraryVersion).toBe(7);
  });
  it("two rotations leave only the last stored hash accessible", async () => {
    const ctx = await setup(); await ctx.enable(); const results = await Promise.all([ctx.rotate(), ctx.rotate()]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const reads = await Promise.all(results.map(r => ctx.read(r.body.token))); expect(reads.map(r => r.status).sort()).toEqual([200, 404]);
  });
  it("reads racing with revocation cannot authorize subsequent access", async () => {
    const ctx = await setup(); const created = await ctx.enable();
    const [read, revoked] = await Promise.all([ctx.read(created.body.token), ctx.disable()]);
    expect([200, 404]).toContain(read.status); expect(revoked.status).toBe(200);
    expect((await ctx.read(created.body.token)).status).toBe(404);
    expect((await TripModel.findById(ctx.trip.id).select("+sharing.tokenHash"))!.sharing?.tokenHash).toBeNull();
  });
  it("rate limits public requests without echoing secrets", async () => {
    const { read } = await setup(); const token = randomBytes(32).toString("base64url");
    const results = await Promise.all(Array.from({ length: 65 }, () => read(token)));
    expect(results.some(r => r.status === 429)).toBe(true);
    expect(results.every(r => !r.text.includes(token))).toBe(true);
  });
});
