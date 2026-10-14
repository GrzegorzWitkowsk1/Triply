import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import ICAL from "ical.js";
import { TripModel } from "../models/Trip.js";
import { env } from "../config/env.js";
import { hashShareToken } from "./sharing.js";
import { calendarFixture } from "../services/tripCalendar.fixtures.js";
import * as renderer from "../services/tripCalendar.js";
vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
let db: MongoMemoryServer, app: FastifyInstance, userIndex = 0;
beforeAll(async () => { db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri()); app = await (await import("../app.js")).createApp(); }, 120_000);
afterEach(async () => { vi.restoreAllMocks(); for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({}); });
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await db?.stop(); });
async function register() {
  const result = await app.inject({ method: "POST", url: "/api/auth/register", headers: { origin: env.WEB_ORIGIN }, payload: { email: `calendar-${++userIndex}@example.com`, password: "Password123!Aa" } });
  expect(result.statusCode).toBe(201); return { cookie: result.cookies.map(c => `${c.name}=${c.value}`).join("; "), user: result.json().user.id as string };
}
async function setup() {
  const owner = await register(), source = calendarFixture();
  const trip = await TripModel.create({ user: owner.user, status: "ready", itineraryVersion: 42, prompt: "PRIVATE PROMPT",
    sharing: { enabled: true, tokenHash: hashShareToken("a".repeat(43)) },
    analysis: { destination: source.destination, country: source.country, startDate: source.startDate, endDate: source.endDate, durationDays: 2,
      travelers: 1, budget: { amount: 12345, currency: "EUR", type: "total" }, notes: "PRIVATE NOTES", interests: [], pace: "balanced", maxWalkingDistanceKm: 5 },
    attractions: [{ placeId: "provider/internal", name: "Sagrada Família", category: "culture", lat: 41, lng: 2, description: "Public description", address: "Public address" }],
    itinerary: { timeZone: "Europe/Madrid", routingSource: "provider", unscheduled: [], days: source.days.map(day => ({ ...day,
      stops: day.stops.map(s => ({ ...s, placeId: "provider/internal", score: null })),
      activities: day.activities.map(a => ({ ...a, placeId: a.type === "attraction" ? "provider/internal" : undefined, warnings: ["PRIVATE DIAGNOSTIC"] })),
    })) },
  });
  return { ...owner, trip, privateUrl: `/api/trips/${trip.id}/export/calendar`, publicUrl: `/api/public/trips/${"a".repeat(43)}/export/calendar` };
}
describe("authorized calendar exports", () => {
  it("exports persisted owner events with correct headers, no mutations and no provider calls", async () => {
    const ctx = await setup(), before = await TripModel.findById(ctx.trip.id).select("+sharing.tokenHash").lean();
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No providers"));
    const response = await app.inject({ url: ctx.privateUrl, headers: { cookie: ctx.cookie } });
    expect(response.statusCode).toBe(200); expect(response.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="triply-barcelona-2030-06-02.ics"'); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-triply-calendar-events"]).toBe("4"); expect(response.headers["x-triply-calendar-excluded"]).toBe("0");
    expect(new ICAL.Component(ICAL.parse(response.body)).getAllSubcomponents("vevent")).toHaveLength(4);
    expect(await TripModel.findById(ctx.trip.id).select("+sharing.tokenHash").lean()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects anonymous, non-owner and malformed private trip requests", async () => {
    const ctx = await setup(), other = await register();
    expect((await app.inject({ url: ctx.privateUrl })).statusCode).toBe(401);
    expect((await app.inject({ url: ctx.privateUrl, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/trips/invalid/export/calendar", headers: { cookie: ctx.cookie } })).statusCode).toBe(404);
  });
  it("exports safe public events with no secrets or internal identifiers", async () => {
    const ctx = await setup(), response = await app.inject({ url: ctx.publicUrl });
    expect(response.statusCode).toBe(200); expect(response.headers["referrer-policy"]).toBe("no-referrer"); expect(response.body).toContain("Public description");
    for (const secret of ["PRIVATE", "12345", "provider/internal", ctx.trip.id, ctx.user, "@example.com", "a".repeat(43), hashShareToken("a".repeat(43))]) expect(response.body).not.toContain(secret);
    const parsed = new ICAL.Component(ICAL.parse(response.body)); const event = new ICAL.Event(parsed.getFirstSubcomponent("vevent")!); expect(event.location).toBe("Public address");
  });
  it("rejects disabled and rotated shares, including requests with cached ETags", async () => {
    const ctx = await setup(), first = await app.inject({ url: ctx.publicUrl }); expect(first.statusCode).toBe(200);
    await TripModel.updateOne({ _id: ctx.trip._id }, { $set: { "sharing.enabled": false } });
    expect((await app.inject({ url: ctx.publicUrl, headers: { "if-none-match": String(first.headers.etag) } })).statusCode).toBe(404);
    await TripModel.updateOne({ _id: ctx.trip._id }, { $set: { "sharing.enabled": true, "sharing.tokenHash": hashShareToken("b".repeat(43)) } });
    expect((await app.inject({ url: ctx.publicUrl })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/public/trips/${"b".repeat(43)}/export/calendar` })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/public/trips/invalid/export/calendar" })).json()).toEqual({ error: "Shared trip not found" });
  });
  it.each(["revocation", "rotation"])("rechecks access after rendering during concurrent %s", async operation => {
    const ctx = await setup(); let begin!: () => void, finish!: (result: Awaited<ReturnType<typeof renderer.renderTripCalendar>>) => void;
    const started = new Promise<void>(resolve => { begin = resolve; }), pending = new Promise<Awaited<ReturnType<typeof renderer.renderTripCalendar>>>(resolve => { finish = resolve; });
    vi.spyOn(renderer, "renderTripCalendar").mockImplementation(() => { begin(); return pending; });
    const request = app.inject({ url: ctx.publicUrl }); await started;
    await TripModel.updateOne({ _id: ctx.trip._id }, { $set: operation === "revocation" ? { "sharing.enabled": false } : { "sharing.tokenHash": hashShareToken("b".repeat(43)) } });
    finish({ content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", stats: { exported: 1, excluded: 0, invalid: 0, unscheduled: 0 } });
    expect((await request).statusCode).toBe(404);
  });
  it("reports exclusions and safely rejects an empty itinerary", async () => {
    const ctx = await setup(); await TripModel.updateOne({ _id: ctx.trip._id }, { $set: { "itinerary.days.0.activities.0.schedulingStatus": "unresolved" } });
    const partial = await app.inject({ url: ctx.privateUrl, headers: { cookie: ctx.cookie } }); expect(partial.headers["x-triply-calendar-excluded"]).toBe("1");
    await TripModel.updateOne({ _id: ctx.trip._id }, { $set: { itinerary: null } });
    const empty = await app.inject({ url: ctx.privateUrl, headers: { cookie: ctx.cookie } }); expect(empty.statusCode).toBe(422); expect(empty.json().code).toBe("empty-itinerary");
  });
  it("returns controlled serialization failures without leaking details", async () => {
    const ctx = await setup(); vi.spyOn(renderer, "renderTripCalendar").mockRejectedValue(new Error("SECRET STACK"));
    const result = await app.inject({ url: ctx.privateUrl, headers: { cookie: ctx.cookie } }); expect(result.statusCode).toBe(500);
    expect(result.json()).toEqual({ error: "Could not create the calendar. Please try again.", code: "export-failed" });
  });
});
