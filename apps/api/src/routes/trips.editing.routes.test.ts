vi.mock("../middleware/rateLimit.js", () => ({ createLimiters: () => ({ auth: async () => {}, planning: async () => {} }) }));
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import type { ItineraryDay, ItineraryEditOperation, TripAttraction } from "@triply/shared";
import { env } from "../config/env.js";
import { TripModel } from "../models/Trip.js";
import { fetchAttractions } from "../services/attractions.js";
import { editTripItinerary } from "../services/tripItineraryEditor.js";
import { normalizeAdmission } from "../services/admissionPricingService.js";
import { randomUUID } from "node:crypto";
import { expenseInputSchema } from "@triply/shared";
import { assistantToolRegistry } from "../services/assistantToolRegistry.js";
import { createAssistantProposal } from "../services/assistantActions.js";
const assistantMock = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../ai/providers/factory.js", () => ({ createAIProvider: () => ({ generate: assistantMock.generate }) }));

const { provider } = vi.hoisted(() => ({ provider: {
  name: "test", supportedModes: ["walking"] as const, supportsMode: () => true,
  getTravelMatrix: vi.fn(async (coordinates: { lat: number; lng: number }[]) => ({
    distancesMeters: coordinates.map((_, from) => coordinates.map((_, to) => from === to ? 0 : 120)),
    durationsSeconds: coordinates.map((_, from) => coordinates.map((_, to) => from === to ? 0 : 120)),
  })),
  getRoute: vi.fn(async (coordinates: { lat: number; lng: number }[]) => ({
    distanceMeters: (coordinates.length - 1) * 120, durationSeconds: (coordinates.length - 1) * 120,
    geometry: { type: "LineString" as const, coordinates: coordinates.map((point) => [point.lng, point.lat] as [number, number]) },
    legs: coordinates.slice(1).map((_, index) => ({ fromIndex: index, toIndex: index + 1, distanceMeters: 120, durationSeconds: 120 })),
  })),
} }));
vi.mock("../routing/index.js", () => ({ createRoutingProvider: () => provider }));
vi.mock("../services/attractions.js", () => ({ fetchAttractions: vi.fn(async () => null) }));
vi.mock("../services/weather.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/weather.js")>(), fetchDailyWeather: vi.fn(async () => null),
}));
// Rate limiting is covered by auth tests; this suite exercises authenticated editing.

const pool: TripAttraction[] = Array.from({ length: 5 }, (_, index) => ({
  placeId: `node/${index + 1}`, name: index < 2 ? "Same display name" : `Place ${index + 1}`,
  category: "culture", lat: 48.85 + index * 0.001, lng: 2.35 + index * 0.001,
  visitDurationMinutes: 30, score: 80,
}));
function makeDay(dayIndex: number, ids: string[]): ItineraryDay {
  const places = ids.map((id) => pool.find((place) => place.placeId === id)!);
  return {
    dayIndex, date: `2026-06-0${dayIndex}`, timeZone: "Europe/Paris",
    activities: places.map((place, index) => ({ type: "attraction", placeId: place.placeId!, title: place.name,
      startTime: `2026-06-0${dayIndex}T${String(9 + index).padStart(2, "0")}:00:00+02:00`,
      endTime: `2026-06-0${dayIndex}T${String(9 + index).padStart(2, "0")}:30:00+02:00`, durationMinutes: 30 })),
    stops: places.map((place) => ({ placeId: place.placeId!, name: place.name, category: place.category,
      lat: place.lat, lng: place.lng, score: place.score ?? null })),
    geometry: null, segments: [], totalVisitMinutes: places.length * 30, totalTravelMinutes: 0,
    totalDistanceMeters: 0, partiallyEstimated: false, warnings: [],
  };
}
let mongod: MongoMemoryServer;
let app: FastifyInstance;
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = await (await import("../app.js")).createApp();
  // Concurrent Supertest requests must share one listener instead of racing
  // to start/stop the server and accumulating lifecycle event handlers.
  await app.listen({ host: "127.0.0.1", port: 0 });
}, 120_000);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchAttractions).mockResolvedValue(null); });
afterEach(async () => { for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({}); });
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongod?.stop(); });

async function setup() {
  const agent = request.agent(app.server);
  const registration = await agent.post("/api/auth/register").set("Origin", env.WEB_ORIGIN)
    .send({ email: "editor@example.com", password: "Password123!Aa" });
  expect(registration.status).toBe(201);
  const userId = registration.body.user.id as string;
  const trip = await TripModel.create({ user: new mongoose.Types.ObjectId(userId), status: "ready",
    analysis: { destination: "Paris", country: "France", startDate: "2026-06-01", endDate: "2026-06-03",
      durationDays: 3, travelers: 1, budget: { amount: 500, currency: "EUR", type: "total" },
      interests: ["culture"], pace: "balanced", maxWalkingDistanceKm: 5, notes: null,
      location: { lat: 48.85, lng: 2.35 } },
    attractions: pool, itineraryVersion: 3,
    itinerary: { timeZone: "Europe/Paris", routingSource: "provider",
      days: [makeDay(1, ["node/1", "node/2"]), makeDay(2, ["node/3"]), makeDay(3, [])], unscheduled: [] },
  });
  const edit = (operation: ItineraryEditOperation, expectedVersion = 3) => agent
    .post(`/api/trips/${trip.id}/itinerary/edit`).set("Origin", env.WEB_ORIGIN).send({ operation, expectedVersion });
  return { agent, trip, userId, edit };
}
const stopIds = (day: ItineraryDay) => day.stops.map((stop) => stop.placeId);

it.each(["en", "pl"] as const)("keeps editing constraints and unrelated days intact for %s content", async contentLocale => {
  const { trip, edit } = await setup();
  trip.contentLocale = contentLocale; await trip.save();
  const before = trip.toObject().itinerary!;
  const response = await edit({ type: "remove", dayIndex: 1, attractionId: "node/1" });
  expect(response.status, response.body).toBe(200);
  expect(response.body.trip.contentLocale).toBe(contentLocale);
  expect(response.body.trip.itinerary.days[0].stops.map((p: { placeId: string }) => p.placeId)).toEqual(["node/2"]);
  expect((await TripModel.findById(trip.id))!.toObject().itinerary!.days.slice(1)).toEqual(before.days.slice(1));
});

