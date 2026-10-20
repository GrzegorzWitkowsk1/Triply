import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DESTINATIONS, findDestination, normalizeDestinationText, catalogDestinationSchema } from "@triply/shared";
import { createApp } from "../app.js";
import { DestinationModel } from "../models/Destination.js";
import { seedDestinations } from "../seed/destinations.js";
import { env } from "../config/env.js";

vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  await seedDestinations(); app = await createApp();
}, 120_000);
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });
const list = (query = "") => app.inject({ url: `/api/destinations${query}` });
describe("public persisted destination catalog", () => {
  it("lists existing IDs and names without session creation or private fields", async () => {
    const response = await list();
    expect(response.statusCode).toBe(200); expect(response.cookies).toEqual([]);
    const body = response.json();
    expect(body).toMatchObject({ total: DESTINATIONS.length, page: 1, pageSize: 24 });
    expect(body.items).toHaveLength(24);
    const first = [...DESTINATIONS].sort((a, b) => normalizeDestinationText(a.city).localeCompare(normalizeDestinationText(b.city)))[0]!;
    expect(body.items[0]).toEqual(catalogDestinationSchema.parse(findDestination(first.id)));
    expect(body.items.every((item: Record<string, unknown>) => !("_id" in item) && !("ownerId" in item))).toBe(true);
    expect(await mongoose.connection.db!.collection("sessions").countDocuments()).toBe(0);
  });
  it("orders by indexed name and canonical ID and has disjoint repeatable pages", async () => {
    const first = (await list("?page=1&pageSize=7")).json();
    const second = (await list("?page=2&pageSize=7")).json();
    expect(first).toEqual((await list("?page=1&pageSize=7")).json());
    const rows = [...first.items, ...second.items];
    const ids = rows.map(item => item.id);
    expect(rows.map(item => normalizeDestinationText(item.city))).toEqual(rows.map(item => normalizeDestinationText(item.city)).sort()); expect(new Set(ids).size).toBe(14);
    expect((await list("?page=10000")).json().page).toBe(Math.ceil(DESTINATIONS.length / 24));
    const indexes = await DestinationModel.collection.indexes();
    expect(indexes.some(index => index.key.id === 1 && index.unique)).toBe(true);
  });
  it.each(["?page=0", "?page=-1", "?page=1.5", "?page=abc", "?page=1000001", "?page=1&page=2", "?pageSize=0", "?pageSize=49", "?pageSize=1.2", "?pageSize=NaN", "?pageSize=Infinity"])("rejects invalid pagination %s", async query => {
    expect((await list(query)).statusCode).toBe(400);
  });
  it("enforces maximum page size", async () => {
    expect((await list("?pageSize=48")).json().items.length).toBe(Math.min(48, DESTINATIONS.length));
  });
  it("seeds idempotently, rejects duplicate IDs before writes, and preserves curated data and identity", async () => {
    await seedDestinations(); await seedDestinations();
    expect(await DestinationModel.countDocuments()).toBe(DESTINATIONS.length);
    await expect(seedDestinations([DESTINATIONS[0], DESTINATIONS[0]])).rejects.toThrow("Duplicate ID");
    await DestinationModel.updateOne({ id: "city-001" }, { $set: { photographer: "Curated credit" } });
    await seedDestinations();
    expect(await DestinationModel.findOne({ id: "city-001" }).lean()).toMatchObject({ city: "Paris", photographer: "Curated credit" });
    await DestinationModel.updateOne({ id: "city-001" }, { $set: { photographer: DESTINATIONS[0]!.photographer } });
    expect(await DestinationModel.countDocuments()).toBe(DESTINATIONS.length);
  });
  it("tolerates missing optional metadata, unsafe URLs and malformed rows without exposing provider data", async () => {
    await DestinationModel.collection.insertMany([
      { id: "city-998", city: "Incomplete", imageUrl: "javascript:alert(1)", providerSecret: "private" },
      { id: "city-999", country: "Incomplete" },
    ]);
    const response = (await list("?pageSize=48")).json();
    const row = response.items.find((item: { id: string }) => item.id === "city-998");
    expect(row).toMatchObject({ country: "", imageUrl: "", license: "" });
    expect(row).not.toHaveProperty("providerSecret");
    expect(response.items.some((item: { id: string }) => item.id === "city-999")).toBe(false);
    await DestinationModel.deleteMany({ id: { $in: ["city-998", "city-999"] } });
  });
  it("keeps Saved references usable for guest and authenticated identities", async () => {
    for (const kind of ["guest", "register"] as const) {
      const session = await app.inject({ method: "POST", url: `/api/auth/${kind}`, headers: { origin: env.WEB_ORIGIN },
        ...(kind === "register" ? { payload: { email: "catalog@example.com", password: "Original123!Aa" } } : {}) });
      expect(session.statusCode).toBe(kind === "guest" ? 200 : 201);
      const headers = { origin: env.WEB_ORIGIN, cookie: session.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") };
      const id = (await list()).json().items[0].id;
      expect((await app.inject({ method: "POST", url: "/api/saved/destinations", headers, payload: { destinationId: id } })).statusCode).toBe(200);
      expect((await app.inject({ url: "/api/saved/destinations", headers })).json().destinations[0].destination.id).toBe(id);
    }
  });
  it("returns an empty catalog without reseeding on reads", async () => {
    await DestinationModel.deleteMany({});
    expect((await list()).json()).toEqual({ items: [], total: 0, page: 1, pageSize: 24 });
    await seedDestinations();
  });
});
