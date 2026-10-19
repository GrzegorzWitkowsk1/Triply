import { afterAll, beforeAll, expect, it } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { reserveGuestDraft } from "../services/guestLimits.js";
import { TripModel } from "../models/Trip.js";
import { SavedDestinationModel } from "../models/SavedDestination.js";
import { SavedAttractionModel } from "../models/SavedAttraction.js";

let mongo: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); app = await createApp(); }, 120_000);
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });
it("fails closed on a standalone database without partial ownership changes", async () => {
  const guest = await app.inject({ method: "POST", url: "/api/auth/guest", headers: { origin: env.WEB_ORIGIN } });
  const cookie = String(guest.headers["set-cookie"]).split(";")[0];
  await reserveGuestDraft(`guest:${guest.json().guest.id}`, "Paris", []);
  const owner = { ownerType: "guest", ownerId: guest.json().guest.id };
  await SavedDestinationModel.create({ ...owner, destinationId: "city-001" });
  await SavedAttractionModel.create({ ...owner, attractionKey: "osm:node:1", provider: "overpass", snapshot: { name: "Museum", category: "culture", coordinates: { lat: 1, lng: 2 } } });
  const before = await TripModel.collection.find({}).toArray();
  const registered = await app.inject({ method: "POST", url: "/api/auth/register", headers: { origin: env.WEB_ORIGIN, cookie }, payload: { email: "standalone@example.com", password: "Password123!Aa" } });
  expect(registered.statusCode).toBe(201);
  const authenticated = String(registered.headers["set-cookie"]).split(";")[0];
  for (let i = 0; i < 2; i++) {
    const result = await app.inject({ method: "POST", url: "/api/auth/guest-migration/confirm", headers: { origin: env.WEB_ORIGIN, cookie: authenticated } });
    expect(result.statusCode).toBe(503);
    expect(result.json().error).toContain("Your guest data is preserved");
    expect(await TripModel.collection.find({}).toArray()).toEqual(before);
    expect(await SavedDestinationModel.countDocuments(owner)).toBe(1);
    expect(await SavedAttractionModel.countDocuments(owner)).toBe(1);
  }
  const status = await app.inject({ url: "/api/auth/guest-migration/status", headers: { cookie: authenticated } });
  expect(status.json()).toMatchObject({ status: "pending", tripCount: 1, destinationCount: 1, attractionCount: 1 });
});