describe("Barcelona manual scheduling recovery", () => {
  async function barcelona() {
    const context = await setup();
    const attractions = pool.map((p, index) => ({ ...p, lat: 41.38 + index * .001, lng: 2.17,
      name: index === 3 ? "El Rincón Maya Restaurant" : index === 4 ? "SITAKE YA" : p.name,
      ...([0, 1, 3].includes(index) ? { openingHours: { raw: index === 3 ? "Mo 09:00-10:00" : "Mo 13:30-19:00", source: "osm" as const } } : {}) }));
    const selected = makeDay(1, ["node/1", "node/2", "node/4", "node/5"]);
    selected.stops = selected.stops.map(s => ({ ...s, ...attractions.find(p => p.placeId === s.placeId)!, score: 80 }));
    selected.activities.forEach(a => { a.title = attractions.find(p => p.placeId === a.placeId)!.name; });
    await TripModel.updateOne({ _id: context.trip._id }, { $set: {
      attractions, "analysis.location": { lat: 41.38, lng: 2.17 }, "analysis.destination": "Barcelona",
      "itinerary.days.0": selected,
      weather: [{ date: "2026-06-01", temperatureMin: 18, temperatureMax: 24, precipitationProbability: 0, weatherCode: 0 }],
      expenses: [{ id: "saved-expense", title: "Lunch", category: "food_drinks", amountMinor: 1500, currency: "EUR", type: "actual", createdAt: "2026-06-01", updatedAt: "2026-06-01" }],
    } });
    return context;
  }

  it.each(["node/5", "node/1", "node/4"])("removes %s despite an existing conflict without altering unrelated data", async attractionId => {
    const { trip, edit } = await barcelona();
    const before = (await TripModel.findById(trip._id))!.toObject();
    const result = await edit({ type: "remove", dayIndex: 1, attractionId });
    expect(result.status).toBe(200);
    const saved = (await TripModel.findById(trip._id))!.toObject();
    expect(stopIds(saved.itinerary!.days[0])).toEqual(["node/1", "node/2", "node/4", "node/5"].filter(id => id !== attractionId));
    expect(saved.itinerary!.days.slice(1)).toEqual(before.itinerary!.days.slice(1));
    expect(saved.weather).toEqual(before.weather);
    expect(saved.expenses).toEqual(before.expenses);
    expect(saved.analysis).toEqual(before.analysis);
    expect(saved.attractions).toEqual(before.attractions);
    expect(saved.itineraryVersion).toBe(4);
    if (attractionId !== "node/4") {
      expect(saved.itinerary!.days[0].activities.find(a => a.placeId === "node/4" && a.type === "attraction")).toMatchObject({ schedulingStatus: "unresolved", startTime: "", endTime: "" });
      expect(result.body.warnings.join(" ")).toContain("El Rincón Maya Restaurant");
    } else expect(saved.itinerary!.days[0].activities.every(a => !a.schedulingStatus)).toBe(true);
    expect((await edit({ type: "reroute", dayIndex: 1 })).status).toBe(409);
  });

  it("swaps the 13:30 visits, retains the restaurant conflict, and schedules unknown-hours SITAKE YA", async () => {
    const { edit } = await barcelona();
    const ids = ["node/2", "node/1", "node/4", "node/5"];
    const result = await edit({ type: "reorder", dayIndex: 1, attractionIds: ids });
    expect(result.status).toBe(200);
    const day = result.body.trip.itinerary.days[0] as ItineraryDay;
    expect(stopIds(day)).toEqual(ids);
    expect(day.activities.filter(a => a.type === "attraction").map(a => a.placeId)).toEqual(ids);
    expect(day.activities.find(a => a.placeId === "node/5" && a.type === "attraction")).toMatchObject({ openingHoursCheck: { status: "unknown" } });
    expect(result.body.warnings.join(" ")).toContain("Schedule unresolved");
    expect(result.body.trip.itinerary.unscheduled).toEqual([expect.objectContaining({ reason: "opening-hours-conflict", place: expect.objectContaining({ placeId: "node/4" }) })]);
  });

  it("recalculates a conflicted day, preserves every attraction, and permits subsequent removal", async () => {
    const { edit } = await barcelona();
    const result = await edit({ type: "reroute", dayIndex: 1 });
    expect(result.status).toBe(200);
    expect(stopIds(result.body.trip.itinerary.days[0])).toEqual(["node/1", "node/2", "node/4", "node/5"]);
    const retry = await edit({ type: "reroute", dayIndex: 1 }, 4);
    expect(retry.status).toBe(200);
    expect(retry.body.itineraryVersion).toBe(4);
    expect((await edit({ type: "remove", dayIndex: 1, attractionId: "node/4" }, 4)).status).toBe(200);
  });

  it("rejects a newly introduced opening-hours conflict atomically", async () => {
    const { trip, edit } = await barcelona();
    await TripModel.updateOne({ _id: trip._id }, { $set: { "attractions.1.openingHours.raw": "Mo 13:30-16:00" } });
    const before = (await TripModel.findById(trip._id))!.toObject();
    const result = await edit({ type: "reorder", dayIndex: 1, attractionIds: ["node/1", "node/5", "node/2", "node/4"] });
    expect(result.status).toBe(422);
    expect(result.body.conflicts).toContainEqual(expect.objectContaining({ place: expect.objectContaining({ placeId: "node/2" }), reason: "opening-hours-conflict" }));
    const after = (await TripModel.findById(trip._id))!.toObject();
    expect(after.itinerary).toEqual(before.itinerary);
    expect(after.itineraryVersion).toBe(3);
  });

  it("preserves another day's unresolved diagnostics when removing an attraction", async () => {
    const { trip, edit } = await barcelona();
    await TripModel.updateOne({ _id: trip._id }, { $set: { "attractions.2.visitDurationMinutes": 1440 } });
    const recovery = await edit({ type: "reroute", dayIndex: 2 });
    expect(recovery.status).toBe(200);
    const before = (await TripModel.findById(trip._id))!.toObject().itinerary!;
    expect(before.unscheduled.filter(entry => entry.dayIndex === 2)).toHaveLength(1);
    const result = await edit({ type: "remove", dayIndex: 1, attractionId: "node/5" }, 4);
    expect(result.status).toBe(200);
    const after = (await TripModel.findById(trip._id))!.toObject().itinerary!;
    expect(after.days[1]).toEqual(before.days[1]);
    expect(after.unscheduled.filter(entry => entry.dayIndex === 2)).toEqual(before.unscheduled.filter(entry => entry.dayIndex === 2));
    expect(result.body.trip.quality.valid).toBe(false);
    expect(result.body.trip.quality.issues).toContainEqual(expect.objectContaining({ code: "SCHEDULE_UNRESOLVED", severity: "error" }));
  });
});

