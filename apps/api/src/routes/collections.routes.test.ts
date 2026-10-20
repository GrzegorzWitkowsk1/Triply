import { afterAll, beforeAll, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { CURATED_COLLECTIONS, collectionForDestination, findCuratedCollection, findDestination, INTEREST_OPTIONS, PACE_VALUES } from "@triply/shared";
import { createApp } from "../app.js";
import { DestinationModel } from "../models/Destination.js";
import { seedDestinations } from "../seed/destinations.js";

let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await seedDestinations(); app = await createApp(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External browsing calls forbidden"); })); }, 120_000);
afterAll(async () => { vi.unstubAllGlobals(); await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });
it("keeps four ordered editorial definitions with valid canonical city-country references and supported preferences", () => {
  expect(CURATED_COLLECTIONS.map(row => row.displayOrder)).toEqual([1, 2, 3, 4]);
  const identities = { "city-003": ["Barcelona", "Spain"], "city-140": ["Bologna", "Italy"], "city-005": ["Rome", "Italy"], "city-025": ["Prague", "Czech Republic"], "city-011": ["Lisbon", "Portugal"], "city-002": ["Nice", "France"], "city-017": ["Vienna", "Austria"] };
  for (const collection of CURATED_COLLECTIONS) {
    expect(new Set(collection.destinationIds).size).toBe(collection.destinationIds.length);
    for (const id of collection.destinationIds) { const city = findDestination(id)!; expect([city.city, city.country]).toEqual(identities[id as keyof typeof identities]); }
    expect(collection.suggestedInterests.every(id => INTEREST_OPTIONS.some(option => option.id === id))).toBe(true);
    expect(PACE_VALUES).toContain(collection.suggestedPace);
  }
});
it.each(CURATED_COLLECTIONS)("publicly resolves $slug in editorial order in one bounded query", async collection => {
  const find = vi.spyOn(DestinationModel, "find");
  const response = await app.inject(`/api/destinations/collections/${collection.slug}`);
  expect(response.statusCode).toBe(200); expect(response.cookies).toEqual([]);
  expect(response.json().items.map((item: { id: string }) => item.id)).toEqual(collection.destinationIds);
  expect(find).toHaveBeenCalledTimes(1); find.mockRestore();
  for (const row of response.json().items) { expect(row).not.toHaveProperty("_id"); expect(row).not.toHaveProperty("searchText"); expect(row).not.toHaveProperty("user"); }
  expect(await mongoose.connection.collection("sessions").countDocuments()).toBe(0);
  expect(await mongoose.connection.collection("guest_usage").countDocuments()).toBe(0);
  expect(await mongoose.connection.collection("trips").countDocuments()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["unknown", "invalid-slug", "a".repeat(200), "%E0%A4%A"])("rejects invalid collection %s without unrelated content", async slug => {
  const result = await app.inject(`/api/destinations/collections/${slug}`);
  expect([400, 404]).toContain(result.statusCode); expect(result.json()).not.toHaveProperty("items"); expect(result.cookies).toEqual([]);
});
it("retains available destinations, and returns an actual empty collection when none remain", async () => {
  await DestinationModel.deleteOne({ id: "city-003" });
  expect((await app.inject("/api/destinations/collections/food-first-weekends")).json().items.map((item: { id: string }) => item.id)).toEqual(["city-140"]);
  await DestinationModel.deleteOne({ id: "city-140" });
  expect((await app.inject("/api/destinations/collections/food-first-weekends")).json()).toEqual({ slug: "food-first-weekends", items: [] });
  await seedDestinations();
  expect((await app.inject("/api/destinations/city-003")).json().city).toBe("Barcelona");
});
it("validates membership and ignores malformed, duplicate or untrusted collection suggestions", () => {
  expect(collectionForDestination(["architecture-and-icons"], "city-003")?.suggestedInterests).toEqual(["architecture", "culture"]);
  for (const values of [[], ["unknown"], ["food-first-weekends", "culture-deep-dives"], ["x".repeat(3000)]]) expect(collectionForDestination(values, "city-003")).toBeUndefined();
  expect(collectionForDestination(["culture-deep-dives"], "city-003")).toBeUndefined();
  expect(collectionForDestination(["food-first-weekends"], undefined)).toBeUndefined();
  expect(findCuratedCollection({ $ne: null })).toBeUndefined();
});
