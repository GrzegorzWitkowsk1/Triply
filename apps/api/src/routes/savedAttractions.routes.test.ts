import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createHash } from "node:crypto";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { SavedAttractionModel } from "../models/SavedAttraction.js";
import { savedAttractionIdentity } from "../services/savedAttractionIdentity.js";
import { toTripDetail } from "../services/tripDraft.js";
import { savedAttractionSnapshotSchema, type TripAttraction } from "@triply/shared";
import { SEED_FIXTURES } from "../seed/fixtures.js";
vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
let address = 0;
const origin = env.WEB_ORIGIN;
const url = "/api/saved/attractions";
const place: TripAttraction = { placeId: "node/123", name: "Museum", category: "culture", lat: 48.86, lng: 2.35, description: "A museum", address: "Museum street" };
type Identity = { headers: { origin: string; cookie: string }; id: string; kind: "guest" | "user" };
async function identity(kind: Identity["kind"]): Promise<Identity> {
  const response = await app.inject({ method: "POST", url: kind === "guest" ? "/api/auth/guest" : "/api/auth/register", remoteAddress: `192.0.2.${++address}`, headers: { origin },
    ...(kind === "user" ? { payload: { email: `attraction${address}@example.com`, password: "Original123!Aa" } } : {}) });
  expect(response.statusCode).toBe(kind === "guest" ? 200 : 201);
  const headers = { origin, cookie: response.cookies.map(c => `${c.name}=${c.value}`).join("; ") };
  const session = (await app.inject({ url: "/api/auth/session?identity=1", headers })).json();
  return { headers, id: kind === "guest" ? session.guest.id : session.user.id, kind };
}
async function trip(owner: Identity, places: TripAttraction[] = [place]) {
  return TripModel.create({ ...(owner.kind === "guest" ? { guestId: owner.id, guestSlot: await TripModel.countDocuments({ guestId: owner.id }) } : { user: owner.id }),
    prompt: "PRIVATE PROMPT must not be copied", analysis: SEED_FIXTURES[0]!.analysis, status: "ready", attractions: places,
    itinerary: { timeZone: "Europe/Paris", routingSource: "unavailable", days: [{ dayIndex: 1, date: "2026-10-12", timeZone: "Europe/Paris",
      activities: places.map(p => ({ type: "attraction", placeId: p.placeId, title: p.name, startTime: "2026-10-12T09:00:00", endTime: "2026-10-12T10:00:00", durationMinutes: 60 })),
      stops: places.map(p => ({ ...p, score: null })), segments: [], totalVisitMinutes: 60, totalTravelMinutes: 0, totalDistanceMeters: 0, partiallyEstimated: false, warnings: [] }], unscheduled: [] } });
}
const save = (owner: Identity, tripId: string, attractionKey = "osm:node:123") => app.inject({ method: "POST", url, headers: owner.headers, payload: { tripId, attractionKey } });
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); app = await createApp(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); })); }, 120_000);
afterAll(async () => { vi.unstubAllGlobals(); await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });
describe("saved attractions", () => {
  it.each(["user", "guest"] as const)("%s persists trusted snapshots, batches status, and safely removes", async kind => {
    const owner = await identity(kind); const source = await trip(owner);
    expect(toTripDetail(source).itinerary!.days[0]!.stops[0]!.attractionKey).toBe("osm:node:123");
    expect((await save(owner, source.id)).statusCode).toBe(200);
    const response = await app.inject({ url, headers: owner.headers });
    expect(response.json().attractions).toHaveLength(1);
    expect(response.json().attractions[0]).toMatchObject({ attractionKey: "osm:node:123", provider: "overpass", snapshot: { name: "Museum", destinationName: "Paris", country: "France", description: "A museum", coordinates: { lat: place.lat, lng: place.lng } } });
    expect(response.body).not.toContain("PRIVATE PROMPT"); expect(response.body).not.toContain(owner.id); expect(response.body).not.toContain(source.id);
    expect((await app.inject({ url: `${url}/status`, headers: owner.headers })).json()).toEqual({ attractionKeys: ["osm:node:123"] });
    const second = await createApp();
    try { expect((await second.inject({ url, headers: owner.headers })).json().attractions).toHaveLength(1); } finally { await second.close(); }
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: "DELETE", url: `${url}/osm%3Anode%3A123`, headers: owner.headers })).statusCode).toBe(204);
    expect((await app.inject({ url, headers: owner.headers })).json().attractions).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent saves from different trips without changing saved time", async () => {
    const owner = await identity("guest"); const a = await trip(owner); const b = await trip(owner, [{ ...place, name: "Museum renamed" }]);
    const responses = await Promise.all([save(owner, a.id), save(owner, b.id), save(owner, a.id)]);
    expect(responses.map(r => r.statusCode)).toEqual([200, 200, 200]);
    const first = (await app.inject({ url, headers: owner.headers })).json().attractions;
    await save(owner, b.id);
    expect((await app.inject({ url, headers: owner.headers })).json().attractions).toEqual(first);
    expect(first).toHaveLength(1);
  });
  it("enforces unique and owner listing indexes", async () => {
    const record = { ownerType: "guest", ownerId: "index-fixture", attractionKey: "osm:node:123", provider: "overpass", snapshot: { name: "Museum", category: "culture", coordinates: { lat: 1, lng: 2 } } };
    await SavedAttractionModel.create(record);
    await expect(SavedAttractionModel.create(record)).rejects.toMatchObject({ code: 11000 });
    const indexes = await SavedAttractionModel.collection.indexes();
    expect(indexes.some(index => index.key.ownerId === 1 && index.key.createdAt === -1)).toBe(true);
  });
  it("isolates every user/guest combination and refuses foreign source trips", async () => {
    const owners = await Promise.all([identity("guest"), identity("guest"), identity("user"), identity("user")]);
    for (const owner of owners) {
      const source = await trip(owner);
      for (const other of owners.filter(other => other.id !== owner.id)) expect((await save(other, source.id)).statusCode).toBe(404);
      expect((await save(owner, source.id)).statusCode).toBe(200);
    }
    const own = owners[0]!;
    await app.inject({ method: "DELETE", url: `${url}/osm%3Anode%3A123?ownerId=${owners[1]!.id}`, headers: own.headers });
    expect((await app.inject({ url, headers: own.headers })).json().attractions).toHaveLength(0);
    for (const other of owners.slice(1)) expect((await app.inject({ url, headers: other.headers })).json().attractions).toHaveLength(1);
  });
  it("survives deletion of its source trip and remains removable", async () => {
    const owner = await identity("guest"); const source = await trip(owner);
    await save(owner, source.id);
    expect((await app.inject({ method: "DELETE", url: `/api/trips/${source.id}`, headers: owner.headers })).statusCode).toBe(204);
    expect((await app.inject({ url, headers: owner.headers })).json().attractions[0].snapshot.name).toBe("Museum");
    expect((await app.inject({ method: "DELETE", url: `${url}/osm%3Anode%3A123`, headers: owner.headers })).statusCode).toBe(204);
  });
  it("rejects malformed, missing and mismatched references and frontend snapshots", async () => {
    const owner = await identity("guest"); const source = await trip(owner);
    for (const payload of [{}, { tripId: "invalid", attractionKey: "osm:node:123" }, { tripId: source.id, attractionKey: "Museum" }, { tripId: source.id, attractionKey: "osm:node:123", ownerId: "another" }, { tripId: source.id, attractionKey: "osm:node:123", snapshot: { name: "injected" } }]) {
      expect((await app.inject({ method: "POST", url, headers: owner.headers, payload })).statusCode).toBe(400);
    }
    expect((await save(owner, source.id, "osm:node:999")).statusCode).toBe(404);
    expect((await save(owner, new mongoose.Types.ObjectId().toString())).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers: owner.headers, payload: { snapshot: "x".repeat(5000) } })).statusCode).toBe(413);
    expect((await app.inject({ method: "DELETE", url: `${url}/bad-key`, headers: owner.headers })).statusCode).toBe(400);
  });
  it("rejects invalid persisted attraction data and bounds copied descriptions", async () => {
    const owner = await identity("guest"); const source = await trip(owner, [{ ...place, description: "d".repeat(10000) }]);
    await save(owner, source.id);
    expect((await app.inject({ url, headers: owner.headers })).json().attractions[0].snapshot.description).toHaveLength(2000);
    await TripModel.collection.updateOne({ _id: source._id }, { $set: { "itinerary.days.0.stops.0.lat": 999 } });
    expect((await save(owner, source.id)).statusCode).toBe(400);
    expect(savedAttractionSnapshotSchema.safeParse({ name: "Museum", category: "culture", coordinates: { lat: 1, lng: 2 }, image: "javascript:alert(1)" }).success).toBe(false);
    expect(savedAttractionSnapshotSchema.safeParse({ name: "x".repeat(201), category: "culture", coordinates: { lat: 1, lng: 2 } }).success).toBe(false);
  });
  it("rejects anonymous, expired guests and untrusted origins", async () => {
    for (const path of [url, `${url}/status`]) expect((await app.inject({ url: path })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { origin }, payload: {} })).statusCode).toBe(401);
    const owner = await identity("guest"); const source = await trip(owner);
    expect((await app.inject({ method: "POST", url, headers: { ...owner.headers, origin: "https://evil.example" }, payload: { tripId: source.id, attractionKey: "osm:node:123" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `${url}/osm:node:123`, headers: { ...owner.headers, origin: "https://evil.example" } })).statusCode).toBe(403);
    await mongoose.connection.db!.collection("sessions").updateMany({}, { $set: { expires: new Date(0) } });
    const response = await app.inject({ url, headers: owner.headers }); expect(response.statusCode).toBe(401); expect(response.json().code).toBe("GUEST_SESSION_EXPIRED");
  });
  it("leaves destinations, source documents and guest quotas unchanged", async () => {
    await (await import("../seed/destinations.js")).seedDestinations();
    const owner = await identity("guest"); const source = await trip(owner);
    const before = JSON.stringify(await TripModel.findById(source.id).lean());
    const usage = (await app.inject({ url: "/api/guest/usage", headers: owner.headers })).json();
    await app.inject({ method: "POST", url: "/api/saved/destinations", headers: owner.headers, payload: { destinationId: "city-001" } });
    await save(owner, source.id);
    await app.inject({ method: "DELETE", url: `${url}/osm:node:123`, headers: owner.headers });
    expect((await app.inject({ url: "/api/saved/destinations", headers: owner.headers })).json().destinations).toHaveLength(1);
    expect((await app.inject({ url: "/api/guest/usage", headers: owner.headers })).json()).toEqual(usage);
    expect(JSON.stringify(await TripModel.findById(source.id).lean())).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("canonical attraction identity", () => {
  it("uses OSM object type and ID, regardless of names or trip-local IDs", () => {
    expect(savedAttractionIdentity(place).attractionKey).toBe(savedAttractionIdentity({ ...place, name: "Renamed" }).attractionKey);
    expect(savedAttractionIdentity({ ...place, placeId: "way/123" }).attractionKey).not.toBe(savedAttractionIdentity(place).attractionKey);
  });
  it("recognizes Geoapify hashed place IDs and raw provider metadata consistently", () => {
    const raw = "geoapify-provider-record";
    const key = `geoapify/${createHash("sha256").update(raw).digest("hex")}`;
    expect(savedAttractionIdentity({ ...place, placeId: key }).attractionKey).toBe(savedAttractionIdentity({ ...place, placeId: null, source: "geoapify", sourceId: raw }).attractionKey);
  });
  it("ignores ephemeral IDs, but distinguishes nearby and similarly named legacy places", () => {
    const fallback = { ...place, placeId: "location/48.86:2.35" };
    const key = savedAttractionIdentity(fallback).attractionKey;
    expect(savedAttractionIdentity({ ...fallback, placeId: "generated-other-trip" }).attractionKey).toBe(key);
    expect(savedAttractionIdentity({ ...fallback, lat: fallback.lat + .000001 }).attractionKey).not.toBe(key);
    expect(savedAttractionIdentity({ ...fallback, name: "Museum Two" }).attractionKey).not.toBe(key);
    expect(savedAttractionIdentity({ ...fallback, category: "architecture" }).attractionKey).not.toBe(key);
  });
});
