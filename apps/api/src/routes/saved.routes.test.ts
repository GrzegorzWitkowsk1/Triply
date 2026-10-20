import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { SavedDestinationModel } from "../models/SavedDestination.js";
import { DESTINATIONS } from "@triply/shared";
import { seedDestinations } from "../seed/destinations.js";
vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
let address = 0;
const origin = env.WEB_ORIGIN;
const snapshot = JSON.stringify(DESTINATIONS);
const url = "/api/saved/destinations";
async function identity(kind: "guest" | "user") {
  const response = await app.inject({ method: "POST", url: kind === "guest" ? "/api/auth/guest" : "/api/auth/register",
    remoteAddress: `192.0.2.${++address}`, headers: { origin },
    ...(kind === "user" ? { payload: { email: `saved${address}@example.com`, password: "Original123!Aa" } } : {}) });
  expect(response.statusCode).toBe(kind === "guest" ? 200 : 201);
  return { origin, cookie: response.cookies.map(c => `${c.name}=${c.value}`).join("; ") };
}
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await seedDestinations(); app = await createApp(); }, 120_000);
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });
describe("saved destinations", () => {
  it.each(["guest", "user"] as const)("%s saves, persists, lists, batches, deduplicates, and removes", async kind => {
    const headers = await identity(kind);
    const save = () => app.inject({ method: "POST", url, headers, payload: { destinationId: "city-001" } });
    expect((await save()).statusCode).toBe(200);
    await Promise.all([save(), save(), save()]);
    const listed = (await app.inject({ url, headers })).json().destinations;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ destinationId: "city-001", destination: { city: "Paris", country: "France" } });
    expect((await app.inject({ url: `${url}/status`, headers })).json()).toEqual({ destinationIds: ["city-001"] });
    const secondApp = await createApp();
    try { expect((await secondApp.inject({ url, headers })).json().destinations).toHaveLength(1); } finally { await secondApp.close(); }
    expect((await app.inject({ method: "DELETE", url: `${url}/city-001`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `${url}/city-001`, headers })).statusCode).toBe(204);
    expect((await app.inject({ url, headers })).json().destinations).toEqual([]);
  });
  it("isolates users and guests in every direction, ignoring query ownership", async () => {
    const identities = await Promise.all([identity("guest"), identity("guest"), identity("user"), identity("user")]);
    for (let i = 0; i < identities.length; i++) {
      expect((await app.inject({ method: "POST", url, headers: identities[i], payload: { destinationId: `city-00${i + 1}` } })).statusCode).toBe(200);
    }
    for (let i = 0; i < identities.length; i++) {
      const headers = identities[i];
      expect((await app.inject({ url: `${url}?ownerType=user&ownerId=other`, headers })).json().destinations.map((r: { destinationId: string }) => r.destinationId)).toEqual([`city-00${i + 1}`]);
      for (let j = 0; j < identities.length; j++) if (i !== j) await app.inject({ method: "DELETE", url: `${url}/city-00${j + 1}`, headers });
    }
    for (const headers of identities) expect((await app.inject({ url, headers })).json().destinations).toHaveLength(1);
  });
  it("validates IDs and ownership fields, rejects unknown destinations and invalid origins", async () => {
    const headers = await identity("guest");
    for (const destinationId of ["Paris", "", {}, "city-001/other"]) expect((await app.inject({ method: "POST", url, headers, payload: { destinationId } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers, payload: { destinationId: "city-999" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers, payload: { destinationId: "city-001", ownerId: "other" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: `${url}/invalid`, headers })).statusCode).toBe(400);
    for (const method of ["POST", "DELETE"] as const) expect((await app.inject({ method, url: method === "POST" ? url : `${url}/city-001`, headers: { ...headers, origin: "https://evil.example" } })).statusCode).toBe(403);
  });
  it("requires identity and rejects expired guests without reassignment", async () => {
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url: `${url}/status` })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { origin }, payload: { destinationId: "city-001" } })).statusCode).toBe(401);
    const headers = await identity("guest");
    await mongoose.connection.db!.collection("sessions").updateMany({}, { $set: { expires: new Date(0) } });
    const expired = await app.inject({ url, headers });
    expect(expired.statusCode).toBe(401); expect(expired.json().code).toBe("GUEST_SESSION_EXPIRED");
  });
  it("enforces the unique index and retains unavailable records gracefully", async () => {
    const filter = { ownerType: "guest", ownerId: "index-fixture", destinationId: "city-999" };
    await SavedDestinationModel.create(filter);
    await expect(SavedDestinationModel.create(filter)).rejects.toMatchObject({ code: 11000 });
    const indexes = await SavedDestinationModel.collection.indexes();
    expect(indexes.some(index => index.key.createdAt === -1 && index.key.ownerId === 1)).toBe(true);
    expect(JSON.stringify(DESTINATIONS)).toBe(snapshot);
    const headers = await identity("guest");
    const session = (await app.inject({ url: "/api/auth/session?identity=1", headers })).json();
    await SavedDestinationModel.create({ ...filter, ownerId: session.guest.id });
    expect((await app.inject({ url, headers })).json().destinations[0].destination).toBeNull();
    expect((await app.inject({ method: "DELETE", url: `${url}/city-999`, headers })).statusCode).toBe(204);
  });
  it("does not consume trip storage or AI allowances", async () => {
    const headers = await identity("guest");
    const before = (await app.inject({ url: "/api/guest/usage", headers })).json();
    await app.inject({ method: "POST", url, headers, payload: { destinationId: "city-001" } });
    expect((await app.inject({ url: "/api/guest/usage", headers })).json()).toEqual(before);
    expect((await app.inject({ url: "/api/trips", headers })).json()).toEqual([]);
  });
  it("does not leak database failures", async () => {
    const headers = await identity("guest");
    const spy = vi.spyOn(SavedDestinationModel, "find").mockImplementationOnce(() => { throw new Error("secret database credentials"); });
    try { const response = await app.inject({ url, headers }); expect(response.statusCode).toBe(500); expect(response.body).not.toContain("secret"); } finally { spy.mockRestore(); }
  });
});
