vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { normalizeAdmission } from "../services/admissionPricingService.js";
import { expenseInputSchema } from "@triply/shared";
import { randomUUID } from "node:crypto";
import { mutateExpense } from "../services/expenses.js";

vi.mock("../ai/index.js", () => ({
  aiService: {
    parseTrip: vi.fn(),
    parseRegeneration: vi.fn(),
  },
}));

const { fakeRoutingProvider } = vi.hoisted(() => {
  const provider = {
    name: "test",
    supportedModes: ["walking", "driving", "cycling"],
    supportsMode: () => true,
    async getTravelMatrix(coordinates: { lat: number; lng: number }[]) {
      const distancesMeters = coordinates.map((from) =>
        coordinates.map(
          (to) => Math.hypot(from.lat - to.lat, from.lng - to.lng) * 111_000,
        ),
      );

      return { distancesMeters, durationsSeconds: distancesMeters };
    },
    async getRoute(coordinates: { lat: number; lng: number }[]) {
      const legs = coordinates.slice(1).map((to, index) => {
        const from = coordinates[index];
        const distanceMeters = Math.hypot(from.lat - to.lat, from.lng - to.lng) * 111_000;

        return {
          fromIndex: index,
          toIndex: index + 1,
          distanceMeters,
          durationSeconds: distanceMeters,
        };
      });

      return {
        distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
        durationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
        geometry: null,
        legs,
      };
    },
  };

  return { fakeRoutingProvider: provider };
});

vi.mock("../routing/index.js", () => ({
  createRoutingProvider: vi.fn(() => fakeRoutingProvider),
}));

vi.mock("../services/attractions.js", () => ({ fetchAttractions: vi.fn(async () => null) }));

const ORIGIN = env.WEB_ORIGIN;

const COMPLETE_ANALYSIS = {
  destination: "Paris",
  country: "France",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  durationDays: 1,
  travelers: 2,
  budget: { amount: 500, currency: "EUR", type: "total" },
  interests: ["culture"],
  pace: "relaxed",
  maxWalkingDistanceKm: 5,
  notes: null,
  location: { lat: 48.8566, lng: 2.3522 },
};

const ATTRACTIONS = [
  { name: "Louvre", category: "culture", lat: 48.8606, lng: 2.3376, score: 92, placeId: "node/1", environment: "indoor" },
  { name: "Eiffel Tower", category: "attraction", lat: 48.8584, lng: 2.2945, score: 90, placeId: "node/2", environment: "outdoor" },
  { name: "Sainte-Chapelle", category: "culture", lat: 48.8554, lng: 2.3449, score: 85, placeId: "node/3", environment: "indoor" },
];

const READY_ITINERARY = {
  timeZone: "Europe/Paris",
  routingSource: "approximation",
  days: [
    {
      dayIndex: 1,
      date: "2026-06-01",
      timeZone: "Europe/Paris",
      activities: [
        {
          type: "attraction",
          startTime: "2026-06-01T09:00:00",
          endTime: "2026-06-01T10:00:00",
          placeId: "node/1",
          title: "Louvre",
          durationMinutes: 60,
          durationSource: "estimated",
        },
      ],
      stops: [{ placeId: "node/1", name: "Louvre", category: "culture", lat: 48.8606, lng: 2.3376, score: 92 }],
      geometry: null,
      segments: [],
      totalVisitMinutes: 60,
      totalTravelMinutes: 0,
      totalDistanceMeters: 0,
      partiallyEstimated: false,
      warnings: [],
    },
  ],
  unscheduled: [],
};

let mongod: MongoMemoryServer;
let app: FastifyInstance;

async function registerAgent() {
  const agent = request.agent(app.server);

  const response = await agent
    .post("/api/auth/register")
    .set("Origin", ORIGIN)
    .send({ email: "regenerator@example.com", password: "Password123!Aa" });

  expect(response.status).toBe(201);

  return { agent, userId: response.body.user.id as string };
}

