import { afterAll, beforeAll, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DESTINATIONS, catalogDestinationSchema, destinationQuerySchema } from "@triply/shared";
import { createApp } from "../app.js";
import { seedDestinations } from "../seed/destinations.js";
import { DestinationModel } from "../models/Destination.js";
import { SavedDestinationModel } from "../models/SavedDestination.js";
import { discoveryFilter, discoverySort } from "../services/destinationDiscovery.js";
import { env } from "../config/env.js";

vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
let address = 0;
const get = (url: string) => app.inject({ url, remoteAddress: `192.0.2.${++address}` });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await seedDestinations(); app = await createApp();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external providers permitted"); }));
}, 120_000);
afterAll(async () => { vi.unstubAllGlobals(); await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });
it("audits the existing seed without changing canonical IDs or inventing metadata", () => {
  expect(DESTINATIONS).toHaveLength(212); expect(new Set(DESTINATIONS.map(row => row.id)).size).toBe(212);
  expect(new Set(DESTINATIONS.map(row => `${row.city}|${row.country}`)).size).toBe(212);
  expect(DESTINATIONS.every(row => catalogDestinationSchema.safeParse(row).success)).toBe(true);
  expect(DESTINATIONS.every(row => !("coordinates" in row) && !("countryCode" in row))).toBe(true);
});
it("excludes malformed identities and blank names before counts, pages and metadata", async () => {
  await DestinationModel.collection.insertMany([
    { id: "city-996", city: "   ", country: "Spain", countryKey: "spain", nameSort: "" },
    { id: "city-997", city: null, country: "Spain", countryKey: "spain", nameSort: "" },
    { id: ["city-998"], city: "Invalid array ID", country: "Spain", countryKey: "spain" },
  ]);
  try {
    const list = (await get("/api/destinations?pageSize=24")).json();
    expect(list.total).toBe(212); expect(list.items).toHaveLength(24);
    expect((await get("/api/destinations/filters")).json().total).toBe(212);
    const last = (await get("/api/destinations?page=9999")).json(); expect(last.page).toBe(9); expect(last.items).toHaveLength(20);
  } finally { await DestinationModel.collection.deleteMany({ id: { $in: ["city-996", "city-997", "city-998"] } }); }
});
it("searches actual Krakow catalog data and an isolated real São Paulo fixture with diacritic variants", async () => {
  for (const q of ["Kraków", "krakow", "KRAKOW"]) expect((await get(`/api/destinations?q=${encodeURIComponent(q)}`)).json().items.map((row: { id: string }) => row.id)).toContain("city-023");
  await DestinationModel.create({ id: "city-998", city: "São Paulo", country: "Brazil" });
  try { for (const q of ["São Paulo", "sao paulo", "  SÃO   PAULO "]) expect((await get(`/api/destinations?q=${encodeURIComponent(q)}`)).json().items[0]).toMatchObject({ id: "city-998", city: "São Paulo", country: "Brazil" }); }
  finally { await DestinationModel.deleteOne({ id: "city-998" }); }
});
it("traverses every page once for each supported sort and clamps after a catalog deletion", async () => {
  for (const sort of ["name-asc", "name-desc", "country-asc"]) {
    const ids: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const body = (await get(`/api/destinations?sort=${sort}&pageSize=48&page=${page}`)).json();
      ids.push(...body.items.map((row: { id: string }) => row.id)); expect(body.total).toBe(212);
    }
    expect(new Set(ids).size).toBe(212); expect(new Set(ids)).toEqual(new Set(DESTINATIONS.map(row => row.id)));
  }
  const tail = (await get("/api/destinations?page=9")).json().items;
  await DestinationModel.deleteMany({ id: { $in: tail.map((row: { id: string }) => row.id) } });
  try { expect((await get("/api/destinations?page=9")).json()).toMatchObject({ total: 192, page: 8 }); }
  finally { await seedDestinations(); }
});
it("uses the persisted catalog in Saved, retains deleted references and rejects new saves of deleted IDs", async () => {
  const response = await app.inject({ method: "POST", url: "/api/auth/guest", remoteAddress: "192.0.2.222", headers: { origin: env.WEB_ORIGIN } });
  const headers = { origin: env.WEB_ORIGIN, cookie: response.cookies.map(row => `${row.name}=${row.value}`).join("; ") };
  await DestinationModel.updateOne({ id: "city-003" }, { $set: { photographer: "Curated fixture credit" } });
  const save = () => app.inject({ method: "POST", url: "/api/saved/destinations", headers, payload: { destinationId: "city-003" } });
  expect((await save()).statusCode).toBe(200);
  expect((await app.inject({ url: "/api/saved/destinations", headers })).json().destinations[0].destination.photographer).toBe("Curated fixture credit");
  await DestinationModel.deleteOne({ id: "city-003" });
  expect((await app.inject({ url: "/api/saved/destinations", headers })).json().destinations[0].destination).toBeNull();
  expect((await save()).statusCode).toBe(404); expect(await SavedDestinationModel.countDocuments()).toBe(1);
  await seedDestinations();
});
it.each(["?q[$ne]=x", "?country[$ne]=x", "?pageSize=9999999999", `?q=${"a".repeat(121)}`, "?interests[$in]=food"])("rejects unsafe query %s", async query => {
  expect((await get(`/api/destinations${query}`)).statusCode).toBe(400);
});
it("normalizes URL spellings before rejecting embedded image/link credentials", () => {
  for (const value of ["javascript:alert(1)", "data:image/png;base64,x", "https://user:secret@example.com/x", "https:\\user:secret@example.com/x"]) {
    expect(catalogDestinationSchema.shape.imageUrl.parse(value)).toBe("");
    expect(catalogDestinationSchema.shape.sourceUrl.parse(value)).toBe("");
  }
});
it("limits public reads without creating guest sessions and exposes retry guidance", async () => {
  let last;
  for (let index = 0; index < 121; index++) last = await app.inject({ url: "/api/destinations/city-001", remoteAddress: "198.51.100.123" });
  expect(last!.statusCode).toBe(429); expect(last!.headers["retry-after"]).toBeDefined(); expect(last!.cookies).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
it("has an index for descending name plus stable ID and avoids redundant derived-field writes", async () => {
  const query = destinationQuerySchema.parse({ sort: "name-desc" });
  const explained = await DestinationModel.find(discoveryFilter(query)).sort(discoverySort(query.sort)).limit(24).hint({ nameSort: -1, id: 1 }).explain("executionStats") as unknown as {
    executionStats: { nReturned: number; totalDocsExamined: number; totalKeysExamined: number };
    queryPlanner: { winningPlan: unknown };
  };
  expect(explained.executionStats.nReturned).toBe(24);
  expect(JSON.stringify(explained.queryPlanner.winningPlan)).toContain("IXSCAN");
  const bulk = vi.spyOn(DestinationModel, "bulkWrite");
  await seedDestinations(); expect(bulk).toHaveBeenCalledTimes(1); // ID upserts only; derived values are unchanged.
  bulk.mockRestore();
  console.info(JSON.stringify({ exploreQuery: { returned: explained.executionStats.nReturned, docsExamined: explained.executionStats.totalDocsExamined, keysExamined: explained.executionStats.totalKeysExamined } }));
});
