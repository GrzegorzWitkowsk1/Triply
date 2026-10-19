import type { FastifyInstance } from "fastify";
import { attractionKeySchema, saveAttractionSchema, savedAttractionSnapshotSchema } from "@triply/shared";
import { currentSavedOwner } from "../middleware/savedOwner.js";
import { currentTripOwner, ownerFilter } from "../middleware/tripIdentity.js";
import { TripModel } from "../models/Trip.js";
import { SavedAttractionModel } from "../models/SavedAttraction.js";
import { savedAttractionIdentity, savedAttractionPlace } from "../services/savedAttractionIdentity.js";

export function registerSavedAttractionRoutes(app: FastifyInstance): void {
  app.get("/saved/attractions", async req => {
    const rows = await SavedAttractionModel.find(currentSavedOwner(req)).sort({ createdAt: -1, _id: -1 }).lean().exec();
    return { attractions: rows.map(row => ({ attractionKey: row.attractionKey, provider: row.provider,
      providerPlaceId: row.providerPlaceId, snapshot: row.snapshot, createdAt: row.createdAt.toISOString() })) };
  });
  app.get("/saved/attractions/status", async req => {
    const rows = await SavedAttractionModel.find(currentSavedOwner(req)).select("attractionKey -_id").lean().exec();
    return { attractionKeys: rows.map(row => row.attractionKey) };
  });
  app.post("/saved/attractions", { bodyLimit: 1024 }, async (req, reply) => {
    const parsed = saveAttractionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_ATTRACTION_REFERENCE", error: "Provide a trip and canonical attraction key." });
    const trip = await TripModel.findOne({ _id: parsed.data.tripId, ...ownerFilter(currentTripOwner(req)) }).exec();
    // Use the same response for missing, foreign, and stale references.
    const places = trip?.itinerary?.days.flatMap(day => day.stops).map(stop => savedAttractionPlace(stop, trip.attractions)) ?? [];
    const place = places.find(candidate => savedAttractionIdentity(candidate).attractionKey === parsed.data.attractionKey);
    if (!trip || !place) return reply.code(404).send({ code: "ATTRACTION_NOT_FOUND", error: "Attraction is no longer available in this trip." });
    const identity = savedAttractionIdentity(place);
    const snapshot = savedAttractionSnapshotSchema.safeParse({ name: place.name, category: place.category,
      coordinates: { lat: place.lat, lng: place.lng }, destinationName: trip.analysis.destination ?? undefined,
      country: trip.analysis.country ?? undefined, address: place.address?.slice(0, 1000), description: place.description?.slice(0, 2000) });
    if (!snapshot.success) return reply.code(400).send({ code: "INVALID_ATTRACTION_DATA", error: "This attraction has invalid saved-place data." });
    const filter = { ...currentSavedOwner(req), attractionKey: identity.attractionKey };
    try {
      await SavedAttractionModel.updateOne(filter, { $setOnInsert: { ...filter, ...identity, snapshot: snapshot.data, createdAt: new Date() } }, { upsert: true, runValidators: true }).exec();
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    }
    return { attractionKey: identity.attractionKey, saved: true };
  });
  app.delete<{ Params: { attractionKey: string } }>("/saved/attractions/:attractionKey", async (req, reply) => {
    const key = attractionKeySchema.safeParse(req.params.attractionKey);
    if (!key.success) return reply.code(400).send({ code: "INVALID_ATTRACTION_KEY", error: "Provide a canonical attraction key." });
    await SavedAttractionModel.deleteOne({ ...currentSavedOwner(req), attractionKey: key.data }).exec();
    return reply.code(204).send();
  });
}