function seedReadyTrip(userId: string, overrides: Record<string, unknown> = {}) {
  return TripModel.create({
    user: new mongoose.Types.ObjectId(userId),
    prompt: "Paris",
    badges: [],
    status: "ready",
    analysis: COMPLETE_ANALYSIS,
    weather: [],
    attractions: ATTRACTIONS,
    itinerary: READY_ITINERARY,
    itineraryVersion: 3,
    generation: { startedAt: new Date(), generatedAt: new Date(), error: null },
    ...overrides,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const { createApp } = await import("../app.js");
  app = await createApp();
}, 120_000);

beforeEach(async () => {
  const { aiService } = await import("../ai/index.js");
  (aiService.parseRegeneration as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;

  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await app?.close(); await mongoose.disconnect();
  await mongod.stop();
});

describe("POST /api/trips/:id/days/:dayId/regenerate", () => {
  it("returns 404 for a day that does not exist", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId);

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/days/99/regenerate`)
      .set("Origin", ORIGIN)
      .send({ preferences: { relaxedPace: true } });

    expect(response.status).toBe(404);
  });

  it("returns 400 when nothing is selected", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId);

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/days/1/regenerate`)
      .set("Origin", ORIGIN)
      .send({ preferences: {} });

    expect(response.status).toBe(400);
  });

  it("creates a preview without touching the saved itinerary", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId);

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/days/1/regenerate`)
      .set("Origin", ORIGIN)
      .send({ preferences: { relaxedPace: true } });

    expect(response.status).toBe(200);
    expect(response.body.previewId).toEqual(expect.any(String));
    expect(response.body.baseItineraryVersion).toBe(3);
    expect(response.body.dayIndex).toBe(1);
    expect(response.body.comparison.proposed.attractionCount).toBeGreaterThanOrEqual(2);
    expect(response.body.day.stops).toHaveLength(3);

    const stored = await TripModel.findById(trip._id).exec();
    expect(stored?.itinerary?.days[0].stops).toHaveLength(1);
    expect(stored?.itineraryVersion).toBe(3);
    expect(stored?.regeneration).not.toBeNull();
  });

  it("falls back to selected preferences when AI parsing fails", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId);
    const { aiService } = await import("../ai/index.js");
    (aiService.parseRegeneration as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("provider down"),
    );

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/days/1/regenerate`)
      .set("Origin", ORIGIN)
      .send({
        preferences: { relaxedPace: true },
        customInstructions: "Only the quietest museums, please.",
      });

    expect(response.status).toBe(200);
    expect(response.body.appliedPreferences).toMatchObject({ relaxedPace: true });
    expect(response.body.warnings).toContain(
      "We couldn't interpret your custom instructions, so we used your selected preferences.",
    );
  });
});

