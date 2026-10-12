import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ApiUsageModel } from "../models/ApiUsage.js";
import { TripModel } from "../models/Trip.js";
import { env } from "../config/env.js";
import { fetchGeoapifyPlaces } from "./geoapify.js";
import { estimateGeoapifyCredits, reserveGeoapifyCredits, settleGeoapifyCredits, utcUsageDate } from "./geoapifyUsage.js";

let database: MongoMemoryServer;
const today = new Date("2026-10-12T23:59:59.000Z");
const settings = { ...env };
beforeAll(async () => { database = await MongoMemoryServer.create(); await mongoose.connect(database.getUri()); }, 60_000);
beforeEach(async () => { await ApiUsageModel.deleteMany({}); await TripModel.deleteMany({}); });
afterEach(() => { Object.assign(env, settings); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await mongoose.disconnect(); await database?.stop(); });

describe("persistent atomic Geoapify budget", () => {
  it.each([[1, 1], [20, 1], [21, 2], [40, 2], [60, 3], [100, 5], [115, 6]])("estimates %s results as %s credits", (limit, credits) => {
    expect(estimateGeoapifyCredits(limit)).toBe(credits);
  });
  it.each([0, -1, 1.5, NaN])("rejects invalid result limit %s", limit => expect(() => estimateGeoapifyCredits(limit)).toThrow());
  it("reserves available capacity and rejects insufficient capacity", async () => {
    expect(await reserveGeoapifyCredits(5, 5, today)).not.toBeNull();
    expect(await reserveGeoapifyCredits(1, 5, today)).toBeNull();
    expect(await ApiUsageModel.findOne({ date: utcUsageDate(today) }).lean()).toMatchObject({ reservedCredits: 5, consumedCredits: 0, requests: 1 });
  });
  it("initializes one record safely under concurrent first requests", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => reserveGeoapifyCredits(5, 25, today)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await ApiUsageModel.countDocuments({})).toBe(1);
    expect(await ApiUsageModel.findOne().lean()).toMatchObject({ reservedCredits: 25 });
  });
  it("allows only one of two concurrent requests to use the final five credits", async () => {
    const existing = await reserveGeoapifyCredits(2495, 2500, today);
    await settleGeoapifyCredits(existing!);
    const results = await Promise.all([reserveGeoapifyCredits(5, 2500, today), reserveGeoapifyCredits(5, 2500, today)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await ApiUsageModel.findOne().lean()).toMatchObject({ reservedCredits: 5, consumedCredits: 2495 });
  });
  it("starts a new UTC day without resetting previous records", async () => {
    await reserveGeoapifyCredits(5, 5, today);
    expect(await reserveGeoapifyCredits(5, 5, new Date("2026-10-13T00:00:00.000Z"))).not.toBeNull();
    expect((await ApiUsageModel.find().sort({ date: 1 }).lean()).map(r => r.date)).toEqual(["2026-10-12", "2026-10-13"]);
    expect(utcUsageDate(new Date("2026-10-13T01:00:00+02:00"))).toBe("2026-10-12");
  });
  it("preserves consumed and abandoned reserved credits after reconnect", async () => {
    const first = await reserveGeoapifyCredits(3, 5, today); await settleGeoapifyCredits(first!);
    await reserveGeoapifyCredits(2, 5, today);
    await mongoose.disconnect(); await mongoose.connect(database.getUri());
    expect(await reserveGeoapifyCredits(1, 5, today)).toBeNull();
    expect(await ApiUsageModel.findOne().lean()).toMatchObject({ consumedCredits: 3, reservedCredits: 2 });
  });
  it("settles exactly once even when concurrent settlements repeat", async () => {
    const reservation = await reserveGeoapifyCredits(5, 5, today);
    await Promise.all(Array.from({ length: 10 }, () => settleGeoapifyCredits(reservation!, 2)));
    expect(await ApiUsageModel.findOne().lean()).toMatchObject({ reservedCredits: 0, consumedCredits: 2, reservations: [] });
    expect(await reserveGeoapifyCredits(3, 5, today)).not.toBeNull();
  });
  it("never releases unknown failure billing", async () => {
    const reservation = await reserveGeoapifyCredits(5, 5, today); await settleGeoapifyCredits(reservation!);
    expect(await reserveGeoapifyCredits(1, 5, today)).toBeNull();
    expect(await ApiUsageModel.findOne().lean()).toMatchObject({ reservedCredits: 0, consumedCredits: 5 });
  });
  it("fails closed if the database cannot acknowledge a reservation", async () => {
    vi.spyOn(ApiUsageModel, "updateOne").mockRejectedValue(new Error("unavailable"));
    env.GEOAPIFY_API_KEY = "test"; env.GEOAPIFY_ENABLED = true;
    const http = vi.fn(); vi.stubGlobal("fetch", http);
    expect(await fetchGeoapifyPlaces(48.85, 2.35, [])).toBeNull(); expect(http).not.toHaveBeenCalled();
  });
  it("keeps reservation when settlement cannot be acknowledged", async () => {
    const reservation = await reserveGeoapifyCredits(5, 5, today);
    const spy = vi.spyOn(ApiUsageModel, "updateOne").mockRejectedValue(new Error("unavailable"));
    await settleGeoapifyCredits(reservation!, 1); spy.mockRestore();
    expect(await reserveGeoapifyCredits(1, 5, today)).toBeNull();
  });
  it("limits concurrent HTTP attempts globally and persists provider metadata", async () => {
    env.GEOAPIFY_ENABLED = true; env.GEOAPIFY_API_KEY = "test"; env.GEOAPIFY_DAILY_CREDIT_LIMIT = 5;
    const http = vi.fn(async () => new Response(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature",
      geometry: { type: "Point", coordinates: [2.35, 48.85] }, properties: { place_id: "upstream-id", name: "Museum", categories: ["entertainment.museum"], formatted: "Paris" } }] })));
    vi.stubGlobal("fetch", http);
    const results = await Promise.all(Array.from({ length: 20 }, () => fetchGeoapifyPlaces(48.85, 2.35, ["culture"], { limit: 100 })));
    // Reconciliation may free capacity, but every billed attempt remains within five credits.
    const usage = await ApiUsageModel.findOne().lean();
    expect(usage!.consumedCredits + usage!.reservedCredits).toBeLessThanOrEqual(5);
    expect(http.mock.calls.length).toBeLessThanOrEqual(5);
    const attraction = results.find(result => result?.length)?.[0]; expect(attraction).toBeDefined();
    const document = await TripModel.create({ user: new mongoose.Types.ObjectId(), analysis: {}, attractions: [attraction] });
    const persisted = await TripModel.findById(document._id).lean();
    expect(persisted!.attractions[0]).toMatchObject({ source: "geoapify", sourceId: "upstream-id", address: "Paris" });
  });
});
