import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import type { FastifyInstance } from "fastify";
import { ATTACHMENT_LIMITS as L, supplementalRequirementsSchema, type TripAnalysis } from "@triply/shared";
import { TripModel } from "../models/Trip.js";
import { env } from "../config/env.js";
import PDFDocument from "pdfkit";
import * as planner from "../services/tripPlanner.js";

const mocks = vi.hoisted(() => ({ baseline: vi.fn(), supplemental: vi.fn(), parseTrip: vi.fn(), lookup: vi.fn(), geocode: vi.fn(), extracted: [] as string[] }));
vi.mock("../ai/index.js", () => ({ aiService: { parseTrip: mocks.parseTrip, parseCreationPrompt: mocks.baseline, parseAttachments: mocks.supplemental } }));
vi.mock("../services/weather.js", async original => ({ ...await original<typeof import("../services/weather.js")>(), ensureWeatherData: vi.fn(async () => ({ days: [], fetchedAt: new Date() })) }));
vi.mock("../services/attractions.js", () => ({ fetchAttractions: vi.fn(async () => [{ name: "Park", category: "nature", lat: 41.891, lng: 12.491, placeId: "node/1", score: 70 }]), lookupCreationAttractions: mocks.lookup }));
vi.mock("../routing/index.js", () => ({ createRoutingProvider: () => null }));
let mongo: MongoMemoryServer, app: FastifyInstance;
let headers: Record<string, string>;
let serial = 0;
const analysis: TripAnalysis = { destination: "Rome", country: "Italy", startDate: "2030-07-01", endDate: "2030-07-03", durationDays: 3, travelers: 2,
  budget: { amount: 500, currency: "EUR", type: "total" }, interests: [], pace: null, maxWalkingDistanceKm: null, notes: null };