describe("POST /api/trips/:id/days/:dayId/apply", () => {
  it("rejects a preview that would remove an occurrence marked visited after preview creation", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId, { attractions: ATTRACTIONS.map((place, index) => ({ ...place,
      ...(index === 0 ? { openingHours: { raw: "closed", source: "osm" } } : {}),
    })) });
    const itemId = trip.itinerary!.days[0].activities[0].itineraryItemId!;
    const path = `/api/trips/${trip.id}`;
    const preview = await agent.post(`${path}/days/1/regenerate`).set("Origin", ORIGIN).send({ preferences: { relaxedPace: true } });
    expect(preview.status, preview.body).toBe(200);
    await agent.patch(`${path}/visits/${itemId}`).set("Origin", ORIGIN).send({ status: "visited" });
    const apply = await agent.post(`${path}/days/1/apply`).set("Origin", ORIGIN).send({ previewId: preview.body.previewId });
    expect(apply.status, apply.body).toBe(409);
    const saved = (await TripModel.findById(trip.id))!;
    expect(saved.toObject().itinerary).toEqual(trip.toObject().itinerary);
    expect(saved.regeneration?.previewId).toBe(preview.body.previewId);
    expect(saved.visits[0].status).toBe("visited");
  });
  it("keeps visits through preview, discard (no apply), retry and commit, including changes after preview", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId);
    const itemId = trip.itinerary!.days[0].activities[0].itineraryItemId!;
    const withExpense = await mutateExpense(trip.id, userId, { type: "create", requestId: randomUUID(), expense: expenseInputSchema.parse({ title: "Real ticket", category: "attractions", currency: "EUR", amountMinor: 1700, type: "actual", itineraryItemId: itemId, date: "2026-06-01", dayId: "1" }) }, 0);
    const originalExpenses = withExpense.toObject().expenses;
    const path = `/api/trips/${trip.id}`;
    const mark = (status: string) => agent.patch(`${path}/visits/${itemId}`).set("Origin", ORIGIN).send({ status });
    let marked = await mark("visited");
    expect(marked.status).toBe(200);
    const preview = () => agent.post(`${path}/days/1/regenerate`).set("Origin", ORIGIN).send({ preferences: { relaxedPace: true } });
    expect((await preview()).status).toBe(409);
    marked = await mark("skipped");
    const first = await preview();
    expect(first.status, first.body).toBe(200);
    // Discard is intentionally client-only: leaving a preview unapplied changes no visits.
    expect((await TripModel.findById(trip.id))!.toObject().visits).toEqual(marked.body.visits);
    expect((await TripModel.findById(trip.id))!.toObject().itinerary).toEqual(trip.toObject().itinerary);
    expect((await TripModel.findById(trip.id))!.toObject().expenses).toEqual(originalExpenses);
    const retry = await preview();
    expect(retry.status, retry.body).toBe(200);
    const skipped = await mark("skipped");
    const applied = await agent.post(`${path}/days/1/apply`).set("Origin", ORIGIN).send({ previewId: retry.body.previewId });
    expect(applied.status, applied.body).toBe(200);
    expect(applied.body.visits).toEqual(skipped.body.visits);
    expect(applied.body.budgetData.expenses).toEqual(originalExpenses);
    expect(applied.body.budgetData.summary.actualSpendingMinor).toBe(1700);
    const activities = applied.body.itinerary.days[0].activities.filter((item: { type: string }) => item.type === "attraction");
    expect(activities.find((item: { placeId: string }) => item.placeId === "node/1").itineraryItemId).toBe(itemId);
    expect(activities.filter((item: { placeId: string }) => item.placeId !== "node/1").every((item: { itineraryItemId: string }) => item.itineraryItemId !== itemId)).toBe(true);
    expect(new Set(activities.map((item: { itineraryItemId: string }) => item.itineraryItemId)).size).toBe(activities.length);
    expect((await agent.post(`${path}/days/1/apply`).set("Origin", ORIGIN).send({ previewId: retry.body.previewId })).status).toBe(410);
    expect((await TripModel.findById(trip.id))!.visits).toHaveLength(1);
  });

  it("keeps visits exactly when regeneration fails", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId, { attractions: ATTRACTIONS.map(place => ({ ...place, openingHours: { raw: "closed", source: "osm" } })) });
    const itemId = trip.itinerary!.days[0].activities[0].itineraryItemId!;
    const originalExpenses = (await mutateExpense(trip.id, userId, { type: "create", requestId: randomUUID(), expense: expenseInputSchema.parse({ title: "Real ticket", category: "attractions", currency: "EUR", amountMinor: 1700, type: "actual", itineraryItemId: itemId }) }, 0)).toObject().expenses;
    const marked = await agent.patch(`/api/trips/${trip.id}/visits/${itemId}`).set("Origin", ORIGIN).send({ status: "visited" });
    const failed = await agent.post(`/api/trips/${trip.id}/days/1/regenerate`).set("Origin", ORIGIN).send({ preferences: { surpriseMe: true } });
    expect(failed.status).toBe(409);
    const saved = (await TripModel.findById(trip.id))!.toObject();
    expect(saved.visits).toEqual(marked.body.visits);
    expect(saved.itinerary).toEqual(trip.toObject().itinerary);
    expect(saved.expenses).toEqual(originalExpenses);
  });

  it("requires unlocking before archiving an occurrence without transferring its status to a same-name replacement", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId, { attractions: ATTRACTIONS.map((place, index) => ({ ...place,
      ...(index === 0 ? { openingHours: { raw: "closed", source: "osm" } } : { name: "Louvre" }),
    })) });
    const itemId = trip.itinerary!.days[0].activities[0].itineraryItemId!;
    const originalExpenses = (await mutateExpense(trip.id, userId, { type: "create", requestId: randomUUID(), expense: expenseInputSchema.parse({ title: "Actual ticket", category: "attractions", currency: "EUR", amountMinor: 1700, type: "actual", itineraryItemId: itemId, date: "2026-06-01", dayId: "1" }) }, 0)).toObject().expenses;
    const path = `/api/trips/${trip.id}`;
    let marked = await agent.patch(`${path}/visits/${itemId}`).set("Origin", ORIGIN).send({ status: "visited" });
    expect(marked.status).toBe(200);
    expect((await agent.post(`${path}/days/1/regenerate`).set("Origin", ORIGIN).send({ preferences: { relaxedPace: true } })).status).toBe(409);
    marked = await agent.patch(`${path}/visits/${itemId}`).set("Origin", ORIGIN).send({ status: "skipped" });
    const preview = await agent.post(`${path}/days/1/regenerate`).set("Origin", ORIGIN).send({ preferences: { relaxedPace: true } });
    expect(preview.status, preview.body).toBe(200);
    const applied = await agent.post(`${path}/days/1/apply`).set("Origin", ORIGIN).send({ previewId: preview.body.previewId });
    expect(applied.status, applied.body).toBe(200);
    expect(applied.body.visits).toEqual(marked.body.visits);
    expect(applied.body.budgetData.expenses).toEqual(originalExpenses.map(expense => ({ ...expense, itineraryItemId: null })));
    expect(applied.body.budgetData.summary.actualSpendingMinor).toBe(1700);
    const items = applied.body.itinerary.days[0].activities.filter((item: { type: string }) => item.type === "attraction");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item: { itineraryItemId: string; placeId: string }) => item.itineraryItemId !== itemId && item.placeId !== "node/1")).toBe(true);
    expect(items.every((item: { title: string }) => item.title === "Louvre")).toBe(true);
  });
  it("applies a valid preview and replaces only that day", async () => {
    const { agent, userId } = await registerAgent();
    const admission = normalizeAdmission({ tourism: "museum", charge: "12 EUR/person" });
    const trip = await seedReadyTrip(userId, { attractions: ATTRACTIONS.map(p => ({ ...p, admission })) });

    const previewResponse = await agent
      .post(`/api/trips/${trip._id.toString()}/days/1/regenerate`)
      .set("Origin", ORIGIN)
      .send({ preferences: { relaxedPace: true } });

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.day.stops.every((p: { admission?: unknown }) => p.admission)).toBe(true);

    const applyResponse = await agent
      .post(`/api/trips/${trip._id.toString()}/days/1/apply`)
      .set("Origin", ORIGIN)
      .send({ previewId: previewResponse.body.previewId });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.itinerary.days[0].stops).toHaveLength(3);
    expect(applyResponse.body.itinerary.days).toHaveLength(1);
    const scheduledCount = applyResponse.body.itinerary.days[0].activities.filter((a: { type: string }) => a.type === "attraction").length;
    expect(applyResponse.body.admissionSummary.paidWithKnownPrice).toBe(scheduledCount);
    expect(applyResponse.body.admissionSummary.knownAdmissionTotals[0].amountMinor).toBe(1200 * scheduledCount * COMPLETE_ANALYSIS.travelers);

    const stored = await TripModel.findById(trip._id).exec();
    expect(stored?.itinerary?.days[0].stops).toHaveLength(3);
    expect(stored?.itinerary?.days[0].stops.every(p => p.admission?.price?.amountMinor === 1200)).toBe(true);
    expect(stored?.itineraryVersion).toBe(4);
    expect(stored?.regeneration).toBeNull();
  });

  it("returns 410 when the preview no longer exists", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId);

    const response = await agent
      .post(`/api/trips/${trip._id.toString()}/days/1/apply`)
      .set("Origin", ORIGIN)
      .send({ previewId: "no-such-preview" });

    expect(response.status).toBe(410);
  });

  it("returns 409 when the itinerary changed since the preview was created", async () => {
    const { agent, userId } = await registerAgent();
    const trip = await seedReadyTrip(userId);

    const previewResponse = await agent
      .post(`/api/trips/${trip._id.toString()}/days/1/regenerate`)
      .set("Origin", ORIGIN)
      .send({ preferences: { relaxedPace: true } });

    expect(previewResponse.status).toBe(200);

    await TripModel.updateOne(
      { _id: trip._id },
      { $set: { itineraryVersion: 7 } },
    ).exec();

    const applyResponse = await agent
      .post(`/api/trips/${trip._id.toString()}/days/1/apply`)
      .set("Origin", ORIGIN)
      .send({ previewId: previewResponse.body.previewId });

    expect(applyResponse.status).toBe(409);
  });
});
