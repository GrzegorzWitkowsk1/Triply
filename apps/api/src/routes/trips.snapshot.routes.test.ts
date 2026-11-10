import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { backfillTripAttractions, backfillTripWeather } from "../services/tripDraft.js";

vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
vi.mock("../services/tripDraft.js", async original => ({
  ...await original<typeof import("../services/tripDraft.js")>(),
  backfillTripWeather: vi.fn(async () => {}),
  backfillTripAttractions: vi.fn(async trip => trip),
}));
let app: FastifyInstance;
let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = await (await import("../app.js")).createApp();
}, 120_000);
afterEach(async () => {
  vi.clearAllMocks();
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
});
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });

it("snapshot reads skip provider enrichment, preserve ownership, and leave normal GET behavior intact", async () => {
  const agent = request.agent(app.server);
  const user = await agent.post("/api/auth/register").set("Origin", env.WEB_ORIGIN)
    .send({ email: "snapshot@example.com", password: "Password123!Aa" });
  expect(user.status).toBe(201);
  const trip = await TripModel.create({ user: new mongoose.Types.ObjectId(user.body.user.id), status: "ready", prompt: "Paris",
    analysis: { destination: "Paris", country: "France", startDate: null, endDate: null, durationDays: 1,
      travelers: 1, budget: { amount: null, currency: null, type: null }, interests: [], pace: null,
      maxWalkingDistanceKm: null, notes: null, location: null } });
  const snapshot = await agent.get(`/api/trips/${trip.id}?snapshot=true`);
  expect(snapshot.status).toBe(200); expect(snapshot.body.id).toBe(trip.id);
  expect(backfillTripAttractions).not.toHaveBeenCalled(); expect(backfillTripWeather).not.toHaveBeenCalled();
  expect((await request(app.server).get(`/api/trips/${trip.id}?snapshot=true`)).status).toBe(401);
  const other = request.agent(app.server);
  await other.post("/api/auth/register").set("Origin", env.WEB_ORIGIN).send({ email: "other@example.com", password: "Password123!Aa" });
  expect((await other.get(`/api/trips/${trip.id}?snapshot=true`)).status).toBe(404);
  expect((await agent.get(`/api/trips/${trip.id}`)).status).toBe(200);
  expect(backfillTripAttractions).toHaveBeenCalledTimes(1); expect(backfillTripWeather).toHaveBeenCalledTimes(1);
  await TripModel.deleteOne({ _id: trip._id });
  expect((await agent.get(`/api/trips/${trip.id}?snapshot=true`)).status).toBe(404);
});