describe("Step 10 persistent budget integration", () => {
  const input = (overrides: Record<string, unknown> = {}) => expenseInputSchema.parse({ title: "Lunch", category: "food_drinks", currency: "EUR", amountMinor: 2500, type: "planned", ...overrides });
  it("persists CRUD, separates statuses and keeps itinerary previews/revisions intact", async () => {
    const { agent, trip } = await setup(); const base = `/api/trips/${trip.id}`; const id = randomUUID();
    const preview = await agent.post(`${base}/days/1/regenerate`).set("Origin", env.WEB_ORIGIN).send({ preferences: { relaxedPace: true } });
    expect(preview.status).toBe(200);
    const created = await agent.post(`${base}/expenses`).set("Origin", env.WEB_ORIGIN).send({ expense: input({ dayId: "2", note: "Lunch reservation" }), requestId: id, expectedRevision: 0 });
    expect(created.status).toBe(201); expect(created.body.summary.plannedSpendingMinor).toBe(2500);
    expect(created.body.expenses[0]).toMatchObject({ id, dayId: "2", note: "Lunch reservation" });
    const edited = await agent.patch(`${base}/expenses/${id}`).set("Origin", env.WEB_ORIGIN).send({ expense: input({ type: "actual", amountMinor: 1800, dayId: "2", date: "2026-06-02" }), expectedRevision: 1 });
    expect(edited.status).toBe(200); expect(edited.body.summary).toMatchObject({ actualSpendingMinor: 1800, plannedSpendingMinor: 0 });
    const saved = await TripModel.findById(trip._id);
    expect(saved?.budgetRevision).toBe(2); expect(saved?.itineraryVersion).toBe(3); expect(saved?.regeneration?.previewId).toBe(preview.body.previewId);
    expect((await agent.get(`${base}/expenses`)).body.expenses[0].date).toBe("2026-06-02");
    expect((await agent.delete(`${base}/expenses/${id}`).set("Origin", env.WEB_ORIGIN).send({ expectedRevision: 2 })).body.expenses).toEqual([]);
  });
  it("rejects malformed amounts, currencies, categories, types and foreign references", async () => {
    const { agent, trip } = await setup();
    for (const invalid of [{ amountMinor: -1 }, { amountMinor: 1.1 }, { currency: "XYZ" }, { category: "invalid" }, { type: "paid" }, { dayId: "4" }, { attractionId: "node/999" }, { replacesAdmission: true }]) {
      const result = await agent.post(`/api/trips/${trip.id}/expenses`).set("Origin", env.WEB_ORIGIN).send({ expense: { ...input(), ...invalid }, requestId: randomUUID(), expectedRevision: 0 });
      expect(result.status).toBe(400);
    }
    expect((await TripModel.findById(trip._id))?.expenses).toHaveLength(0);
  });
  it("requires authentication and enforces ownership on reads and writes", async () => {
    const { trip, agent } = await setup();
    expect((await request(app.server).get(`/api/trips/${trip.id}/budget`)).status).toBe(401);
    const other = await TripModel.create({ ...trip.toObject(), _id: new mongoose.Types.ObjectId(), user: new mongoose.Types.ObjectId() });
    expect((await agent.get(`/api/trips/${other.id}/expenses`)).status).toBe(404);
    expect((await agent.post(`/api/trips/${other.id}/expenses`).set("Origin", env.WEB_ORIGIN).send({ expense: input(), requestId: randomUUID(), expectedRevision: 0 })).status).toBe(404);
  });
  it("makes creation retries idempotent and rejects concurrent stale writers", async () => {
    const { agent, trip } = await setup(); const path = `/api/trips/${trip.id}/expenses`; const id = randomUUID();
    const payload = { expense: input(), requestId: id, expectedRevision: 0 };
    expect((await agent.post(path).set("Origin", env.WEB_ORIGIN).send(payload)).status).toBe(201);
    expect((await agent.post(path).set("Origin", env.WEB_ORIGIN).send(payload)).body.expenses).toHaveLength(1);
    expect((await agent.post(path).set("Origin", env.WEB_ORIGIN).send({ ...payload, expense: input({ amountMinor: 5000 }) })).status).toBe(409);
    const results = await Promise.all([1,2].map(() => agent.post(path).set("Origin", env.WEB_ORIGIN).send({ expense: input(), requestId: randomUUID(), expectedRevision: 1 })));
    expect(results.map(r => r.status).sort()).toEqual([201,409]);
    expect((await TripModel.findById(trip._id))?.expenses).toHaveLength(2);
  });
  it("validates allocations without treating them as expenses", async () => {
    const { agent, trip } = await setup(); const path = `/api/trips/${trip.id}/budget`;
    const result = await agent.patch(path).set("Origin", env.WEB_ORIGIN).send({ allocations: { attractions: 15000, food_drinks: 15000 }, expectedRevision: 0 });
    expect(result.status).toBe(200); expect(result.body.summary.plannedSpendingMinor).toBe(0);
    expect((await agent.patch(path).set("Origin", env.WEB_ORIGIN).send({ allocations: { food_drinks: 50001 }, expectedRevision: 1 })).status).toBe(400);
    expect((await agent.patch(path).set("Origin", env.WEB_ORIGIN).send({ allocations: { other: -1 }, expectedRevision: 1 })).status).toBe(400);
    expect((await agent.get(path)).body.summary.allocations.attractions).toBe(15000);
  });
  it("reconciles explicit admissions, prevents duplicate replacements and preserves history through edits", async () => {
    const { agent, trip, edit } = await setup(); const base = `/api/trips/${trip.id}`;
    await TripModel.updateOne({ _id: trip._id }, { $set: { "attractions.0.admission": normalizeAdmission({ tourism: "museum", fee: "yes", charge: "15 EUR per person" }) } });
    expect((await agent.get(`${base}/budget`)).body.summary.plannedSpendingMinor).toBe(1500);
    const ticket = input({ title: "Admission", category: "attractions", attractionId: "node/1", dayId: "1", replacesAdmission: true, amountMinor: 1200, date: "2026-06-01" });
    const create = (revision: number) => agent.post(`${base}/expenses`).set("Origin", env.WEB_ORIGIN).send({ expense: ticket, requestId: randomUUID(), expectedRevision: revision });
    expect((await create(0)).body.summary.plannedSpendingMinor).toBe(1200);
    expect((await create(1)).status).toBe(400);
    const moved = await edit({ type: "move", sourceDayIndex: 1, targetDayIndex: 2, attractionId: "node/1" });
    expect(moved.body.trip.budgetData.summary.plannedSpendingMinor).toBe(1200);
    expect(moved.body.trip.budgetData.expenses[0]).toMatchObject({ date: "2026-06-01", dayId: "1" });
    const removed = await edit({ type: "remove", dayIndex: 2, attractionId: "node/1" }, 4);
    expect(removed.body.trip.budgetData.expenses).toHaveLength(1);
    expect(removed.body.trip.budgetData.summary.plannedSpendingMinor).toBe(1200);
  });
  it("regeneration applies despite unrelated expense changes and returns a fresh summary", async () => {
    const { agent, trip } = await setup(); const base = `/api/trips/${trip.id}`;
    const preview = await agent.post(`${base}/days/1/regenerate`).set("Origin", env.WEB_ORIGIN).send({ preferences: { relaxedPace: true } });
    expect(preview.status).toBe(200);
    await agent.post(`${base}/expenses`).set("Origin", env.WEB_ORIGIN).send({ expense: input({ type: "actual" }), requestId: randomUUID(), expectedRevision: 0 });
    const applied = await agent.post(`${base}/days/1/apply`).set("Origin", env.WEB_ORIGIN).send({ previewId: preview.body.previewId });
    expect(applied.status).toBe(200); expect(applied.body.budgetData.summary.actualSpendingMinor).toBe(2500); expect(applied.body.budgetData.expenses).toHaveLength(1);
  });
});
describe("read-only assistant HTTP integration", () => {
  it("persists ten consecutive turns, sends clean role history, replays requests and keeps trip unchanged", async () => {
    const { agent, trip } = await setup();
    const before = (await TripModel.findById(trip._id))!.toObject();
    assistantMock.generate.mockImplementation(async (request: { prompt: string }) => {
      const prompt = JSON.parse(request.prompt);
      expect(prompt.context.referents.dayIndex).toBe(2);
      return "Day 2: Place 3. Its admission cost is unknown.";
    });
    let conversationId: string | undefined;
    for (let turn = 0; turn < 10; turn++) {
      const payload = { message: turn ? "And how much will that day cost?" : "What am I doing on Day 2?", conversationId, requestId: randomUUID() };
      const send = () => agent.post(`/api/trips/${trip.id}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send(payload);
      const response = await send();
      expect(response.status).toBe(200); expect(response.body.response.type).toBe("message");
      expect(response.body.messages).toHaveLength((turn + 1) * 2);
      conversationId = response.body.conversationId;
      const prompt = JSON.parse(assistantMock.generate.mock.calls[turn][0].prompt);
      expect(prompt.history).toHaveLength(turn * 2);
      expect(JSON.stringify(prompt)).not.toMatch(/__parentArray|_doc|userId/);
      expect((await send()).body.messages).toEqual(response.body.messages);
    }
    expect(assistantMock.generate).toHaveBeenCalledTimes(10);
    expect((await TripModel.findById(trip._id))!.toObject()).toEqual(before);
    const history = await agent.get(`/api/trips/${trip.id}/assistant/conversations/${conversationId}`);
    expect(history.body.messages).toHaveLength(20);
  });
  it("handles provider failures, retry replacement, language changes and current trip context", async () => {
    const { agent, trip } = await setup(); const path = `/api/trips/${trip.id}/assistant/messages`;
    const { AiError } = await import("../ai/errors.js");
    for (const [code, expected] of [["timeout", "PROVIDER_TIMEOUT"], ["rate_limited", "RATE_LIMITED"], ["invalid_response", "PROVIDER_BAD_RESPONSE"], ["context_too_large", "CONTEXT_TOO_LARGE"]] as const) {
      assistantMock.generate.mockRejectedValueOnce(new AiError("private details", 502, { code }));
      const failed = await agent.post(path).set("Origin", env.WEB_ORIGIN).send({ message: "help", locale: "pl" });
      expect(failed.body.response).toMatchObject({ type: "error", code: expected });
      expect(failed.body.response.message).not.toContain("private");
      assistantMock.generate.mockResolvedValueOnce("Recovered");
      const retry = await agent.post(path).set("Origin", env.WEB_ORIGIN).send({ message: "help", locale: "en", retryMessageId: failed.body.messages.at(-2).id });
      expect(retry.body.messages).toHaveLength(failed.body.messages.length);
      expect(retry.body.response.message).toBe("Recovered");
      expect(assistantMock.generate.mock.lastCall![0].systemInstruction).toContain("natural English");
    }
    await TripModel.updateOne({ _id: trip._id }, { $set: { "itinerary.days.1.activities.0.title": "Updated attraction" } });
    assistantMock.generate.mockResolvedValueOnce("Current trip");
    await agent.post(path).set("Origin", env.WEB_ORIGIN).send({ message: "Day 2?" });
    expect(assistantMock.generate.mock.lastCall![0].prompt).toContain("Updated attraction");
  });
  it("blocks action execution and invalid/candidate payloads without changing trip data", async () => {
    const { agent, trip } = await setup(); const base = `/api/trips/${trip.id}/assistant`;
    expect((await agent.post(`${base}/actions/${randomUUID()}/apply`).set("Origin", env.WEB_ORIGIN).send({})).status).toBe(404);
    expect((await agent.post(`${base}/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "a".repeat(2001) })).status).toBe(400);
    expect((await agent.post(`${base}/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "pick", candidate: { attractionId: "node/4", position: 0 } })).status).toBe(400);
    expect((await TripModel.findById(trip._id))!.itineraryVersion).toBe(3);
    expect(assistantMock.generate).not.toHaveBeenCalled();
  });
  it("rejects concurrent sends before a second provider call", async () => {
    const { agent, trip } = await setup();
    let release!: (value: string) => void;
    let entered!: () => void;
    const ready = new Promise<void>(done => { entered = done; });
    assistantMock.generate.mockImplementationOnce(() => { entered(); return new Promise<string>(done => { release = done; }); });
    const path = `/api/trips/${trip.id}/assistant/messages`;
    const first = agent.post(path).set("Origin", env.WEB_ORIGIN).send({ message: "Day 2?" }).then(r => r);
    await ready;
    const second = await agent.post(path).set("Origin", env.WEB_ORIGIN).send({ message: "Also this" });
    expect(second.status).toBe(409);
    release("First response");
    expect((await first).status).toBe(200); expect(assistantMock.generate).toHaveBeenCalledTimes(1);
  });
  it("isolates users/trips, rejects invalid IDs, deleted trips and unauthenticated or shared-link access", async () => {
    const { agent, trip } = await setup();
    const history = await agent.get(`/api/trips/${trip.id}/assistant/conversations`);
    const other = request.agent(app.server);
    await other.post("/api/auth/register").set("Origin", env.WEB_ORIGIN).send({ email: "other-assistant@example.com", password: "Password123!Aa" });
    const url = `/api/trips/${trip.id}/assistant/conversations/${history.body.conversationId}`;
    expect((await request(app.server).get(url)).status).toBe(401);
    expect((await other.get(url)).status).toBe(404);
    expect((await agent.get("/api/trips/invalid/assistant/conversations")).status).toBe(404);
    const copy = trip.toObject();
    const second = await TripModel.create({ ...copy, _id: new mongoose.Types.ObjectId() });
    expect((await agent.get(`/api/trips/${second.id}/assistant/conversations/${history.body.conversationId}`)).status).toBe(404);
    await TripModel.deleteOne({ _id: trip._id });
    expect((await agent.get(url)).status).toBe(404); expect(assistantMock.generate).not.toHaveBeenCalled();
  });
});

describe("assistant confirmed actions HTTP integration", () => {
  const expense = { tool: "add_expense", arguments: { title: "Lunch", amount: "25", currency: "EUR", category: "food_drinks", type: "actual" } };
  const secondExpense = { tool: "add_expense", arguments: { title: "Taxi", amount: "10", currency: "EUR", category: "transport", type: "actual" } };
  async function actions() {
    const context = await setup();
    const base = `/api/trips/${context.trip.id}/assistant`;
    const propose = async (tools: unknown[], message?: string) => {
      message ??= tools.map(value => {
        const tool = value as { tool: string; arguments: Record<string, unknown> }; const args = tool.arguments;
        switch (tool.tool) {
          case "reschedule_attraction": return `Reschedule ${args.attraction} to ${args.time}`;
          case "move_attraction": return `Move ${args.attraction} to day ${args.targetDay}`;
          case "remove_attraction": return `Remove ${args.attraction}`;
          case "add_existing_attraction": return `Add ${args.attraction} to day ${args.day}`;
          case "suggest_replacement": return `Replace ${args.attraction} with ${args.replacement}`;
          case "update_expense": return `Update ${args.expense} expense to ${args.amount ?? ""} ${args.currency ?? ""}`;
          default: return `Record ${args.amount ?? "25"} ${args.currency ?? "EUR"} for ${args.title ?? "lunch"}`;
        }
      }).join(" and ");
      assistantMock.generate.mockResolvedValueOnce({ message: "", actions: tools });
      const result = await context.agent.post(`${base}/messages`).set("Origin", env.WEB_ORIGIN).send({ message, locale: "en" });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      return result.body;
    };
    const confirm = (id: string, body: Record<string, unknown> = {}) => context.agent.post(`${base}/actions/${id}/apply`).set("Origin", env.WEB_ORIGIN).send(body);
    return { ...context, base, propose, confirm };
  }
  it("previews without domain writes, atomically commits itinerary and expenses and replays simultaneous confirmations", async () => {
    const { trip, propose, confirm, agent, base } = await actions();
    const before = (await TripModel.findById(trip.id))!.toObject();
    const result = await propose([{ tool: "reschedule_attraction", arguments: { attraction: "Place 3", time: "15:00" } }, expense, secondExpense]);
    expect(result.response.type, JSON.stringify(result.response)).toBe("action_proposal");
    const p = result.response.proposal;
    expect(p.status, JSON.stringify(p)).toBe("pending");
    expect(p.changes).toHaveLength(3);
    expect(p.changes[1].after).toContain("25.00");
    const preview = (await TripModel.findById(trip.id))!.toObject();
    expect(preview.itinerary).toEqual(before.itinerary);
    expect(preview.expenses).toEqual(before.expenses);
    expect(preview.equipment).toEqual(before.equipment);
    const commits = await Promise.all([confirm(p.proposalId), confirm(p.proposalId)]);
    expect(commits.map(r => r.status), JSON.stringify(commits.map(r => r.body))).toEqual([200, 200]);
    const saved = (await TripModel.findById(trip.id))!;
    expect(saved.itineraryVersion).toBe(4);
    expect(saved.budgetRevision).toBe(1);
    expect(saved.itinerary!.days[1].activities.find(a => a.type === "attraction" && a.placeId === "node/3")?.startTime.slice(11, 16)).toBe("15:00");
    expect(saved.expenses).toHaveLength(2); expect(saved.expenses[0].amountMinor).toBe(2500);
    expect(saved.equipment).toHaveLength(0);
    expect((await confirm(p.proposalId)).status).toBe(200);
    const history = await agent.get(`${base}/conversations`);
    expect(history.body.proposals[0].status).toBe("completed");
    expect(JSON.stringify(history.body)).not.toMatch(/baseFingerprint|planFingerprint|evidence/);
    assistantMock.generate.mockResolvedValueOnce("Your saved itinerary was updated.");
    const followup = await agent.post(`${base}/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "What changed in my itinerary?" });
    expect(followup.body.response.type).toBe("message");
    expect(assistantMock.generate.mock.lastCall![0].prompt).toContain("Place 3");
    expect(assistantMock.generate.mock.lastCall![0].prompt).toContain("completed");
  });
  it.each(["itinerary", "expense"])("previews and confirms an unchanged legacy %s trip without query-casting false staleness", async domain => {
    const { trip, propose, confirm } = await actions();
    // Real stored trips can predate nested defaults added to the current schema.
    await TripModel.collection.updateOne({ _id: trip._id }, { $unset: { "analysis.notes": "", "itinerary.days.0.activities.0.durationSource": "", "attractions.0.openingHours": "" } });
    const before = await TripModel.collection.findOne({ _id: trip._id });
    const tool = domain === "expense" ? expense : { tool: "remove_attraction", arguments: { attraction: "Place 3" } };
    const result = await propose([tool]);
    expect(result.response.type, JSON.stringify(result.response)).toBe("action_proposal");
    expect(result.response.proposal.status).toBe("pending");
    const previewed = await TripModel.collection.findOne({ _id: trip._id });
    expect(previewed!.itinerary).toEqual(before!.itinerary); expect(previewed!.expenses).toEqual(before!.expenses); expect(previewed!.equipment).toEqual(before!.equipment);
    expect((await confirm(result.response.proposal.proposalId)).status).toBe(200);
    const saved = (await TripModel.findById(trip.id))!;
    expect(saved.itineraryVersion).toBe(domain === "itinerary" ? 4 : 3);
    expect(saved.budgetRevision).toBe(domain === "expense" ? 1 : 0);
  });
  it("rejects a genuine write during preview preparation and logs only changed field names", async () => {
    const { trip, userId } = await actions(); const log = vi.fn();
    const original = assistantToolRegistry.add_expense.prepareDraft;
    const prepare = vi.spyOn(assistantToolRegistry.add_expense, "prepareDraft").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await TripModel.collection.updateOne({ _id: trip._id }, { $set: { budgetRevision: 7 } });
      return result;
    });
    try {
      await expect(createAssistantProposal(trip.id, userId, [{ tool: "add_expense", arguments: { title: "Lunch", amount: "25", currency: "EUR", category: "food_drinks", type: "actual" } }], { locale: "en", evidence: "Add 25 EUR for lunch" }, log)).rejects.toMatchObject({ code: "PROPOSAL_STALE" });
    } finally { prepare.mockRestore(); }
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ stage: "proposal_cas_rejected", changedFields: ["budgetRevision"], currentBudgetRevision: 7 }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("Umbrella");
    const saved = (await TripModel.findById(trip.id))!; expect(saved.budgetRevision).toBe(7); expect(saved.equipment).toHaveLength(0);
  });
  it.each(["move", "indoor"])("routes a Polish %s request to the correct authorized proposal", async kind => {
    const { trip, agent, base, confirm } = await actions();
    await TripModel.updateOne({ _id: trip._id }, { $set: { "attractions.2.name": "Koloseum", "itinerary.days.1.activities.0.title": "Koloseum", "attractions.2.environment": "outdoor", "attractions.3.environment": "indoor" } });
    const message = kind === "move" ? "Przenieś Koloseum na trzeci dzień." : "Zamień Koloseum na atrakcję wewnątrz budynku.";
    assistantMock.generate.mockResolvedValueOnce({ message: "", actions: [kind === "move" ? { tool: "move_attraction", arguments: { attraction: "Koloseum", targetDay: "3" } } : { tool: "suggest_replacement", arguments: { attraction: "Koloseum", environment: "indoor" } }] });
    const result = await agent.post(`${base}/messages`).set("Origin", env.WEB_ORIGIN).send({ message, locale: "pl", requestId: randomUUID() });
    expect(result.body.response.type, JSON.stringify(result.body)).toBe("action_proposal");
    expect(result.body.response.proposal.actions[0].operation).toMatchObject(kind === "move" ? { type: "move", attractionId: "node/3", targetDayIndex: 3 } : { type: "replace", oldAttractionId: "node/3", newAttractionId: "node/4" });
    const prompt = JSON.parse(assistantMock.generate.mock.lastCall![0].prompt); expect(prompt.message).toBe(message); expect(prompt.context.trip.destination).toBe("Paris");
    expect((await confirm(result.body.response.proposal.proposalId)).status).toBe(200);
  });
  it.each(["unique", "ambiguous", "unknown"])("handles a generic indoor replacement using saved metadata: %s", async mode => {
    const { trip, agent, base } = await actions();
    if (mode !== "unknown") await TripModel.updateOne({ _id: trip._id }, { $set: { "attractions.2.environment": "outdoor", "attractions.3.environment": "indoor", ...(mode === "ambiguous" ? { "attractions.0.environment": "outdoor" } : {}) } });
    const result = await agent.post(`${base}/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Zamień atrakcję na świeżym powietrzu na coś pod dachem.", locale: "pl" });
    expect(assistantMock.generate).not.toHaveBeenCalled();
    if (mode === "unique") expect(result.body.response.proposal.actions[0].operation).toMatchObject({ type: "replace", oldAttractionId: "node/3", newAttractionId: "node/4" });
    else { expect(result.body.response.type).toBe("clarification"); expect(result.body.response.message).toContain(mode === "ambiguous" ? "Wybierz dokładną nazwę" : "wiarygodnego oznaczenia"); }
    expect((await TripModel.findById(trip.id))!.itineraryVersion).toBe(3);
  });
  it("replaces a pending Polish move proposal without executing either preview", async () => {
    const { trip, agent, base, confirm } = await actions();
    await TripModel.updateOne({ _id: trip._id }, { $set: { "attractions.0.name": "Koloseum", "itinerary.days.0.activities.0.title": "Koloseum" } });
    assistantMock.generate.mockResolvedValueOnce({ message: "", actions: [{ tool: "move_attraction", arguments: { attraction: "Koloseum", targetDay: "2" } }] });
    const first = await agent.post(`${base}/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Przenieś Koloseum na drugi dzień.", locale: "pl" });
    assistantMock.generate.mockResolvedValueOnce({ message: "", actions: [{ tool: "move_attraction", arguments: { attraction: "Koloseum", targetDay: "3" } }] });
    const second = await agent.post(`${base}/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Jednak na trzeci dzień.", locale: "pl" });
    expect(second.body.response.proposal.actions[0].operation).toMatchObject({ type: "move", attractionId: "node/1", sourceDayIndex: 1, targetDayIndex: 3 });
    expect((await TripModel.findById(trip.id))!.itineraryVersion).toBe(3);
    expect((await confirm(first.body.response.proposal.proposalId)).body.code).toBe("PROPOSAL_REJECTED");
    expect((await confirm(second.body.response.proposal.proposalId)).status).toBe(200);
  });
  it.each(["cancel", "expire", "stale"])("rejects %s proposals without changing domain state", async mode => {
    const { trip, agent, base, propose, confirm } = await actions();
    const result = await propose([expense]); const id = result.response.proposal.proposalId;
    if (mode === "cancel") expect((await agent.delete(`${base}/actions/${id}`).set("Origin", env.WEB_ORIGIN)).body.proposal.status).toBe("rejected");
    if (mode === "expire") await TripModel.updateOne({ _id: trip._id }, { $set: { "assistantAction.expiresAt": "2000-01-01T00:00:00.000Z" } });
    if (mode === "stale") await TripModel.updateOne({ _id: trip._id }, { $set: { budgetRevision: 9 } });
    const commit = await confirm(id);
    expect(commit.status).toBe(mode === "expire" ? 410 : 409);
    expect(commit.body.code).toBe(`PROPOSAL_${mode === "cancel" ? "REJECTED" : mode === "expire" ? "EXPIRED" : "STALE"}`);
    const saved = (await TripModel.findById(trip.id))!;
    expect(saved.expenses).toHaveLength(0); expect(saved.itineraryVersion).toBe(3);
    if (mode === "stale") expect(saved.budgetRevision).toBe(9);
  });
  it("protects ownership, rejects tampered confirmation bodies and leaves a valid proposal usable", async () => {
    const { trip, propose, confirm, base } = await actions();
    const { response: { proposal } } = await propose([secondExpense]);
    const other = request.agent(app.server);
    await other.post("/api/auth/register").set("Origin", env.WEB_ORIGIN).send({ email: "action-other@example.com", password: "Password123!Aa" });
    expect((await other.post(`${base}/actions/${proposal.proposalId}/apply`).set("Origin", env.WEB_ORIGIN).send({})).status).toBe(404);
    expect((await request(app.server).post(`${base}/actions/${proposal.proposalId}/apply`).set("Origin", env.WEB_ORIGIN).send({})).status).toBe(401);
    expect((await confirm(proposal.proposalId, { actions: [{ tool: "remove_attraction" }] })).status).toBe(400);
    expect((await TripModel.findById(trip.id))!.equipment).toHaveLength(0);
    expect((await confirm(proposal.proposalId)).status).toBe(200);
  });
  it("supersedes a pending proposal on a conversational amendment", async () => {
    const { trip, propose, confirm } = await actions();
    const first = await propose([{ tool: "reschedule_attraction", arguments: { attraction: "Place 3", time: "15:00" } }]);
    const second = await propose([{ tool: "reschedule_attraction", arguments: { attraction: "Place 3", time: "16:00" } }], "Actually, make it 4 PM.");
    expect(second.response.type).toBe("action_proposal");
    expect((await confirm(first.response.proposal.proposalId)).body.code).toBe("PROPOSAL_REJECTED");
    expect((await confirm(second.response.proposal.proposalId)).status).toBe(200);
    expect((await TripModel.findById(trip.id))!.itinerary!.days[1].activities.find(a => a.type === "attraction" && a.placeId === "node/3")?.startTime.slice(11, 16)).toBe("16:00");
  });
  it("blocks a whole batch on scheduling conflicts and does not create its expense", async () => {
    const { trip, propose, confirm } = await actions();
    const result = await propose([{ tool: "reschedule_attraction", arguments: { attraction: "Place 3", time: "23:00" } }, expense]);
    expect(result.response.proposal.status).toBe("failed");
    expect(result.response.proposal.conflicts.length).toBeGreaterThan(0);
    expect((await confirm(result.response.proposal.proposalId)).status).toBe(409);
    expect((await TripModel.findById(trip.id))!.expenses).toHaveLength(0);
  });
  it("clarifies ambiguous names then resolves a follow-up ID without silently selecting", async () => {
    const { trip, propose, confirm } = await actions();
    const ambiguous = await propose([{ tool: "remove_attraction", arguments: { attraction: "Same display name" } }], "Remove Same display name");
    expect(ambiguous.response.type).toBe("clarification");
    expect(ambiguous.response.message).toContain("node/1"); expect(ambiguous.response.message).toContain("node/2");
    expect((await TripModel.findById(trip.id))!.assistantAction).toBeNull();
    const chosen = await propose([{ tool: "remove_attraction", arguments: { attraction: "node/1" } }], "node/1");
    expect(chosen.response.type).toBe("action_proposal");
    expect((await confirm(chosen.response.proposal.proposalId)).status).toBe(200);
    expect((await TripModel.findById(trip.id))!.itinerary!.days[0].stops.map(p => p.placeId)).toEqual(["node/2"]);
  });
  it.each([
    { tool: "move_attraction", arguments: { attraction: "Place 3", targetDay: "3" } },
    { tool: "add_existing_attraction", arguments: { attraction: "Place 4", day: "3" } },
    { tool: "suggest_replacement", arguments: { attraction: "Place 3", replacement: "Place 4" } },
  ])("reuses the itinerary editor for $tool", async tool => {
    const { propose, confirm, trip } = await actions();
    const result = await propose([tool]);
    expect(result.response.proposal.status, JSON.stringify(result.response)).toBe("pending");
    expect((await confirm(result.response.proposal.proposalId)).status).toBe(200);
    const saved = (await TripModel.findById(trip.id))!;
    expect(saved.itineraryVersion).toBe(4);
    const days = saved.itinerary!.days;
    if (tool.tool === "move_attraction") { expect(days[1].stops).toHaveLength(0); expect(days[2].stops[0].placeId).toBe("node/3"); }
    else if (tool.tool === "add_existing_attraction") expect(days[2].stops[0].placeId).toBe("node/4");
    else expect(days[1].stops[0].placeId).toBe("node/4");
  });
  it("redirects packing requests and preserves standalone equipment CRUD", async () => {
    const { trip, agent, base, confirm, propose } = await actions();
    const response = await agent.post(base + "/messages").set("Origin", env.WEB_ORIGIN).send({ message: "Dodaj parasol do listy pakowania", locale: "pl" });
    expect(response.body.response.message).toContain("Asystent Pakowania"); expect(assistantMock.generate).not.toHaveBeenCalled();
    const disabled = await propose([{ tool: "add_packing_item", arguments: { name: "Umbrella", count: 1 } }], "Add an attraction");
    expect(disabled.response.type).toBe("error");
    const created = await agent.post(`/api/trips/${trip.id}/equipment`).set("Origin", env.WEB_ORIGIN).send({ name: "Umbrella", count: 1 });
    expect(created.status).toBe(201);
    expect((await agent.patch(`/api/trips/${trip.id}/equipment/${created.body.id}`).set("Origin", env.WEB_ORIGIN).send({ packed: true })).status).toBe(200);
    const proposalId = randomUUID();
    await TripModel.updateOne({ _id: trip._id }, { $set: { assistantAction: { proposalId, tripId: trip.id, status: "pending", expiresAt: new Date(Date.now() + 600000).toISOString(), actions: [{ domain: "packing", tool: "remove_packing_item", operation: { type: "delete", itemId: created.body.id } }] } } });
    expect((await confirm(proposalId)).status).toBe(409);
    expect((await TripModel.findById(trip.id))!.equipment[0].packed).toBe(true);
  });
  it("previews expense category, day and date changes before confirmation", async () => {
    const { trip, propose, confirm } = await actions();
    const initial = await propose([expense]);
    expect((await confirm(initial.response.proposal.proposalId)).status).toBe(200);
    const result = await propose([{ tool: "update_expense", arguments: { expense: "Lunch", category: "other", day: "2", date: "2026-06-02" } }], "Update Lunch expense to Other on day 2, June 2");
    const change = result.response.proposal.changes[0];
    expect(change.before).toContain("Food & Drinks");
    expect(change.after).toContain("Other"); expect(change.after).toContain("Day 2"); expect(change.after).toContain("2026-06-02");
    expect((await TripModel.findById(trip.id))!.expenses[0].category).toBe("food_drinks");
    expect((await confirm(result.response.proposal.proposalId)).status).toBe(200);
    expect((await TripModel.findById(trip.id))!.expenses[0]).toMatchObject({ category: "other", dayId: "2", date: "2026-06-02" });
  });
  it.each(["expense", "packing"])("rejects a proposal after independent %s changes, preserving the newer state", async domain => {
    const { trip, propose, confirm } = await actions();
    const initial = await propose([expense, secondExpense]);
    expect((await confirm(initial.response.proposal.proposalId)).status).toBe(200);
    await TripModel.updateOne({ _id: trip._id }, { $push: { equipment: { _id: new mongoose.Types.ObjectId(), name: "Umbrella", count: 1, packed: false } } });
    const result = await propose([{ tool: "update_expense", arguments: { expense: "Lunch", amount: "30" } }], "Update Lunch expense to 30");
    // Compare facts as well as revisions: even writes without revision increments
    // must invalidate a reviewed proposal.
    await TripModel.updateOne({ _id: trip._id }, { $set: domain === "expense" ? { "expenses.0.amountMinor": 4000 } : { "equipment.0.packed": true } });
    const before = (await TripModel.findById(trip.id))!.toObject();
    expect((await confirm(result.response.proposal.proposalId)).body.code).toBe("PROPOSAL_STALE");
    const after = (await TripModel.findById(trip.id))!.toObject();
    expect(after.expenses).toEqual(before.expenses); expect(after.equipment).toEqual(before.equipment); expect(after.itinerary).toEqual(before.itinerary);
  });
  it("rejects unknown tools, extra properties and invented money without domain writes", async () => {
    const { propose, trip } = await actions();
    for (const tool of [{ tool: "run_sql", arguments: { query: "delete everything" } }, { ...secondExpense, arguments: { ...secondExpense.arguments, user: "other" } }]) {
      const result = await propose([tool]); expect(result.response).toMatchObject({ type: "error", code: "PROVIDER_BAD_RESPONSE" });
    }
    const invented = await propose([expense], "Add a lunch expense");
    expect(invented.response.type).toBe("clarification");
    const saved = (await TripModel.findById(trip.id))!;
    expect(saved.expenses).toHaveLength(0); expect(saved.equipment).toHaveLength(0);
  });
  it("supports legacy documents with missing default fields and retains replay receipts after supersession", async () => {
    const { trip, propose, confirm } = await actions();
    await TripModel.collection.updateOne({ _id: trip._id }, { $unset: { equipment: "", expenses: "", budgetRevision: "", assistantAction: "", assistantActionHistory: "" } });
    const first = await propose([expense]);
    expect(first.response.type).toBe("action_proposal");
    expect((await confirm(first.response.proposal.proposalId)).status).toBe(200);
    const second = await propose([secondExpense]);
    expect((await confirm(second.response.proposal.proposalId)).status).toBe(200);
    expect((await confirm(first.response.proposal.proposalId)).body.proposal.status).toBe("completed");
    const saved = (await TripModel.findById(trip.id))!;
    expect(saved.expenses).toHaveLength(2); expect(saved.equipment).toHaveLength(0);
  });
  it("does not duplicate changes when persistence succeeds but its response is lost", async () => {
    const { trip, propose, confirm } = await actions();
    const result = await propose([expense, secondExpense]);
    const original = TripModel.collection.findOneAndUpdate.bind(TripModel.collection);
    const write = vi.spyOn(TripModel.collection, "findOneAndUpdate").mockImplementationOnce(async (...args) => { await original(...args); throw new Error("Lost database acknowledgement"); });
    try { expect((await confirm(result.response.proposal.proposalId)).status).toBe(500); }
    finally { write.mockRestore(); }
    expect((await confirm(result.response.proposal.proposalId)).body.proposal.status).toBe("completed");
    const saved = (await TripModel.findById(trip.id))!;
    expect(saved.expenses).toHaveLength(2); expect(saved.equipment).toHaveLength(0);
  });
  it("leaves no partial batch on a database failure and allows a safe retry", async () => {
    const { trip, propose, confirm } = await actions();
    const result = await propose([expense, secondExpense]);
    const write = vi.spyOn(TripModel.collection, "findOneAndUpdate").mockRejectedValueOnce(new Error("Database unavailable"));
    try { expect((await confirm(result.response.proposal.proposalId)).status).toBe(500); }
    finally { write.mockRestore(); }
    const unchanged = (await TripModel.findById(trip.id))!;
    expect(unchanged.expenses).toHaveLength(0); expect(unchanged.equipment).toHaveLength(0); expect(unchanged.assistantAction?.status).toBe("pending");
    expect((await confirm(result.response.proposal.proposalId)).status).toBe(200);
  });
});

describe("manual itinerary editing", () => {
  it("requires explicit regeneration to save preferences on a ready trip and invalidates the old itinerary", async () => {
    const { agent, trip } = await setup();
    const patch = (regenerate?: boolean) => agent.patch(`/api/trips/${trip.id}/requirements`).set("Origin", env.WEB_ORIGIN)
      .send({ answers: { pace: "relaxed", maxWalkingDistanceKm: 3 }, confirmedFields: [], regenerate });
    expect((await patch()).status).toBe(409);
    const result = await patch(true);
    expect(result.status).toBe(200);
    expect(result.body.analysis).toMatchObject({ pace: "relaxed", maxWalkingDistanceKm: 3 });
    const saved = await TripModel.findById(trip._id);
    expect(saved?.status).toBe("draft");
    expect(saved?.itinerary).toBeNull();
    expect(saved?.itineraryVersion).toBe(4);
    expect(saved?.regeneration).toBeNull();
  });
  it("persists OSM metadata and date-specific checks through MongoDB and the detail API", async () => {
    const { edit, trip, agent } = await setup();
    const metadata = { raw: "Mo-Fr 10:00-18:00", source: "osm", checkedAt: "2026-05-01", website: "https://museum.example", legacyCovid19: "off" };
    const admission = normalizeAdmission({ tourism: "museum", fee: "yes", charge: "12 EUR/person" });
    await TripModel.updateOne({ _id: trip._id }, { $set: { "attractions.3.openingHours": metadata, "attractions.3.admission": admission } });
    const result = await edit({ type: "add", dayIndex: 3, attractionId: "node/4" });
    expect(result.status).toBe(200);
    const persisted = await TripModel.findById(trip._id);
    expect(persisted?.attractions[3].openingHours?.raw).toBe(metadata.raw);
    expect(persisted?.attractions[3].admission?.price?.amountMinor).toBe(1200);
    expect(persisted?.attractions[3].openingHours?.legacyCovid19).toBe("off");
    const response = await agent.get(`/api/trips/${trip.id}`);
    expect(response.body.itinerary.days[2].stops.find((p: { placeId: string }) => p.placeId === "node/4").admission.price.amountMinor).toBe(1200);
    expect(response.body.admissionSummary.paidWithKnownPrice).toBe(1);
    expect(response.body.admissionSummary.isComplete).toBe(false);
    const activity = response.body.itinerary.days[2].activities.find((entry: { placeId?: string }) => entry.placeId === "node/4" && "openingHoursCheck" in entry);
    expect(activity.openingHoursCheck).toMatchObject({ status: "open", source: "osm", timeZone: "Europe/Paris" });
    expect(activity.startTime).toContain("T10:00");
  });
  it("retries routing through the edit endpoint while preserving attraction order and other days", async () => {
    const { edit, trip, agent } = await setup();
    const before = await agent.get(`/api/trips/${trip.id}`);
    const result = await edit({ type: "reroute", dayIndex: 1 });
    expect(result.status).toBe(200);
    expect(result.body.affectedDayIndices).toEqual([1]);
    expect(result.body.itineraryVersion).toBe(4);
    const updated = result.body.trip.itinerary.days[0] as ItineraryDay;
    expect(stopIds(updated)).toEqual(["node/1", "node/2"]);
    expect(updated.geometry?.coordinates).toHaveLength(3);
    expect(updated.totalTravelMinutes).toBe(4);
    expect(updated.totalDistanceMeters).toBe(240);
    expect(updated.activities.filter((activity) => activity.type === "attraction").map((activity) => activity.placeId)).toEqual(stopIds(updated));
    expect(result.body.trip.itinerary.days.slice(1)).toEqual(before.body.itinerary.days.slice(1));
    expect(provider.getRoute).toHaveBeenCalledTimes(1);
    expect(result.body.warnings).toContain("Opening hours unverified for 2 attraction(s). Schedule is tentative.");
    expect(result.body.warnings.join(" ")).not.toContain(";");
    const refreshed = await agent.get(`/api/trips/${trip.id}`);
    expect(refreshed.body.itinerary).toEqual(result.body.trip.itinerary);
    expect((await edit({ type: "reroute", dayIndex: 1 }, 3)).status).toBe(409);
    expect((await edit({ type: "reroute", dayIndex: 99 }, 4)).status).toBe(404);
  });

  it("preserves all attractions and returns punctuated warnings when retry routing is unavailable", async () => {
    const { trip, userId } = await setup();
    const result = await editTripItinerary(trip.id, userId, {
      expectedVersion: 3, operation: { type: "reroute", dayIndex: 1 },
    }, { provider: null });
    expect(stopIds(result.trip.itinerary!.days[0])).toEqual(["node/1", "node/2"]);
    expect(result.trip.itinerary!.days[0].geometry).toBeNull();
    expect(result.warnings).toContain("Routing is unavailable. Travel distance and time are estimates. Route geometry is unavailable.");
    expect(result.warnings.join(" ")).not.toContain(";");
    expect(result.itineraryVersion).toBe(4);
  });

  it("adds at a chosen position, recalculates routing and times, persists, and preserves unrelated days", async () => {
    const { edit, trip, agent } = await setup();
    const before = await agent.get(`/api/trips/${trip.id}`);
    const result = await edit({ type: "add", dayIndex: 1, attractionId: "node/4", position: 1 });
    expect(result.status).toBe(200);
    expect(result.body.itineraryVersion).toBe(4);
    expect(result.body.affectedDayIndices).toEqual([1]);
    const day = result.body.trip.itinerary.days[0] as ItineraryDay;
    expect(stopIds(day)).toEqual(["node/1", "node/4", "node/2"]);
    expect(day.activities.filter((entry) => entry.type === "attraction").map((entry) => entry.placeId)).toEqual(stopIds(day));
    expect(day.segments).toHaveLength(3);
    expect(day.totalVisitMinutes).toBe(90);
    expect(day.totalTravelMinutes).toBe(6);
    expect(day.totalDistanceMeters).toBe(360);
    expect(day.geometry?.coordinates).toHaveLength(4);
    expect(day.activities[0].type).toBe("travel");
    expect(day.activities[1].startTime).toContain("09:02");
    expect(provider.getRoute).toHaveBeenCalledTimes(1);
    expect(result.body.trip.itinerary.days.slice(1)).toEqual(before.body.itinerary.days.slice(1));
    const refreshed = await agent.get(`/api/trips/${trip.id}`);
    expect(refreshed.body.itinerary).toEqual(result.body.trip.itinerary);
    expect(refreshed.body.itineraryVersion).toBe(4);
  });

  it("removes without deleting candidates and clears obsolete legs", async () => {
    const { edit, trip } = await setup();
    const result = await edit({ type: "remove", dayIndex: 1, attractionId: "node/1" });
    expect(result.status).toBe(200);
    expect(stopIds(result.body.trip.itinerary.days[0])).toEqual(["node/2"]);
    expect(result.body.trip.itinerary.days[0].segments).toHaveLength(1);
    expect((await TripModel.findById(trip._id))?.attractions).toHaveLength(5);
  });

  it("reorders exactly as requested, including identically named attractions", async () => {
    const { edit } = await setup();
    const result = await edit({ type: "reorder", dayIndex: 1, attractionIds: ["node/2", "node/1"] });
    expect(result.status).toBe(200);
    expect(stopIds(result.body.trip.itinerary.days[0])).toEqual(["node/2", "node/1"]);
    expect(provider.getRoute.mock.calls[0][0].slice(1)).toEqual([
      { lat: pool[1].lat, lng: pool[1].lng }, { lat: pool[0].lat, lng: pool[0].lng },
    ]);
  });

  it("moves both days in one version increment and preserves other ordering", async () => {
    const { edit } = await setup();
    const result = await edit({ type: "move", sourceDayIndex: 1, targetDayIndex: 2, attractionId: "node/1", position: 1 });
    expect(result.status).toBe(200);
    expect(result.body.affectedDayIndices).toEqual([1, 2]);
    expect(result.body.itineraryVersion).toBe(4);
    expect(stopIds(result.body.trip.itinerary.days[0])).toEqual(["node/2"]);
    expect(stopIds(result.body.trip.itinerary.days[1])).toEqual(["node/3", "node/1"]);
    expect(provider.getRoute).toHaveBeenCalledTimes(2);
  });

  it("replaces in place without regenerating or losing unrelated attractions", async () => {
    const { edit } = await setup();
    const result = await edit({ type: "replace", dayIndex: 1, oldAttractionId: "node/1", newAttractionId: "node/4" });
    expect(result.status).toBe(200);
    expect(stopIds(result.body.trip.itinerary.days[0])).toEqual(["node/4", "node/2"]);
  });

  it.each<ItineraryEditOperation>([
    { type: "add", dayIndex: 1, attractionId: "node/3" },
    { type: "replace", dayIndex: 1, oldAttractionId: "node/1", newAttractionId: "node/3" },
    { type: "reorder", dayIndex: 1, attractionIds: ["node/1", "node/1"] },
    { type: "reorder", dayIndex: 1, attractionIds: ["node/1"] },
    { type: "reorder", dayIndex: 1, attractionIds: ["node/1", "node/3"] },
    { type: "remove", dayIndex: 1, attractionId: "node/3" },
    { type: "move", sourceDayIndex: 1, targetDayIndex: 1, attractionId: "node/1" },
    { type: "add", dayIndex: 1, attractionId: "node/4", position: 99 },
  ])("rejects invalid or duplicate operation %j without writes", async (operation) => {
    const { edit, trip } = await setup();
    const result = await edit(operation);
    expect(result.status).toBe(400);
    expect((await TripModel.findById(trip._id))?.itineraryVersion).toBe(3);
    expect(provider.getRoute).not.toHaveBeenCalled();
  });

  it("rejects foreign day and unknown candidate IDs", async () => {
    const { edit } = await setup();
    expect((await edit({ type: "add", dayIndex: 99, attractionId: "node/4" })).status).toBe(404);
    expect((await edit({ type: "add", dayIndex: 1, attractionId: "foreign/9" })).status).toBe(404);
  });

  it("rejects client-supplied attraction objects and malformed operations", async () => {
    const { agent, trip } = await setup();
    const result = await agent.post(`/api/trips/${trip.id}/itinerary/edit`).set("Origin", env.WEB_ORIGIN)
      .send({ expectedVersion: 3, operation: { type: "add", dayIndex: 1, attractionId: "node/4", attraction: pool[3] } });
    expect(result.status).toBe(400);
  });

  it("authenticates and enforces ownership in both the route and reusable service", async () => {
    const { trip, userId } = await setup();
    const payload = { expectedVersion: 3, operation: { type: "remove" as const, dayIndex: 1, attractionId: "node/1" } };
    const anonymous = await request(app.server).post(`/api/trips/${trip.id}/itinerary/edit`).set("Origin", env.WEB_ORIGIN).send(payload);
    expect(anonymous.status).toBe(401);
    const other = request.agent(app.server);
    await other.post("/api/auth/register").set("Origin", env.WEB_ORIGIN).send({ email: "other@example.com", password: "Password123!Aa" });
    expect((await other.post(`/api/trips/${trip.id}/itinerary/edit`).set("Origin", env.WEB_ORIGIN).send(payload)).status).toBe(404);
    expect((await other.post(`/api/trips/${trip.id}/itinerary/candidates`).set("Origin", env.WEB_ORIGIN).send({})).status).toBe(404);
    await expect(editTripItinerary(trip.id, new mongoose.Types.ObjectId().toString(), payload)).rejects.toMatchObject({ status: 404 });
    expect((await TripModel.findById(trip._id))?.user!.toString()).toBe(userId);
  });

  it("rejects stale versions and allows only one simultaneous writer", async () => {
    const { edit, trip, userId } = await setup();
    expect((await edit({ type: "remove", dayIndex: 1, attractionId: "node/1" }, 2)).status).toBe(409);
    const writes = await Promise.allSettled([
      editTripItinerary(trip.id, userId, { expectedVersion: 3, operation: { type: "remove", dayIndex: 1, attractionId: "node/1" } }, { provider }),
      editTripItinerary(trip.id, userId, { expectedVersion: 3, operation: { type: "remove", dayIndex: 2, attractionId: "node/3" } }, { provider }),
    ]);
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = writes.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ status: 409 });
    expect((await TripModel.findById(trip._id))?.itineraryVersion).toBe(4);
  });

  it("returns structured capacity conflicts and never saves a partial multi-day move", async () => {
    const { edit, trip, agent } = await setup();
    await TripModel.updateOne({ _id: trip._id }, { $set: { "attractions.0.visitDurationMinutes": 570 } });
    const before = await agent.get(`/api/trips/${trip.id}`);
    const result = await edit({ type: "move", sourceDayIndex: 1, targetDayIndex: 2, attractionId: "node/1" });
    expect(result.status).toBe(422);
    expect(result.body.conflicts.map((entry: { place: { placeId: string } }) => entry.place.placeId)).toContain("node/1");
    expect(result.body.warnings.length).toBeGreaterThan(0);
    const after = await agent.get(`/api/trips/${trip.id}`);
    expect(after.body.itinerary).toEqual(before.body.itinerary);
    expect(after.body.itineraryVersion).toBe(3);
  });

  it("allows empty days and adding back after removal", async () => {
    const { edit } = await setup();
    const empty = await edit({ type: "remove", dayIndex: 2, attractionId: "node/3" });
    expect(empty.status).toBe(200);
    expect(empty.body.trip.itinerary.days[1].activities).toEqual([]);
    expect(empty.body.trip.itinerary.days[1].geometry).toBeNull();
    const added = await edit({ type: "add", dayIndex: 3, attractionId: "node/3" }, 4);
    expect(added.status).toBe(200);
    expect(stopIds(added.body.trip.itinerary.days[2])).toEqual(["node/3"]);
  });

  it("invalidates a real regeneration preview", async () => {
    const { agent, edit, trip } = await setup();
    const preview = await agent.post(`/api/trips/${trip.id}/days/1/regenerate`).set("Origin", env.WEB_ORIGIN)
      .send({ preferences: { relaxedPace: true } });
    expect(preview.status).toBe(200);
    expect((await edit({ type: "remove", dayIndex: 1, attractionId: "node/1" })).status).toBe(200);
    expect((await TripModel.findById(trip._id))?.regeneration).toBeNull();
    const applied = await agent.post(`/api/trips/${trip.id}/days/1/apply`).set("Origin", env.WEB_ORIGIN).send({ previewId: preview.body.previewId });
    expect(applied.status).toBe(410);
  });

  it("uses the routing fallback with explicit estimates and no fabricated geometry", async () => {
    const { trip, userId } = await setup();
    const result = await editTripItinerary(trip.id, userId, { expectedVersion: 3,
      operation: { type: "reorder", dayIndex: 1, attractionIds: ["node/2", "node/1"] } }, { provider: null });
    const day = result.trip.itinerary!.days[0];
    expect(stopIds(day)).toEqual(["node/2", "node/1"]);
    expect(day.geometry).toBeNull();
    expect(day.partiallyEstimated).toBe(true);
    expect(result.warnings.join(" ")).toContain("estimates");
    expect(day.activities.find((entry) => entry.type === "travel")?.travelDurationSource).toBe("approximation");
  });

  it("never silently discards an existing activity when persisted stop metadata is missing", async () => {
    const { edit, trip } = await setup();
    await TripModel.updateOne({ _id: trip._id }, { $set: { "itinerary.days.0.stops": [makeDay(1, ["node/1"]).stops[0]] } });
    const result = await edit({ type: "add", dayIndex: 1, attractionId: "node/4" });
    expect(result.status).toBe(422);
    const stored = await TripModel.findById(trip._id);
    expect(stored?.itinerary?.days[0].activities).toHaveLength(2);
    expect(stored?.itineraryVersion).toBe(3);
  });

  it("edits only scheduled attractions when generated route stops include unscheduled candidates", async () => {
    const { edit, trip } = await setup();
    await TripModel.updateOne({ _id: trip._id }, {
      $push: { "itinerary.days.0.stops": makeDay(1, ["node/4"]).stops[0] },
    });
    const result = await edit({ type: "reorder", dayIndex: 1, attractionIds: ["node/2", "node/1"] });
    expect(result.status).toBe(200);
    expect(stopIds(result.body.trip.itinerary.days[0])).toEqual(["node/2", "node/1"]);
  });

  it("searches saved candidates, marks scheduled results and discovers normalized deduplicated candidates", async () => {
    const { trip, agent, edit } = await setup();
    const search = (body: { search?: string; discover?: boolean }) => agent.post(`/api/trips/${trip.id}/itinerary/candidates`).set("Origin", env.WEB_ORIGIN).send(body);
    const saved = await search({ search: "Same display name" });
    expect(saved.status).toBe(200);
    expect(saved.body.candidates).toHaveLength(2);
    expect(saved.body.candidates[0].scheduledDayIndex).toBe(1);
    const discovered: TripAttraction = { ...pool[4], placeId: "node/9", lat: 48.856, name: "New museum" };
    vi.mocked(fetchAttractions).mockResolvedValue([pool[0], discovered, discovered, { ...discovered, lat: 999 }]);
    const more = await search({ discover: true });
    expect(more.status).toBe(200);
    expect(more.body.candidates.filter((candidate: { placeId: string }) => candidate.placeId === "node/9")).toHaveLength(1);
    expect((await TripModel.findById(trip._id))?.itineraryVersion).toBe(3);
    expect((await edit({ type: "add", dayIndex: 3, attractionId: "node/9" })).status).toBe(200);
    vi.mocked(fetchAttractions).mockResolvedValue(null);
    const fallback = await search({ discover: true });
    expect(fallback.body.warnings).toHaveLength(1);
    expect(fallback.body.candidates.length).toBeGreaterThan(0);
  });

  it("deduplicates simultaneous discoveries even when upstream metadata differs", async () => {
    const { trip, userId } = await setup();
    const { itineraryCandidates } = await import("../services/tripItineraryEditor.js");
    const candidate: TripAttraction = { ...pool[4], placeId: "node/9", lat: 48.856, name: "New museum" };
    const first = vi.fn(async () => [candidate]);
    const second = vi.fn(async () => [{ ...candidate, score: 99 }]);
    await Promise.all([
      itineraryCandidates(trip.id, userId, "", true, first),
      itineraryCandidates(trip.id, userId, "", true, second),
    ]);
    const saved = await TripModel.findById(trip._id);
    expect(saved?.attractions.filter((place) => place.placeId === "node/9")).toHaveLength(1);
    expect(saved?.itineraryVersion).toBe(3);
  });
});
