import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { UserModel } from "../models/User.js";
import { MAX_AVATAR_BYTES, type TripAnalysis } from "@triply/shared";

vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
const mocks = vi.hoisted(() => ({ parseTrip: vi.fn(), draft: vi.fn() }));
vi.mock("../ai/index.js", () => ({ aiService: { parseTrip: mocks.parseTrip } }));
vi.mock("../services/tripDraft.js", async original => ({ ...await original<typeof import("../services/tripDraft.js")>(), upsertTripDraft: mocks.draft, toTripAnalysisResult: (value: unknown) => value }));
let mongo: MongoMemoryServer;
let app: FastifyInstance;
const password = "Original123!Aa";
const preferences = { interests: ["culture", "shopping"], pace: "relaxed", maxWalkingDistanceKm: 3 };
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const { createApp } = await import("../app.js");
  app = await createApp();
}, 120_000);
afterEach(async () => { await UserModel.deleteMany({}); vi.clearAllMocks(); });
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });
async function account(email = "profile@example.com") {
  const response = await app.inject({ method: "POST", url: "/api/auth/register", headers: { origin: env.WEB_ORIGIN }, payload: { email, password } });
  expect(response.statusCode).toBe(201);
  const cookie = response.cookies.map(value => `${value.name}=${value.value}`).join("; ");
  return { headers: { origin: env.WEB_ORIGIN, cookie }, id: response.json().user.id as string };
}
describe("profile API", () => {
  it("requires authentication for every profile operation", async () => {
    for (const [method, url] of [["PATCH", "/api/profile"], ["PUT", "/api/profile/avatar"], ["PUT", "/api/profile/preferences"], ["POST", "/api/profile/password"]] as const) {
      expect((await app.inject({ method, url, headers: { origin: env.WEB_ORIGIN }, payload: {} })).statusCode).toBe(401);
    }
  });
  it("saves each name independently, preserves email and isolates users", async () => {
    const first = await account();
    const second = await account("other@example.com");
    expect((await app.inject({ method: "PATCH", url: "/api/profile", headers: first.headers, payload: { name: "Jo" } })).json().user.name).toBe("Jo");
    const response = await app.inject({ method: "PATCH", url: "/api/profile", headers: first.headers, payload: { surname: "Kowalska-Nowak" } });
    expect(response.json().user).toMatchObject({ name: "Jo", surname: "Kowalska-Nowak", email: "profile@example.com" });
    expect((await app.inject({ method: "PATCH", url: "/api/profile", headers: first.headers, payload: { email: "edited@example.com" } })).statusCode).toBe(400);
    expect((await UserModel.findById(second.id))?.name).toBe("");
    expect((await app.inject({ url: "/api/auth/session", headers: first.headers })).json().user.surname).toBe("Kowalska-Nowak");
  });
  it("persists preferences and rejects unsupported values", async () => {
    const { headers } = await account();
    expect((await app.inject({ method: "PUT", url: "/api/profile/preferences", headers, payload: preferences })).json().user.preferences).toEqual(preferences);
    expect((await app.inject({ url: "/api/auth/session", headers })).json().user.preferences).toEqual(preferences);
    expect((await app.inject({ method: "PUT", url: "/api/profile/preferences", headers, payload: { ...preferences, maxWalkingDistanceKm: 99 } })).statusCode).toBe(400);
  });
  it("verifies confirmation, password policy and current password before changing the hash", async () => {
    const { headers, id } = await account();
    const before = (await UserModel.findById(id).select("+passwordHash"))!.passwordHash;
    const values = { currentPassword: password, newPassword: "Changed123!Aa", repeatPassword: "Changed123!Aa" };
    for (const payload of [{ ...values, repeatPassword: "Mismatch123!Aa" }, { ...values, currentPassword: "Wrong123!Aa" }, { ...values, newPassword: "weak", repeatPassword: "weak" }, { ...values, currentPassword: "" }]) {
      const result = await app.inject({ method: "POST", url: "/api/profile/password", headers, payload });
      expect(result.statusCode).toBe(400);
      expect(result.json().error).toBeTruthy();
    }
    expect((await UserModel.findById(id).select("+passwordHash"))!.passwordHash).toBe(before);
    expect((await app.inject({ method: "POST", url: "/api/profile/password", headers, payload: values })).statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", headers, payload: { email: "profile@example.com", password } })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", headers, payload: { email: "profile@example.com", password: values.newPassword } });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.passwordHash).toBeUndefined();
  });
  it("stores avatars immediately and preserves the existing avatar after rejected uploads", async () => {
    const { headers } = await account();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>';
    const upload = await app.inject({ method: "PUT", url: "/api/profile/avatar", headers: { ...headers, "content-type": "image/svg+xml" }, payload: Buffer.from(svg) });
    expect(upload.statusCode).toBe(200);
    const avatar = upload.json().user.avatar;
    for (const data of ["", svg.replace("<circle", '<script>alert(1)</script><circle'), svg.replace('fill="red"', 'onload="alert(1)"'), svg.replace('fill="red"', 'fill="url(https://evil.example)"')]) {
      expect((await app.inject({ method: "PUT", url: "/api/profile/avatar", headers: { ...headers, "content-type": "image/svg+xml" }, payload: Buffer.from(data) })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PUT", url: "/api/profile/avatar", headers: { ...headers, "content-type": "image/png" }, payload: Buffer.alloc(MAX_AVATAR_BYTES + 1) })).statusCode).toBe(413);
    expect((await app.inject({ url: "/api/auth/session", headers })).json().user.avatar).toBe(avatar);
    expect((await app.inject({ method: "DELETE", url: "/api/profile/avatar", headers })).statusCode).toBe(404);
  });
  it("defaults trip analysis from the profile and preserves explicit trip choices", async () => {
    const { headers } = await account();
    await app.inject({ method: "PUT", url: "/api/profile/preferences", headers, payload: preferences });
    const analysis: TripAnalysis = { destination: null, country: null, startDate: null, endDate: null, durationDays: null, travelers: null, budget: { amount: null, currency: null, type: null }, interests: [], pace: null, maxWalkingDistanceKm: null, notes: null };
    mocks.parseTrip.mockResolvedValue(analysis);
    mocks.draft.mockImplementation(async values => values);
    const result = await app.inject({ method: "POST", url: "/api/trips/analyze", headers, payload: { prompt: "Paris" } });
    expect(result.statusCode).toBe(200);
    expect(result.json().analysis).toMatchObject(preferences);
    expect(mocks.parseTrip).toHaveBeenLastCalledWith({ prompt: "Paris", badges: preferences.interests, locale: "en" });
    mocks.parseTrip.mockResolvedValue({ ...analysis, interests: ["food"], pace: "packed", maxWalkingDistanceKm: 10 });
    const explicit = await app.inject({ method: "POST", url: "/api/trips/analyze", headers, payload: { prompt: "Packed food trip", badges: ["food"] } });
    expect(explicit.json().analysis).toMatchObject({ interests: ["food"], pace: "packed", maxWalkingDistanceKm: 10 });
    mocks.parseTrip.mockResolvedValue(analysis);
    const cleared = await app.inject({ method: "POST", url: "/api/trips/analyze", headers, payload: { prompt: "Paris", badges: [], pace: "balanced", maxWalkingDistanceKm: 5 } });
    expect(cleared.json().analysis).toMatchObject({ interests: [], pace: "balanced", maxWalkingDistanceKm: 5 });
  });
});
