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
import { TripAssistantConversationModel } from "../models/TripAssistantConversation.js";
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

const assistantIntent = { intent: "edit_itinerary", question: "schedule", day: "day 1", targetDay: null,
  attraction: "node/1", replacement: null, before: null, operation: "remove", multipleActions: false,
  preferences: { lessWalking: false, moreFood: false, relaxedPace: false, preferIndoor: false, surpriseMe: false } };

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
  it("assistant confirms literal expenses once, answers budget questions and proposes moves/deletes", async () => {
    const { agent, trip } = await setup(); const base = `/api/trips/${trip.id}`;
    const send = (message: string) => agent.post(`${base}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send({ message });
    const proposed = await send("Record €18 for drinks");
    expect(proposed.body.response.actionType).toBe("expense"); expect((await TripModel.findById(trip._id))?.expenses).toHaveLength(0);
    const apply = (id: string) => agent.post(`${base}/assistant/actions/${id}/apply`).set("Origin", env.WEB_ORIGIN).send({});
    expect((await apply(proposed.body.response.previewId)).body.trip.budgetData.summary.actualSpendingMinor).toBe(1800);
    expect((await apply(proposed.body.response.previewId)).status).toBe(410);
    expect((await send("How much have I actually spent on food?")).body.response.message).toContain("€18.00");
    const move = await send("Move my drinks expense to day 3");
    expect((await apply(move.body.response.previewId)).body.trip.budgetData.expenses[0].dayId).toBe("3");
    const deletion = await send("Delete the drinks expense");
    expect((await apply(deletion.body.response.previewId)).body.trip.budgetData.expenses).toHaveLength(0);
    expect(assistantMock.generate).not.toHaveBeenCalled();
  });
  it("rejects stale assistant expense confirmations and keeps canceled proposals inert", async () => {
    const { agent, trip } = await setup(); const base = `/api/trips/${trip.id}`;
    const send = () => agent.post(`${base}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Add €25 for lunch on day 2" });
    const proposed = await send();
    await agent.post(`${base}/expenses`).set("Origin", env.WEB_ORIGIN).send({ expense: input(), requestId: randomUUID(), expectedRevision: 0 });
    expect((await agent.post(`${base}/assistant/actions/${proposed.body.response.previewId}/apply`).set("Origin", env.WEB_ORIGIN).send({})).status).toBe(409);
    const second = await send();
    await agent.delete(`${base}/assistant/actions/${second.body.response.previewId}`).set("Origin", env.WEB_ORIGIN);
    expect((await agent.post(`${base}/assistant/actions/${second.body.response.previewId}/apply`).set("Origin", env.WEB_ORIGIN).send({})).status).toBe(410);
    expect((await TripModel.findById(trip._id))?.expenses).toHaveLength(1);
  });
});
describe("assistant HTTP integration and confirmation", () => {
  it("invalidates canceled previews on the server", async () => {
    const { agent, trip } = await setup();
    assistantMock.generate.mockResolvedValue(assistantIntent);
    const response = await agent.post(`/api/trips/${trip.id}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Remove the first attraction" });
    const base = `/api/trips/${trip.id}/assistant/actions/${response.body.response.previewId}`;
    expect((await agent.delete(base).set("Origin", env.WEB_ORIGIN)).status).toBe(204);
    expect((await agent.post(`${base}/apply`).set("Origin", env.WEB_ORIGIN).send({})).status).toBe(410);
    expect((await TripModel.findById(trip._id))?.itineraryVersion).toBe(3);
  });
  it("persists history, previews without mutation, applies explicitly and rejects duplicate confirmation", async () => {
    const { agent, trip } = await setup();
    assistantMock.generate.mockResolvedValue(assistantIntent);
    const response = await agent.post(`/api/trips/${trip.id}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Remove the first attraction", selectedDayId: "1" });
    expect(response.status).toBe(200);
    expect(response.body.response.type).toBe("action_preview");
    const unchanged = await TripModel.findById(trip._id);
    expect(unchanged?.itineraryVersion).toBe(3);
    expect(unchanged?.itinerary?.days[0].activities).toHaveLength(2);
    const history = await agent.get(`/api/trips/${trip.id}/assistant/conversations/${response.body.conversationId}`);
    expect(history.status).toBe(200);
    expect(history.body.messages).toHaveLength(2);
    const url = `/api/trips/${trip.id}/assistant/actions/${response.body.response.previewId}/apply`;
    const applied = await agent.post(url).set("Origin", env.WEB_ORIGIN).send({});
    expect(applied.status).toBe(200);
    expect(applied.body.itineraryVersion).toBe(4);
    expect((applied.body.trip.itinerary.days[0] as ItineraryDay).activities.filter(activity => activity.type === "attraction")).toHaveLength(1);
    expect((await agent.post(url).set("Origin", env.WEB_ORIGIN).send({})).status).toBe(410);
    expect((await agent.get(`/api/trips/${trip.id}/assistant/conversations`)).body.messages.at(-1).text).toContain("Confirmed");
  });
  it("rejects stale versions, expiry and arbitrary client operations", async () => {
    const { agent, trip } = await setup();
    assistantMock.generate.mockResolvedValue(assistantIntent);
    const response = await agent.post(`/api/trips/${trip.id}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Remove the first attraction" });
    await TripModel.updateOne({ _id: trip._id }, { $inc: { itineraryVersion: 1 } });
    const url = `/api/trips/${trip.id}/assistant/actions/${response.body.response.previewId}/apply`;
    expect((await agent.post(url).set("Origin", env.WEB_ORIGIN).send({ operation: { type: "remove", dayIndex: 2, attractionId: "node/3" } })).status).toBe(409);
    const fresh = await agent.post(`/api/trips/${trip.id}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Prepare the removal again" });
    await TripAssistantConversationModel.updateOne({ tripId: trip._id }, { $set: { "prepared.expiresAt": new Date(0) } });
    expect((await agent.post(`/api/trips/${trip.id}/assistant/actions/${fresh.body.response.previewId}/apply`).set("Origin", env.WEB_ORIGIN).send({})).status).toBe(410);
    expect((await TripModel.findById(trip._id))?.itinerary?.days[1].activities).toHaveLength(1);
  });
  it("isolates conversations across users and trips and handles deleted trips", async () => {
    const { agent, trip } = await setup();
    const history = await agent.get(`/api/trips/${trip.id}/assistant/conversations`);
    const other = request.agent(app.server);
    await other.post("/api/auth/register").set("Origin", env.WEB_ORIGIN).send({ email: "other-assistant@example.com", password: "Password123!Aa" });
    const url = `/api/trips/${trip.id}/assistant/conversations/${history.body.conversationId}`;
    expect((await request(app.server).get(url)).status).toBe(401);
    expect((await other.get(url)).status).toBe(404);
    const copy = trip.toObject();
    const second = await TripModel.create({ ...copy, _id: new mongoose.Types.ObjectId() });
    expect((await agent.get(`/api/trips/${second.id}/assistant/conversations/${history.body.conversationId}`)).status).toBe(404);
    await TripModel.deleteOne({ _id: trip._id });
    expect((await agent.get(url)).status).toBe(404);
  });
  it("validates message size and prepares candidate selections from the existing pool", async () => {
    const { agent, trip } = await setup();
    expect((await agent.post(`/api/trips/${trip.id}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "a".repeat(2001) })).status).toBe(400);
    assistantMock.generate.mockResolvedValue({ ...assistantIntent, operation: "add", attraction: "restaurant" });
    const response = await agent.post(`/api/trips/${trip.id}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Add a restaurant to day 1" });
    expect(response.body.response.picker.dayIndex).toBe(1);
    const selected = await agent.post(`/api/trips/${trip.id}/assistant/messages`).set("Origin", env.WEB_ORIGIN).send({ message: "Use selected attraction", conversationId: response.body.conversationId, candidate: { attractionId: "node/4", position: 0 } });
    expect(selected.body.response.type).toBe("action_preview");
    expect(selected.body.response.days[0].activities[0].placeId).toBe("node/4");
    expect((await TripModel.findById(trip._id))?.itineraryVersion).toBe(3);
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
    expect((await TripModel.findById(trip._id))?.user.toString()).toBe(userId);
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
