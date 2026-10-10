import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";

vi.mock("../services/tripPlanner.js", () => ({
  planTrip: vi.fn(async () => ({
    timeZone: "Europe/Paris",
    routing: {
      source: "approximation",
      dayRoutes: [
        {
          dayIndex: 0,
          orderedPlaces: [
            {
              name: "Spot",
              category: "museum",
              lat: 48.85,
              lng: 2.35,
              placeId: "node/1",
              score: 80,
            },
          ],
          segments: [],
          geometry: null,
        },
      ],
    },
    days: [
      {
        dayIndex: 0,
        date: "2026-06-01",
        timeZone: "Europe/Paris",
        activities: [
          {
            type: "attraction",
            startTime: "2026-06-01T09:00:00",
            endTime: "2026-06-01T10:00:00",
            placeId: "node/1",
            title: "Spot",
            durationMinutes: 60,
          },
        ],
        totalVisitMinutes: 60,
        totalTravelMinutes: 0,
        totalDistanceMeters: 0,
        partiallyEstimated: false,
        warnings: [],
      },
    ],
    unscheduledPlaces: [],
  })),
}));

vi.mock("../services/tripDraft.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/tripDraft.js")>();

  return {
    ...actual,
    ensureWeather: vi.fn(async () => ({ days: [], fetchedAt: null })),
    ensureAttractions: vi.fn(async () => ({
      attractions: [],
      fetchedAt: null,
      query: null,
    })),
  };
});

const ORIGIN = env.WEB_ORIGIN;
const COMPLETE_ANALYSIS = {
  destination: "Paris",
  country: "France",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  durationDays: 1,
  travelers: 2,
  budget: { amount: 500, currency: "EUR", type: "total" },
  interests: ["food"],
  pace: "balanced",
  maxWalkingDistanceKm: 5,
  notes: null,
  location: { lat: 48.8566, lng: 2.3522 },
};

let mongod: MongoMemoryServer;
let app: Express;

async function registerAgent() {
  const agent = request.agent(app);

  const response = await agent
    .post("/api/auth/register")
    .set("Origin", ORIGIN)
    .send({ email: "tripper@example.com", password: "Password123!Aa" });

  expect(response.status).toBe(201);

  return { agent, userId: response.body.user.id as string };
}

function seedTrip(userId: string, overrides: Record<string, unknown> = {}) {
  return TripModel.create({
    user: new mongoose.Types.ObjectId(userId),
    prompt: "Weekend in Paris",
    badges: [],
    status: "draft",
    analysis: COMPLETE_ANALYSIS,
    ...overrides,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const { createApp } = await import("../app.js");
  app = createApp();
}, 120_000);

afterEach(async () => {
  const collections = mongoose.connection.collections;

  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("POST /api/trips/:id/confirm", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await request(app)
      .post(`/api/trips/${new mongoose.Types.ObjectId()}/confirm`)
      .set("Origin", ORIGIN);

    expect(response.status).toBe(401);
  });

  it("returns 404 for a trip owned by someone else", async () => {
    const { agent } = await registerAgent();
    const other = new mongoose.Types.ObjectId();
    const trip = await seedTrip(other.toString());

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/confirm`)
      .set("Origin", ORIGIN);

    expect(response.status).toBe(404);
  });

  it("returns 400 with the missing fields when requirements are incomplete", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId, {
      analysis: { ...COMPLETE_ANALYSIS, destination: null, country: null },
    });

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/confirm`)
      .set("Origin", ORIGIN);

    expect(response.status).toBe(400);
    expect(response.body.missingFields).toEqual(
      expect.arrayContaining(["destination", "country"]),
    );
  });

  it("finalizes a complete draft and keeps it ready to generate", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId);

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/confirm`)
      .set("Origin", ORIGIN);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("draft");
    expect(response.body.missingFields).toEqual([]);
    expect(response.body.requirementsComplete).toBe(true);
    expect(response.body.itinerary).toBeNull();
    expect(response.body.generation).toEqual({
      startedAt: null,
      generatedAt: null,
      error: null,
    });
  });
});

describe("POST /api/trips/:id/generate", () => {
  it("returns 400 when the trip has no location or duration", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId, {
      analysis: { ...COMPLETE_ANALYSIS, location: null, durationDays: null },
    });

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/generate`)
      .set("Origin", ORIGIN);

    expect(response.status).toBe(400);
  });

  it("returns 409 when a generation is already running", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId, {
      status: "generating",
      generation: { startedAt: new Date(), generatedAt: null, error: null },
    });

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/generate`)
      .set("Origin", ORIGIN);

    expect(response.status).toBe(409);
  });

  it("generates and persists the itinerary", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId);

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/generate`)
      .set("Origin", ORIGIN);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.itinerary).not.toBeNull();
    expect(response.body.itinerary.days).toHaveLength(1);
    expect(response.body.itinerary.days[0].stops[0].name).toBe("Spot");
    expect(response.body.generation.generatedAt).not.toBeNull();

    const stored = await TripModel.findById(trip._id).exec();
    expect(stored?.status).toBe("ready");
    expect(stored?.itinerary?.days).toHaveLength(1);
  });
});
