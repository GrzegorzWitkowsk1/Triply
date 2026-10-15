import type { FastifyInstance, FastifyReply } from "fastify";
import { Types } from "mongoose";
import { TripModel } from "../models/Trip.js";
import { currentTripOwner, ownerFilter } from "../middleware/tripIdentity.js";
import { findPublicTrip, hashShareToken, PUBLIC_TRIP_PROJECTION, toPublicTrip } from "./sharing.js";
import { PdfExportError, pdfFilename, renderTripPdf, reservePdfExport } from "../services/tripPdf.js";

function headers(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex, nofollow");
}
function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof PdfExportError) return reply.code(error.status).send({ error: error.message });
  return reply.code(500).send({ error: "Could not create the PDF. Please try again." });
}
export function registerPrivatePdfRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>("/trips/:id/export/pdf", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, onRequest: async (_req, reply) => { headers(reply); },
  }, async (req, reply) => {
    if (!Types.ObjectId.isValid(req.params.id)) return reply.code(404).send({ error: "Trip not found" });
    const trip = await TripModel.findOne({ _id: new Types.ObjectId(req.params.id), ...ownerFilter(currentTripOwner(req)) }).select(PUBLIC_TRIP_PROJECTION).exec();
    if (!trip) return reply.code(404).send({ error: "Trip not found" });
    let release: (() => void) | undefined;
    try {
      release = reservePdfExport(); const data = toPublicTrip(trip); const bytes = await renderTripPdf(data);
      return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="${pdfFilename(data)}"`).send(bytes);
    } catch (error) { return failure(error, reply); } finally { release?.(); }
  });
}
export function registerPublicPdfRoutes(app: FastifyInstance): void {
  app.get<{ Params: { shareToken: string } }>("/api/public/trips/:shareToken/export/pdf", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, onRequest: async (_req, reply) => { headers(reply); },
  }, async (req, reply) => {
    const token = req.params.shareToken;
    const trip = await findPublicTrip(token);
    if (!trip) return reply.code(404).send({ error: "Shared trip not found" });
    let release: (() => void) | undefined;
    try {
      release = reservePdfExport(); const data = toPublicTrip(trip); const bytes = await renderTripPdf(data);
      // Revalidate after asynchronous rendering: revocation/rotation during export wins.
      if (!await TripModel.exists({ _id: trip._id, "sharing.enabled": true, "sharing.tokenHash": hashShareToken(token) }))
        return reply.code(404).send({ error: "Shared trip not found" });
      return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="${pdfFilename(data)}"`).send(bytes);
    } catch (error) { return failure(error, reply); } finally { release?.(); }
  });
}
