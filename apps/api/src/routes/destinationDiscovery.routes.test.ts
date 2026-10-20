import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DESTINATIONS, destinationFiltersSchema, normalizeDestinationText } from "@triply/shared";
import { createApp } from "../app.js";
import { DestinationModel } from "../models/Destination.js";
import { seedDestinations } from "../seed/destinations.js";

vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await seedDestinations();
  // Test-only curated enrichment exercises support without classifying production destinations.
  const barcelona = await DestinationModel.findOne({ id: "city-003" }).orFail();
  barcelona.region = "Test Region"; barcelona.aliases = ["Localized test alias"];
  barcelona.interests = ["culture", "food", "food"]; await barcelona.save();
  const madrid = await DestinationModel.findOne({ id: "city-004" }).orFail();
  madrid.interests = ["architecture"]; await madrid.save();
  const krakow = await DestinationModel.findOne({ id: "city-023" }).orFail(); krakow.city = "Kraków"; await krakow.save();
  app = await createApp();
}, 120_000);
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });
async function list(params: Record<string, string> = {}) {
  const response = await app.inject({ url: `/api/destinations?${new URLSearchParams(params)}` });
  expect(response.statusCode).toBe(200); return response.json();
}
const ids = (body: { items: { id: string }[] }) => body.items.map(item => item.id);
describe("destination discovery", () => {
  it.each(["barce", "BARCELONA", "  bArCeLoNa   "])("searches partial city text %s", async q => {
    expect(ids(await list({ q }))).toEqual(["city-003"]);
  });
  it("searches country across the whole catalog before pagination", async () => {
    const spain = DESTINATIONS.filter(row => row.country === "Spain");
    const first = await list({ q: "spain", pageSize: "2" });
    const next = await list({ q: "spain", pageSize: "2", page: "2" });
    expect(first.total).toBe(spain.length); expect(first.items).toHaveLength(2);
    expect(ids(next).every(id => !ids(first).includes(id))).toBe(true);
    expect([...first.items, ...next.items].every(item => item.country === "Spain")).toBe(true);
  });
  it.each(["krakow", "KRAKÓW"])("folds diacritics %s", async q => { expect(ids(await list({ q }))).toContain("city-023"); });
  it.each(["test region", "  TEST   REGION  ", "localized test alias"])("searches curated region or alias %s", async q => {
    expect(ids(await list({ q }))).toEqual(["city-003"]);
  });
  it("normalizes an empty query and repeated whitespace", async () => {
    expect(await list({ q: "   " })).toEqual(await list());
    expect(ids(await list({ q: "barcelona    spain" }))).toEqual(["city-003"]);
  });
  it.each([".*", "(a+)+$", "[", "$where", "barce|madrid"])("treats regex-like text literally: %s", async q => {
    expect((await list({ q })).total).toBe(0);
  });
  it("rejects oversized search and invalid structured filter input", async () => {
    for (const suffix of [`q=${"x".repeat(121)}`, "country[x]=spain", "interests=unknown", "region=spain:test%20region", "country=spain&country=italy"]) {
      expect((await app.inject({ url: `/api/destinations?${suffix}` })).statusCode).toBe(400);
    }
  });
  it("uses real country keys and applies country before pagination", async () => {
    const body = await list({ country: "SPAIN", pageSize: "1", page: "2" });
    expect(body.total).toBe(10); expect(body.items).toHaveLength(1); expect(body.items[0].country).toBe("Spain");
  });
  it("filters regions within their country and does not match ambiguous regions elsewhere", async () => {
    expect(ids(await list({ country: "spain", region: "spain:test region" }))).toEqual(["city-003"]);
    expect((await list({ country: "france", region: "spain:test region" })).total).toBe(0);
  });
  it("uses OR within interests, AND across groups and never matches unclassified rows", async () => {
    expect(new Set(ids(await list({ interests: "culture,architecture" })))).toEqual(new Set(["city-003", "city-004"]));
    expect(ids(await list({ interests: "culture,food,food", country: "spain", q: "barce", region: "spain:test region" }))).toEqual(["city-003"]);
    expect((await list({ interests: "culture", country: "italy" })).total).toBe(0);
    expect((await list({ interests: "nature" })).total).toBe(0);
  });
  it.each(["name-asc", "name-desc", "country-asc"])("sorts %s with stable secondary IDs across pages", async sort => {
    const body = await list({ sort, pageSize: "48" });
    const fields = body.items.map((row: { city: string; country: string }) => sort === "country-asc" ? `${normalizeDestinationText(row.country)}|${normalizeDestinationText(row.city)}` : normalizeDestinationText(row.city));
    expect(fields).toEqual([...fields].sort().map((value, index, array) => sort === "name-desc" ? array[array.length - index - 1] : value));
    const next = await list({ sort, page: "2", pageSize: "48" });
    expect(ids(next).every(id => !ids(body).includes(id))).toBe(true);
    expect(await list({ sort, pageSize: "48" })).toEqual(body);
  });
  it("uses IDs to break ties between equal names", async () => {
    const madrid = await DestinationModel.findOne({ id: "city-004" }).orFail();
    const original = madrid.city; madrid.city = "Barcelona"; await madrid.save();
    try { for (const sort of ["name-asc", "name-desc"]) expect(ids(await list({ q: "barcelona", sort }))).toEqual(["city-003", "city-004"]); }
    finally { madrid.city = original; await madrid.save(); }
  });
  it("falls back safely for invalid sorts", async () => { expect(await list({ sort: "rating" })).toEqual(await list({ sort: "name-asc" })); });
  it("clamps pages after filtering and resets empty result pages to one", async () => {
    expect(await list({ q: "barce", page: "9999" })).toMatchObject({ total: 1, page: 1 });
    expect(await list({ q: "no such destination", page: "9999" })).toMatchObject({ items: [], total: 0, page: 1 });
  });
  it("returns accurate global metadata, deduplicating interest counts and excluding private/derived data", async () => {
    const response = await app.inject({ url: "/api/destinations/filters" });
    const metadata = destinationFiltersSchema.parse(response.json());
    expect(response.cookies).toEqual([]); expect(response.headers["cache-control"]).toContain("max-age=300");
    expect(metadata.total).toBe(212);
    expect(metadata.countries.find(row => row.id === "spain")).toEqual({ id: "spain", name: "Spain", count: 10 });
    expect(metadata.regions).toEqual([{ id: "spain:test region", countryId: "spain", name: "Test Region", count: 1 }]);
    expect(metadata.interests.find(row => row.id === "food")).toEqual({ id: "food", label: "Food", count: 1 });
    expect(metadata.interests.some(row => row.id === "nature")).toBe(false);
    const body = await list({ q: "barce" });
    for (const field of ["_id", "searchText", "nameSort", "countryKey", "user", "ownerId"]) expect(body.items[0]).not.toHaveProperty(field);
  });
  it("refreshes derived fields during idempotent seeding without overwriting curation", async () => {
    await DestinationModel.updateOne({ id: "city-003" }, { $set: { aliases: ["Backfilled alias"], searchText: "stale" } });
    await seedDestinations();
    expect(ids(await list({ q: "backfilled alias" }))).toEqual(["city-003"]);
    expect(await DestinationModel.countDocuments()).toBe(212);
    expect((await list({ q: "barce" })).items[0]).toMatchObject({ region: "Test Region", interests: ["culture", "food", "food"] });
  });
});
