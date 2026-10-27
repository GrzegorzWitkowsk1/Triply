import { exportLocaleQuerySchema } from "@triply/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { Types } from "mongoose";
import { TripModel } from "../models/Trip.js";
import { currentTripOwner, ownerFilter } from "../middleware/tripIdentity.js";
import { findPublicTrip, hashShareToken, PUBLIC_TRIP_PROJECTION, toPublicTrip } from "./sharing.js";
import { CalendarExportError, calendarFilename, renderTripCalendar } from "../services/tripCalendar.js";

const headers = async (_req: unknown, reply: FastifyReply) => { reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex, nofollow"); };
const options = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, onRequest: headers };
function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof CalendarExportError) return reply.code(error.status).send({ error: error.message, code: error.code });
  return reply.code(500).send({ error: "Could not create the calendar. Please try again.", code: "export-failed" });
}
function send(reply: FastifyReply, result: Awaited<ReturnType<typeof renderTripCalendar>>, filename: string) {
  reply.header("X-Triply-Calendar-Events", result.stats.exported).header("X-Triply-Calendar-Excluded", result.stats.excluded)
    .header("X-Triply-Calendar-Unscheduled", result.stats.unscheduled).header("X-Triply-Calendar-Invalid", result.stats.invalid);
  return reply.type("text/calendar; charset=utf-8").header("Content-Disposition", `attachment; filename="${filename}"`).send(result.content);
}
export function registerPrivateCalendarRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>("/trips/:id/export/calendar", options, async (req, reply) => {
    const parsed = exportLocaleQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_LOCALE", error: "Use export locale en or pl." });
    const locale = parsed.data.locale;
    if (!Types.ObjectId.isValid(req.params.id)) return reply.code(404).send({ error: "Trip not found" });
    const trip = await TripModel.findOne({ _id: new Types.ObjectId(req.params.id), ...ownerFilter(currentTripOwner(req)) }).select(PUBLIC_TRIP_PROJECTION).exec();
    if (!trip) return reply.code(404).send({ error: "Trip not found" });
    try { const data = toPublicTrip(trip, { calendarMetadata: true }); return send(reply.header("Content-Language", locale), await renderTripCalendar(data, undefined, locale), calendarFilename(data)); }
    catch (error) { return failure(error, reply); }
  });
}
export function registerPublicCalendarRoutes(app: FastifyInstance): void {
  app.get<{ Params: { shareToken: string } }>("/api/public/trips/:shareToken/export/calendar", options, async (req, reply) => {
    const parsed = exportLocaleQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_LOCALE", error: "Use export locale en or pl." });
    const locale = parsed.data.locale;
    const token = req.params.shareToken, trip = await findPublicTrip(token);
    if (!trip) return reply.code(404).send({ error: "Shared trip not found" });
    try {
      const data = toPublicTrip(trip, { calendarMetadata: true }), result = await renderTripCalendar(data, undefined, locale);
      if (!await TripModel.exists({ _id: trip._id, "sharing.enabled": true, "sharing.tokenHash": hashShareToken(token) }))
        return reply.code(404).send({ error: "Shared trip not found" });
      return send(reply.header("Content-Language", locale), result, calendarFilename(data));
    } catch (error) { return failure(error, reply); }
  });
}
