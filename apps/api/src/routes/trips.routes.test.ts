vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { ensureAttractions, saveTripRequirements, upsertTripDraft } from "../services/tripDraft.js";
import { recoverTripDestination } from "../services/tripDestination.js";
import type { TripAnalysis } from "@triply/shared";
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
let app: FastifyInstance;

async function registerAgent() {
  const agent = request.agent(app.server);

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
  app = await createApp();
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
  await app?.close(); await mongoose.disconnect();
  await mongod.stop();
});

describe("POST /api/trips/:id/confirm", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await request(app.server)
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

describe("destination persistence and recovery", () => {
  const geographicResult = { name: "Prague", country: "Czechia", country_code: "CZ", latitude: 50.08, longitude: 14.43 };
  function mockLookup(results = [geographicResult]) {
    const fetch = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(
      String(url).includes("geocoding") ? { results } : { elements: [] },
    )));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  async function brokenTrip(userId: string) {
    const trip = await seedTrip(userId, { analysis: { ...COMPLETE_ANALYSIS, destination: "Prague", country: "Czech Republic", location: null } });
    // Reproduce legacy MongoDB data without passing through the repaired write validators.
    await TripModel.collection.updateOne({ _id: trip._id }, { $set: { "analysis.location": {} } });
    return (await TripModel.findById(trip._id))!;
  }

  it("creates, persists and retrieves supplied destination coordinates without geocoding", async () => {
    const { agent, userId } = await registerAgent();
    const fetch = mockLookup();
    const location = { lat: 0, lng: 0, city: "Paris", country: "France" };
    const draft = await upsertTripDraft({ userId, prompt: "Paris", badges: [],
      analysis: { ...COMPLETE_ANALYSIS, startDate: null, endDate: null, location } as TripAnalysis });
    expect((await TripModel.findById(draft._id))?.toObject().analysis.location).toEqual(location);
    const loaded = await agent.get(`/api/trips/${draft.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.analysis.location).toEqual(location);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("geocoding"))).toHaveLength(0);
  });

  it("persists geocoding during text-only draft creation", async () => {
    const fetch = mockLookup();
    const draft = await upsertTripDraft({ userId: new mongoose.Types.ObjectId().toString(), prompt: "Prague", badges: [],
      analysis: { ...COMPLETE_ANALYSIS, destination: "Prague", country: "Czech Republic", location: null, startDate: null, endDate: null } as TripAnalysis });
    expect((await TripModel.findById(draft._id))?.analysis.location).toMatchObject({ lat: 50.08, lng: 14.43 });
    expect(new URL(String(fetch.mock.calls[0]![0])).searchParams.get("name")).toBe("Prague");
  });

  it("preserves saved coordinates during repeat analysis of the same destination", async () => {
    const trip = await seedTrip(new mongoose.Types.ObjectId().toString(), { analysis: { ...COMPLETE_ANALYSIS, startDate: null, endDate: null } });
    const fetch = mockLookup();
    const saved = await upsertTripDraft({ userId: trip.user!.toString(), prompt: "Paris again", badges: [],
      analysis: { ...COMPLETE_ANALYSIS, startDate: null, endDate: null, location: null } as TripAnalysis });
    expect(saved.id).toBe(trip.id);
    expect(saved.analysis.location).toMatchObject(COMPLETE_ANALYSIS.location);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("geocoding"))).toHaveLength(0);
  });

  it("accepts selected coordinates through the requirements API and restores them on retrieval", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId, { analysis: { ...COMPLETE_ANALYSIS, startDate: null, endDate: null, location: null } });
    const fetch = mockLookup();
    const location = { lat: 0, lng: 0, city: "Paris", country: "France" };
    const saved = await agent.patch(`/api/trips/${trip.id}/requirements`).set("Origin", ORIGIN)
      .send({ answers: { location }, confirmedFields: [] });
    expect(saved.status).toBe(200);
    expect(saved.body.analysis.location).toEqual(location);
    expect((await TripModel.findById(trip._id))?.toObject().analysis.location).toEqual(location);
    expect((await agent.get(`/api/trips/${trip.id}`)).body.analysis.location).toEqual(location);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("geocoding"))).toHaveLength(0);
  });

  it("recovers the legacy Prague scenario, persists location and generates successfully", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await brokenTrip(userId);
    const fetch = mockLookup();
    const response = await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.analysis.location).toEqual({ lat: 50.08, lng: 14.43, city: "Prague", country: "Czechia" });
    expect((await TripModel.findById(trip._id))?.analysis.location).toMatchObject({ lat: 50.08, lng: 14.43 });
    const repeated = await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN);
    expect(repeated.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("loads an empty legacy location as null without sending invalid coordinates downstream", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await brokenTrip(userId);
    const fetch = mockLookup();
    const loaded = await agent.get(`/api/trips/${trip.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.analysis.location).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("confirms complete legacy requirements before generation recovers their location", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await brokenTrip(userId);
    const fetch = mockLookup();
    const response = await agent.post(`/api/trips/${trip.id}/confirm`).set("Origin", ORIGIN);
    expect(response.status).toBe(200);
    expect(response.body.analysis.location).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect((await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses newer valid coordinates for the same destination without overwriting them", async () => {
    const trip = await brokenTrip(new mongoose.Types.ObjectId().toString());
    vi.stubGlobal("fetch", vi.fn(async () => {
      await TripModel.updateOne({ _id: trip._id }, { $set: { "analysis.location": { lat: 51, lng: 15 } } });
      return new Response(JSON.stringify({ results: [geographicResult] }));
    }));
    expect((await recoverTripDestination(trip)).analysis.location).toMatchObject({ lat: 51, lng: 15 });
    expect((await TripModel.findById(trip._id))?.analysis.location).toMatchObject({ lat: 51, lng: 15 });
  });

  it("preserves valid zero coordinates during generation", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId, { analysis: { ...COMPLETE_ANALYSIS, location: { lat: 0, lng: 0 } } });
    const fetch = mockLookup();
    const response = await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN);
    expect(response.status).toBe(200);
    expect(response.body.analysis.location).toMatchObject({ lat: 0, lng: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { changes: { durationDays: null }, message: "trip dates or duration" },
    { changes: { destination: null }, message: "select a destination" },
    { changes: { country: null }, message: "destination country" },
  ])("validates prerequisites independently ($message)", async ({ changes, message }) => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId, { analysis: { ...COMPLETE_ANALYSIS, ...changes, location: null } });
    const fetch = mockLookup();
    const response = await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { results: [], message: "couldn't determine" },
    { results: [geographicResult, { ...geographicResult, longitude: 15 }], message: "more than one city" },
    { results: [{ ...geographicResult, latitude: 91 }], message: "invalid coordinates" },
  ])("returns controlled resolution errors ($message)", async ({ results, message }) => {
    const { agent, userId } = await registerAgent();
    const trip = await brokenTrip(userId);
    mockLookup(results);
    const response = await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain(message);
    expect((await TripModel.findById(trip._id))?.status).toBe("draft");
  });

  it("reports provider outages and allows retry without losing trip data", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await brokenTrip(userId);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const response = await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN);
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("Destination lookup is temporarily unavailable. Please try again.");
    expect((await TripModel.findById(trip._id))?.analysis.budget.amount).toBe(500);
    mockLookup();
    expect((await agent.post(`/api/trips/${trip.id}/generate`).set("Origin", ORIGIN)).status).toBe(200);
  });

  it("shares concurrent recovery and preserves unrelated data and itinerary versions", async () => {
    const trip = await brokenTrip(new mongoose.Types.ObjectId().toString());
    await TripModel.updateOne({ _id: trip._id }, { $set: { itineraryVersion: 7, budgetRevision: 3, badges: ["food"], "analysis.notes": "Keep me" } });
    const before = (await TripModel.findById(trip._id))!;
    const fetch = mockLookup();
    const [first, second] = await Promise.all([recoverTripDestination(before), recoverTripDestination(before)]);
    expect(first.analysis.location).toMatchObject({ lat: 50.08, lng: 14.43 });
    expect(second.id).toBe(first.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    const after = (await TripModel.findById(trip._id))!;
    expect(after.itineraryVersion).toBe(7);
    expect(after.budgetRevision).toBe(3);
    expect(after.badges).toEqual(["food"]);
    expect(after.analysis.notes).toBe("Keep me");
    expect(after.toObject().analysis.budget).toEqual(before.toObject().analysis.budget);
    await recoverTripDestination(after);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects stale results after the destination changes during lookup", async () => {
    const trip = await brokenTrip(new mongoose.Types.ObjectId().toString());
    vi.stubGlobal("fetch", vi.fn(async () => {
      await TripModel.updateOne({ _id: trip._id }, { $set: { "analysis.destination": "Rome", "analysis.country": "Italy", "analysis.location": { lat: 41.9, lng: 12.5 } } });
      return new Response(JSON.stringify({ results: [geographicResult] }));
    }));
    await expect(recoverTripDestination(trip)).rejects.toMatchObject({ status: 409 });
    const stored = (await TripModel.findById(trip._id))!;
    expect(stored.analysis.destination).toBe("Rome");
    expect(stored.analysis.location).toMatchObject({ lat: 41.9, lng: 12.5 });
  });

  it("prevents claim of an obsolete snapshot after a concurrent edit", async () => {
    const trip = await seedTrip(new mongoose.Types.ObjectId().toString());
    await TripModel.updateOne({ _id: trip._id }, { $set: { "analysis.destination": "Rome", updatedAt: new Date(trip.updatedAt.getTime() + 1000) } });
    expect(await claimTripForGeneration(trip.id, trip.user!.toString(), trip.updatedAt)).toBeNull();
  });

  it("preserves coordinates when an unchanged destination update supplies null location", async () => {
    const trip = await seedTrip(new mongoose.Types.ObjectId().toString(), { analysis: { ...COMPLETE_ANALYSIS, startDate: null, endDate: null } });
    const fetch = mockLookup();
    const saved = await saveTripRequirements(trip, { destination: "Paris", country: "France", location: null, travelers: 3 }, []);
    expect(saved.analysis.location).toMatchObject(COMPLETE_ANALYSIS.location);
    expect(saved.analysis.travelers).toBe(3);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("geocoding"))).toHaveLength(0);
  });

  it("rejects invalid coordinates at API and MongoDB validation boundaries", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedTrip(userId);
    const response = await agent.patch(`/api/trips/${trip.id}/requirements`).set("Origin", ORIGIN)
      .send({ answers: { location: { lat: 91, lng: 0 } }, confirmedFields: [] });
    expect(response.status).toBe(400);
    await expect(seedTrip(userId, { analysis: { ...COMPLETE_ANALYSIS, location: { lat: 0, lng: 181 } } })).rejects.toThrow();
    expect((await TripModel.findById(trip._id))?.analysis.location).toMatchObject(COMPLETE_ANALYSIS.location);
  });
});
