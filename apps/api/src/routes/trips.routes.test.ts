import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { ensureAttractions, saveTripRequirements } from "../services/tripDraft.js";
import { planTrip } from "../services/tripPlanner.js";
import {
  claimTripForGeneration, GenerationSupersededError, markGenerationFailed, runTripGeneration,
} from "../services/tripGeneration.js";

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
      attractions: [{ name: "Spot", category: "culture", lat: 48.85, lng: 2.35, placeId: "node/1" }],
      fetchedAt: new Date(),
      query: { lat: 48.85, lng: 2.35, interests: ["food"] },
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

    const repeated = await agent
      .post(`/api/trips/${trip.id}/generate`)
      .set("Origin", ORIGIN);
    expect(repeated.status).toBe(200);
    expect(repeated.body.generation.generatedAt).toBe(response.body.generation.generatedAt);
    expect((await TripModel.findById(trip._id))?.itineraryVersion).toBe(stored?.itineraryVersion);
  });

  it("rejects a second concurrent request without failing the first generation", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId);
    const result = await planTrip({ pois: [], durationDays: 1 });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(planTrip).mockImplementationOnce(async () => {
      entered();
      await blocked;
      return result;
    });
    const first = agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN).then((response) => response);
    await started;
    try {
      const second = await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN);
      expect(second.status).toBe(409);
    } finally {
      release();
    }
    expect((await first).status).toBe(200);
    expect((await TripModel.findById(trip._id))?.status).toBe("ready");
  });

  it("persists an actionable failure instead of generating a plan without attractions", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId);
    vi.mocked(ensureAttractions).mockResolvedValueOnce({ attractions: [], fetchedAt: null, query: null });
    const response = await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN);
    expect(response.status).toBe(502);
    expect(response.body.error).toContain("places service");
    const stored = await TripModel.findById(trip._id);
    expect(stored?.status).toBe("failed");
    expect(stored?.itinerary).toBeNull();
  });
});

describe("generation ownership", () => {
  it("prevents an old generation from overwriting the new owner's state", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const trip = await seedTrip(userId);
    const claimed = await claimTripForGeneration(trip.id, userId);
    expect(claimed).not.toBeNull();
    const replacementStartedAt = new Date(claimed!.generation.startedAt!.getTime() + 1_000);
    await TripModel.updateOne({ _id: trip._id }, { $set: { "generation.startedAt": replacementStartedAt } });
    await expect(runTripGeneration(claimed!)).rejects.toBeInstanceOf(GenerationSupersededError);
    expect(await markGenerationFailed(trip.id, userId, "Old failure", claimed!.generation.startedAt)).toBe(false);
    const stored = await TripModel.findById(trip._id);
    expect(stored?.status).toBe("generating");
    expect(stored?.itinerary).toBeNull();
    expect(stored?.generation.error).toBeNull();
  });

  it("rejects a planner result with no scheduled attractions", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const trip = await seedTrip(userId);
    const claimed = await claimTripForGeneration(trip.id, userId);
    const result = await planTrip({ pois: [], durationDays: 1 });
    vi.mocked(planTrip).mockResolvedValueOnce({ ...result, days: [] });
    await expect(runTripGeneration(claimed!)).rejects.toThrow("couldn't fit any places");
    expect((await TripModel.findById(trip._id))?.itinerary).toBeNull();
  });
});

describe("editing trip requirements", () => {
  it("updates a failed trip's destination and clears its saved generation error", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const payload = String(url).includes("geocoding")
        ? { results: [{ latitude: 33.1234, longitude: 22.5678, name: "New city", country: "New country" }] }
        : { elements: [{ type: "node", id: 99, lat: 33.1234, lon: 22.5678, tags: { name: "Cafe", amenity: "cafe" } }] };
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const trip = await seedTrip(new mongoose.Types.ObjectId().toString(), {
      status: "failed",
      analysis: { ...COMPLETE_ANALYSIS, startDate: null, endDate: null },
      generation: { startedAt: new Date(), generatedAt: null, error: "Old failure" },
    });
    const saved = await saveTripRequirements(trip, { destination: "New city", country: "New country" }, []);
    expect(saved.analysis.location?.lat).toBe(33.1234);
    expect(saved.analysis.location?.lng).toBe(22.5678);
    expect(saved.analysis.destination).toBe("New city");
    expect(saved.attractions[0]?.name).toBe("Cafe");
    expect(saved.status).toBe("draft");
    expect(saved.generation.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite requirements after another request starts generating", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const trip = await seedTrip(userId, {
      analysis: { ...COMPLETE_ANALYSIS, startDate: null, endDate: null },
      attractions: [{ name: "Cafe", category: "food", lat: 48.8566, lng: 2.3522 }],
      attractionsFetchedAt: new Date(),
      attractionsQuery: { lat: 48.8566, lng: 2.3522, interests: ["food"] },
    });
    await claimTripForGeneration(trip.id, userId);
    await expect(saveTripRequirements(trip, { travelers: 4 }, [])).rejects.toMatchObject({ status: 409 });
    const stored = await TripModel.findById(trip._id);
    expect(stored?.status).toBe("generating");
    expect(stored?.analysis.travelers).toBe(2);
  });
});