const rome = { name: "Rome", country: "Italy", country_code: "IT", latitude: 41.89, longitude: 12.49 };
const location = { lat: rome.latitude, lng: rome.longitude, city: "Rome", country: "Italy" };
const { notes: _notes, ...baselineFields } = analysis;
const suggestions = supplementalRequirementsSchema.parse({ ...baselineFields, destination: "Paris", country: "France", durationDays: 7, budget: { amount: 9999, currency: "USD", type: "total" }, interests: ["food"], requestedAttractions: ["Colosseum", "Unknown Place"], excludedAttractions: [] });
function multipart(files: { name: string; type: string; bytes: Buffer }[] = [{ name: "private.txt", type: "text/plain", bytes: Buffer.from("PRIVATE DOCUMENT FOOD Colosseum") }], metadata = JSON.stringify({ prompt: "Three days Rome budget EUR 500", badges: [] }), extra = "") {
  const boundary = "triply-attachment-test";
  const parts: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${metadata}\r\n`)];
  for (const file of files) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.bytes, Buffer.from("\r\n"));
  if (extra) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="unexpected"\r\n\r\n${extra}\r\n`));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` } as Record<string, string> };
}
const analyze = (options = multipart()) => app.inject({ method: "POST", url: "/api/trips/analyze", ...options });
async function textPdf(): Promise<Buffer> {
  const doc = new PDFDocument();
  const bytes = new Promise<Buffer>(resolve => { const chunks: Buffer[] = []; doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); });
  doc.text("Colosseum. Prefer local food."); doc.end(); return bytes;
}
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); }, 120000);
beforeEach(async () => {
  // The real resolver must narrow by country before the provider's 100-result cap.
  // A global search reproduces the QA failure; no real providers are called.
  mocks.geocode.mockImplementation(async (input: string) => {
    const url = new URL(input);
    expect(url.hostname).toBe("geocoding-api.open-meteo.com");
    return Response.json({ results: url.searchParams.get("name") === "Rome, italy" ? [rome] :
      [rome, ...Array.from({ length: 99 }, () => ({ ...rome, country: "United States", country_code: "US" }))] });
  });
  vi.stubGlobal("fetch", mocks.geocode);
  app = await (await import("../app.js")).createApp();
  const account = await app.inject({ method: "POST", url: "/api/auth/register", headers: { origin: env.WEB_ORIGIN }, payload: { email: `attachment${serial++}@test.local`, password: "Original123!Aa" } });
  expect(account.statusCode).toBe(201);
  headers = { origin: env.WEB_ORIGIN, cookie: account.cookies.map(c => `${c.name}=${c.value}`).join("; ") };
  mocks.baseline.mockResolvedValue({ analysis, requestedAttractions: [], excludedAttractions: [] }); mocks.parseTrip.mockResolvedValue(analysis);
  mocks.supplemental.mockImplementation(async (texts: string[]) => { mocks.extracted = [...texts]; return suggestions; });
  mocks.lookup.mockResolvedValue({ available: true, matches: [{ name: "Colosseum", place: { name: "Colosseum", category: "culture", lat: 41.8902, lng: 12.4922, placeId: "way/42", score: 75, openingHours: { raw: "24/7", source: "osm", checkedAt: null } } }] });
});
afterEach(async () => { await app.close(); for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({}); vi.clearAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
describe("authenticated initial attachment creation", () => {
  it("preserves JSON compatibility without additional AI calls", async () => {
    const response = await app.inject({ method: "POST", url: "/api/trips/analyze", headers, payload: { prompt: "Rome", badges: [] } });
    expect(response.statusCode).toBe(200); expect(mocks.parseTrip).toHaveBeenCalledTimes(1); expect(mocks.supplemental).not.toHaveBeenCalled(); expect(response.json().attachmentContext).toBeUndefined();
    const generated = await app.inject({ method: "POST", url: `/api/trips/${response.json().draftId}/generate`, headers });
    expect(generated.statusCode, generated.body).toBe(200);
    expect(generated.json().analysis.location).toEqual(location);
    expect(mocks.geocode).toHaveBeenCalledOnce(); expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("persists only validated requirements and can generate after requirements review without reupload", async () => {
    mocks.baseline.mockResolvedValueOnce({ analysis: { ...analysis, endDate: "2030-07-05", durationDays: 5 }, requestedAttractions: [], excludedAttractions: [] });
    const response = await analyze(multipart([{ name: "rome_attractions.pdf", type: "application/pdf", bytes: await textPdf() }], JSON.stringify({ prompt: "Plan a 5-day trip to Rome", badges: [] })));
    expect(response.statusCode).toBe(200);
    expect(response.json().analysis).toMatchObject({ destination: "Rome", country: "Italy", durationDays: 5, location, budget: analysis.budget, interests: ["food"] });
    const id = response.json().draftId;
    const stored = JSON.stringify(await TripModel.findById(id).lean());
    expect(stored).not.toContain("PRIVATE DOCUMENT"); expect(stored).not.toContain("private.txt");
    const corrected = await app.inject({ method: "PATCH", url: `/api/trips/${id}/requirements`, headers, payload: { answers: { pace: "relaxed", travelers: 3 }, confirmedFields: [] } });
    expect(corrected.statusCode).toBe(200); expect(corrected.json().analysis.travelers).toBe(3);
    expect(corrected.json().analysis.location).toEqual(location);
    const confirm = await app.inject({ method: "POST", url: `/api/trips/${id}/confirm`, headers }); expect(confirm.statusCode).toBe(200);
    expect(confirm.json().analysis.location).toEqual(location);
    const loaded = await app.inject({ url: `/api/trips/${id}`, headers });
    expect(loaded.json().analysis.location).toEqual(location);
    const generated = await app.inject({ method: "POST", url: `/api/trips/${id}/generate`, headers });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().analysis).toMatchObject({ destination: "Rome", country: "Italy", location, travelers: 3, pace: "relaxed" });
    expect(mocks.geocode).toHaveBeenCalledOnce();
    expect(mocks.lookup).toHaveBeenCalledWith(location.lat, location.lng, ["Colosseum", "Unknown Place"]);
    expect(generated.json().requestedAttractionOutcomes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Colosseum", status: "included" }), expect.objectContaining({ name: "Unknown Place", status: "unresolved" })]));
    expect((await TripModel.findById(id))?.creationContext).toBeNull(); expect(mocks.supplemental).toHaveBeenCalledTimes(1);
  });
  it("rejects guests and anonymous uploads before extraction or AI but retains guest JSON access", async () => {
    const guest = await app.inject({ method: "POST", url: "/api/auth/guest", headers: { origin: env.WEB_ORIGIN } });
    const guestCookie = guest.cookies.map(c => `${c.name}=${c.value}`).join("; ");
    for (const cookie of ["", guestCookie]) {
      const request = multipart(); request.headers.cookie = cookie;
      const response = await analyze(request); expect(response.statusCode).toBe(401); expect(response.json().code).toBe("ATTACHMENT_AUTH_REQUIRED");
    }
    expect(mocks.baseline).not.toHaveBeenCalled();
    const promptOnly = await app.inject({ method: "POST", url: "/api/trips/analyze", headers: { origin: env.WEB_ORIGIN, cookie: guestCookie }, payload: { prompt: "Rome" } });
    expect(promptOnly.statusCode).toBe(200); expect(mocks.parseTrip).toHaveBeenCalledTimes(1);
  });
  it("reads a real PDF through multipart and adopts validated travel preferences", async () => {
    const response = await analyze(multipart([{ name: "inspiration.pdf", type: "application/pdf", bytes: await textPdf() }]));
    expect(response.statusCode).toBe(200); expect(mocks.extracted[0]).toContain("Colosseum");
    expect(response.json().analysis.interests).toEqual(["food"]); expect(response.json().attachmentContext.requestedAttractions).toContain("Colosseum");
  });
  it("retains only structured context after generation failure and retries without reupload", async () => {
    const response = await analyze(); const id = response.json().draftId;
    const spy = vi.spyOn(planner, "planTrip").mockRejectedValueOnce(new Error("temporary routing failure"));
    const failed = await app.inject({ method: "POST", url: `/api/trips/${id}/generate`, headers }); expect(failed.statusCode).toBe(502); spy.mockRestore();
    expect((await TripModel.findById(id))?.creationContext?.requestedAttractions).toContain("Colosseum");
    expect((await TripModel.findById(id))?.toObject().analysis.location).toEqual(location);
    const retried = await app.inject({ method: "POST", url: `/api/trips/${id}/generate`, headers }); expect(retried.statusCode).toBe(200);
    expect(retried.json().requestedAttractionOutcomes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Colosseum", status: "included" })]));
    expect(mocks.supplemental).toHaveBeenCalledOnce(); expect((await TripModel.findById(id))?.creationContext).toBeNull();
    expect(retried.json().analysis.location).toEqual(location);
    expect(mocks.geocode).toHaveBeenCalledOnce();
  });
  it("keeps confirmed destination metadata when attachment place lookup fails", async () => {
    mocks.baseline.mockResolvedValueOnce({ analysis: { ...analysis, destinationId: "city-005", location }, requestedAttractions: [], excludedAttractions: [] });
    const response = await analyze();
    expect(response.json().analysis).toMatchObject({ destinationId: "city-005", destination: "Rome", country: "Italy", location });
    mocks.lookup.mockRejectedValueOnce(new Error("places unavailable"));
    const generated = await app.inject({ method: "POST", url: `/api/trips/${response.json().draftId}/generate`, headers });
    expect(generated.statusCode, generated.body).toBe(200);
    expect(generated.json().analysis).toMatchObject({ destinationId: "city-005", destination: "Rome", country: "Italy", location });
    expect(generated.json().requestedAttractionOutcomes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Colosseum", status: "unresolved", reason: "provider_unavailable" })]));
    expect(mocks.lookup).toHaveBeenCalledWith(location.lat, location.lng, ["Colosseum", "Unknown Place"]);
    expect(mocks.geocode).not.toHaveBeenCalled();
  });
  it("keeps genuine unresolved destination ambiguity actionable", async () => {
    mocks.geocode.mockImplementation(async () => Response.json({ results: [rome, { ...rome, longitude: 13 }] }));
    const response = await analyze(); expect(response.statusCode).toBe(200);
    const id = response.json().draftId;
    expect(response.json().analysis.location).toBeNull();
    const generated = await app.inject({ method: "POST", url: `/api/trips/${id}/generate`, headers });
    expect(generated.statusCode).toBe(400);
    expect(generated.json().error).toBe("This destination matches more than one city. Please select a more specific destination.");
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect((await TripModel.findById(id))?.analysis.destination).toBe("Rome");
  });
  it("blocks failed files with indexed errors and saves no draft", async () => {
    const response = await analyze(multipart([{ name: "valid.txt", type: "text/plain", bytes: Buffer.from("Rome") }, { name: "empty.txt", type: "text/plain", bytes: Buffer.alloc(0) }]));
    expect(response.statusCode).toBe(422); expect(response.json().failures).toEqual([{ index: 1, code: "ATTACHMENT_EMPTY" }]);
    expect(mocks.baseline).not.toHaveBeenCalled(); expect(await TripModel.countDocuments()).toBe(0);
  });
  it("rejects unexpected fields and malformed metadata", async () => {
    expect((await analyze(multipart(undefined, "{}", "extra"))).statusCode).toBe(400);
    const invalid = await analyze(multipart(undefined, "{broken")); expect(invalid.json().code).toBe("ATTACHMENT_METADATA");
    expect(mocks.baseline).not.toHaveBeenCalled();
  });
  it("enforces count, transport size, and metadata bounds before AI", async () => {
    const count = await analyze(multipart(Array.from({ length: 4 }, (_, i) => ({ name: `${i}.txt`, type: "text/plain", bytes: Buffer.from(String(i)) })))); expect(count.statusCode).toBe(400);
    const size = multipart(); size.headers["content-length"] = String(L.transportBytes + 1);
    const oversized = await analyze(size); expect(oversized.statusCode).toBe(413);
    expect((await analyze(multipart(undefined, "x".repeat(L.metadataBytes + 1)))).statusCode).toBe(400);
    expect(mocks.baseline).not.toHaveBeenCalled();
  });
  it("redacts provider failures and persists no private content", async () => {
    const log = vi.spyOn(console, "error"); mocks.supplemental.mockRejectedValueOnce(new Error("PRIVATE DOCUMENT provider rejection"));
    const response = await analyze(); expect(response.statusCode).toBe(502); expect(response.json().code).toBe("ATTACHMENT_AI_FAILED");
    expect(response.body).not.toContain("PRIVATE DOCUMENT"); expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE DOCUMENT"); expect(await TripModel.countDocuments()).toBe(0); log.mockRestore();
  });
  it("does not permit concurrent attachment analyses from the same account", async () => {
    let release!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    mocks.baseline.mockImplementationOnce(async () => { entered(); await gate; return { analysis, requestedAttractions: [], excludedAttractions: [] }; });
    const first = analyze().then(response => response); await started;
    const second = await analyze(); expect(second.statusCode).toBe(429); expect(second.json().code).toBe("ATTACHMENT_BUSY");
    release(); expect((await first).statusCode).toBe(200);
  });
  it("enforces an attachment-specific rate limit independently of itinerary quotas", async () => {
    for (let i = 0; i < 6; i++) expect((await analyze(multipart(undefined, "{}"))).statusCode).toBe(400);
    const limited = await analyze(); expect(limited.statusCode).toBe(429); expect(limited.json().code).toBe("ATTACHMENT_RATE_LIMIT");
    expect(mocks.baseline).not.toHaveBeenCalled();
  });
});
