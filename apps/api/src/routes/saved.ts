import type { FastifyInstance } from "fastify";
import { catalogDestinationSchema, destinationIdSchema, saveDestinationSchema } from "@triply/shared";
import { DestinationModel } from "../models/Destination.js";
import { currentSavedOwner as owner } from "../middleware/savedOwner.js";
import { SavedDestinationModel } from "../models/SavedDestination.js";

export function registerSavedRoutes(app: FastifyInstance): void {
  app.get("/saved/destinations", async req => {
    const rows = await SavedDestinationModel.find(owner(req)).sort({ createdAt: -1, _id: -1 }).lean().exec();
    const places = rows.length ? await DestinationModel.find({ id: { $in: rows.map(row => row.destinationId) } }).lean().exec() : [];
    const destinations = new Map(places.flatMap(place => {
      const parsed = catalogDestinationSchema.safeParse(place);
      return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
    }));
    return { destinations: rows.map(row => ({ destinationId: row.destinationId,
      createdAt: row.createdAt.toISOString(), destination: destinations.get(row.destinationId) ?? null })) };
  });
  app.get("/saved/destinations/status", async req => {
    const rows = await SavedDestinationModel.find(owner(req)).select("destinationId -_id").lean().exec();
    return { destinationIds: rows.map(row => row.destinationId) };
  });
  app.post("/saved/destinations", { bodyLimit: 1024 }, async (req, reply) => {
    const parsed = saveDestinationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_DESTINATION_ID", error: "Provide a canonical destination ID." });
    const { destinationId } = parsed.data;
    if (!catalogDestinationSchema.safeParse(await DestinationModel.findOne({ id: destinationId }).lean().exec()).success) return reply.code(404).send({ code: "DESTINATION_NOT_FOUND", error: "Destination is no longer available." });
    const filter = { ...owner(req), destinationId };
    try {
      await SavedDestinationModel.updateOne(filter, { $setOnInsert: { ...filter, createdAt: new Date() } }, { upsert: true }).exec();
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    }
    return { destinationId, saved: true };
  });
  app.delete<{ Params: { destinationId: string } }>("/saved/destinations/:destinationId", async (req, reply) => {
    const parsed = destinationIdSchema.safeParse(req.params.destinationId);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_DESTINATION_ID", error: "Provide a canonical destination ID." });
    await SavedDestinationModel.deleteOne({ ...owner(req), destinationId: parsed.data }).exec();
    return reply.code(204).send();
  });
}
