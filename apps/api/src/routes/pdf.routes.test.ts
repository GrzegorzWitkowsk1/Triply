import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { TripModel } from "../models/Trip.js";
import { env } from "../config/env.js";
import { hashShareToken } from "./sharing.js";
import * as renderer from "../services/tripPdf.js";
vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
let db: MongoMemoryServer, app: FastifyInstance;
let userIndex = 0;
beforeAll(async () => { db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri()); app = await (await import("../app.js")).createApp(); }, 120_000);
afterEach(async () => { vi.restoreAllMocks(); for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({}); });
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await db?.stop(); });
async function register() {
  const response = await app.inject({ method: "POST", url: "/api/auth/register", headers: { origin: env.WEB_ORIGIN }, payload: { email: `pdf-${++userIndex}@example.com`, password: "Password123!Aa" } });
  expect(response.statusCode).toBe(201);
  const cookie = response.cookies.map(c => `${c.name}=${c.value}`).join("; ");
  return { cookie, user: response.json().user.id as string };
}
async function setup() {
  const { cookie, user } = await register();
  const trip = await TripModel.create({ user, status: "ready", itineraryVersion: 42, prompt: "PRIVATE PROMPT", sharing: { enabled: true, tokenHash: hashShareToken("a".repeat(43)) },
    analysis: { destination: "Łódź", country: "Polska", startDate: "2030-10-27", endDate: "2030-10-28", durationDays: 2,
      travelers: 1, budget: { amount: 12345, currency: "EUR", type: "total" }, notes: "PRIVATE NOTES", interests: [], pace: "balanced", maxWalkingDistanceKm: 5 },
    attractions: [{ placeId: "provider/internal", name: "Łódzkie muzeum", category: "culture", lat: 51, lng: 19, description: "Public description", address: "Public address" }],
    itinerary: { timeZone: "Europe/Warsaw", routingSource: "provider", unscheduled: [], days: [1, 2].map(dayIndex => ({ dayIndex, date: `2030-10-${26 + dayIndex}`, timeZone: "Europe/Warsaw",
      activities: [{ type: "attraction", placeId: "provider/internal", title: "Łódzkie muzeum", startTime: "2030-10-27T09:15:00+01:00", endTime: "2030-10-27T10:30:00+01:00", durationMinutes: 75,
        openingHoursCheck: { status: "unknown", reason: "PRIVATE DIAGNOSTIC", source: null, timeZone: null, intervals: [], warnings: ["PRIVATE DIAGNOSTIC"] } }],
      stops: [{ placeId: "provider/internal", name: "Łódzkie muzeum", category: "culture", lat: 51, lng: 19, score: null }],
      geometry: null, segments: [], totalVisitMinutes: 75, totalTravelMinutes: null, totalDistanceMeters: null, partiallyEstimated: true, warnings: ["PRIVATE DIAGNOSTIC"] })) },
  });
  return { cookie, trip, privateUrl: `/api/trips/${trip.id}/export/pdf`, publicUrl: `/api/public/trips/${"a".repeat(43)}/export/pdf` };
}
async function textFromPdf(bytes: Buffer): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }); const pdf = await task.promise;
  try { let text = ""; for (let i = 1; i <= pdf.numPages; i++) { const page = await pdf.getPage(i); text += (await page.getTextContent()).items.filter(i => "str" in i).map(i => i.str).join(""); } return text; }
  finally { await task.destroy(); }
}
describe("authorized persisted itinerary PDF endpoints", () => {
  it("exports owner PDF with proper headers and makes no database changes or provider calls", async () => {
    const ctx = await setup(); const before = await TripModel.findById(ctx.trip.id).select("+sharing.tokenHash").lean();
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("External providers forbidden"));
    const response = await app.inject({ url: ctx.privateUrl, headers: { cookie: ctx.cookie } });
    expect(response.statusCode).toBe(200); expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="triply-lodz-2030-10-27.pdf"'); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await textFromPdf(response.rawPayload); expect(text).toContain("Łódzkie muzeum"); expect(text).toContain("Day 2"); expect(text).toContain("09:15");
    expect(fetch).not.toHaveBeenCalled(); expect(await TripModel.findById(ctx.trip.id).select("+sharing.tokenHash").lean()).toEqual(before);
  });
  it("rejects anonymous, non-owner and malformed private requests", async () => {
    const ctx = await setup(); const other = await register();
    expect((await app.inject({ url: ctx.privateUrl })).statusCode).toBe(401);
    expect((await app.inject({ url: ctx.privateUrl, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/trips/invalid/export/pdf", headers: { cookie: ctx.cookie } })).statusCode).toBe(404);
  });
  it("exports a safe public PDF with no identity, diagnostics, budget, tokens or private notes", async () => {
    const ctx = await setup(); const response = await app.inject({ url: ctx.publicUrl });
    expect(response.statusCode).toBe(200); expect(response.headers["referrer-policy"]).toBe("no-referrer");
    const text = await textFromPdf(response.rawPayload); expect(text).toContain("Public description"); expect(text).toContain("Opening hours unknown");
    for (const secret of ["PRIVATE", "12345", "provider/internal", ctx.trip.id, String(ctx.trip.user), "@example.com", "a".repeat(43), hashShareToken("a".repeat(43))]) expect(text).not.toContain(secret);
  });
  it("rejects private, revoked and rotated tokens, including conditional requests", async () => {
    const ctx = await setup();
    const original = await app.inject({ url: ctx.publicUrl }); expect(original.statusCode).toBe(200);
    await TripModel.updateOne({ _id: ctx.trip._id }, { $set: { "sharing.enabled": false, "sharing.tokenHash": null } });
    const revoked = await app.inject({ url: ctx.publicUrl, headers: { "if-none-match": String(original.headers.etag) } });
    expect(revoked.statusCode).toBe(404); expect(revoked.json()).toEqual({ error: "Shared trip not found" });
    await TripModel.updateOne({ _id: ctx.trip._id }, { $set: { "sharing.enabled": true, "sharing.tokenHash": hashShareToken("b".repeat(43)) } });
    expect((await app.inject({ url: ctx.publicUrl })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/public/trips/${"b".repeat(43)}/export/pdf` })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/public/trips/invalid/export/pdf" })).json()).toEqual({ error: "Shared trip not found" });
  });
  it.each(["revocation", "rotation"])("rechecks sharing after rendering so concurrent %s prevents delivery", async operation => {
    const ctx = await setup(); let begin!: () => void, finish!: (bytes: Buffer) => void;
    const started = new Promise<void>(resolve => { begin = resolve; }); const pending = new Promise<Buffer>(resolve => { finish = resolve; });
    vi.spyOn(renderer, "renderTripPdf").mockImplementation(() => { begin(); return pending; });
    const request = app.inject({ url: ctx.publicUrl }); await started;
    await TripModel.updateOne({ _id: ctx.trip._id }, { $set: operation === "revocation" ? { "sharing.enabled": false } : { "sharing.tokenHash": hashShareToken("b".repeat(43)) } }); finish(Buffer.from("%PDF-test"));
    expect((await request).statusCode).toBe(404);
  });
  it("returns controlled errors for oversized documents and renderer failures", async () => {
    const ctx = await setup(); const spy = vi.spyOn(renderer, "renderTripPdf").mockRejectedValue(new renderer.PdfExportError(413, "This itinerary is too large to export as one PDF."));
    expect((await app.inject({ url: ctx.privateUrl, headers: { cookie: ctx.cookie } })).statusCode).toBe(413);
    spy.mockRejectedValue(new Error("SECRET STACK OR PROVIDER CREDENTIAL"));
    const response = await app.inject({ url: ctx.privateUrl, headers: { cookie: ctx.cookie } }); expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Could not create the PDF. Please try again." }); expect(response.body).not.toContain("SECRET");
  });
});
