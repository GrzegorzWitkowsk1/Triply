import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { Types } from "mongoose";
import {
  analyzeTripRequestSchema,
  createTripEquipmentItemSchema,
  tripListQuerySchema,
  updateTripEquipmentItemSchema,
  updateTripRequirementsSchema,
  type AnalyzeTripRequest,
  type UpdateTripRequirements,
} from "@triply/shared";
import { aiService } from "../ai/index.js";
import { TripModel } from "../models/Trip.js";
import type { PublicUser } from "../models/User.js";
import {
  backfillTripAttractions,
  backfillTripWeather,
  saveTripRequirements,
  toTripAnalysisResult,
  toTripDetail,
  toTripSummary,
  upsertTripDraft,
} from "../services/tripDraft.js";
import {
  addEquipmentItem,
  deleteEquipmentItem,
  getEquipment,
  ITEM_NOT_FOUND,
  TRIP_NOT_FOUND,
  updateEquipmentItem,
} from "../services/equipment.js";

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

function currentUserId(res: Response): string {
  return (res.locals.user as PublicUser).id;
}

const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const user = res.locals.user as PublicUser | undefined;

    return user ? `user:${user.id}` : `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too many planning requests. Wait a few minutes and try again.",
    });
  },
});

export const tripsRouter = Router();

tripsRouter.post(
  "/analyze",
  aiLimiter,
  asyncHandler(async (req, res) => {
    const parsed = analyzeTripRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Describe your trip or pick at least one interest to get started.",
      });
      return;
    }

    const request: AnalyzeTripRequest = parsed.data;
    const analysis = await aiService.parseTrip({ prompt: request.prompt, badges: request.badges });

    const draft = await upsertTripDraft({
      userId: currentUserId(res),
      prompt: request.prompt,
      badges: request.badges,
      analysis,
    });

    res.json(toTripAnalysisResult(draft));
  }),
);

tripsRouter.patch(
  "/:id/requirements",
  asyncHandler(async (req, res) => {
    const rawId = req.params.id;
    const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";

    if (!Types.ObjectId.isValid(id)) {
      res.status(404).json({ error: "Trip draft not found" });
      return;
    }

    const parsed = updateTripRequirementsSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Some of the answers are not valid." });
      return;
    }

    const draft = await TripModel.findOne({
      _id: new Types.ObjectId(id),
      user: new Types.ObjectId(currentUserId(res)),
    }).exec();

    if (!draft) {
      res.status(404).json({ error: "Trip draft not found" });
      return;
    }

    const request: UpdateTripRequirements = parsed.data;
    const saved = await saveTripRequirements(
      draft,
      request.answers,
      request.confirmedFields,
    );

    res.json(toTripAnalysisResult(saved));
  }),
);

tripsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = tripListQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({ error: "That trip filter is not valid." });
      return;
    }

    const filter: { user: Types.ObjectId; status?: "draft" | "confirmed" } = {
      user: new Types.ObjectId(currentUserId(res)),
    };

    if (parsed.data.status) {
      filter.status = parsed.data.status;
    }

    const trips = await TripModel.find(filter).sort({ createdAt: -1 }).exec();

    res.json(trips.map((trip) => toTripSummary(trip)));
  }),
);

tripsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const rawId = req.params.id;
    const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";

    if (!Types.ObjectId.isValid(id)) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    const trip = await TripModel.findOne({
      _id: new Types.ObjectId(id),
      user: new Types.ObjectId(currentUserId(res)),
    }).exec();

    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    await backfillTripWeather(trip);
    await backfillTripAttractions(trip);

    res.json(toTripDetail(trip));
  }),
);

function tripIdParam(req: Request): string | null {
  const rawId = req.params.id;
  const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";

  return Types.ObjectId.isValid(id) ? id : null;
}

tripsRouter.get(
  "/:id/equipment",
  asyncHandler(async (req, res) => {
    const id = tripIdParam(req);

    if (!id) {
      res.status(404).json({ error: TRIP_NOT_FOUND });
      return;
    }

    const equipment = await getEquipment(id, currentUserId(res));

    res.json({ equipment });
  }),
);

tripsRouter.post(
  "/:id/equipment",
  asyncHandler(async (req, res) => {
    const id = tripIdParam(req);

    if (!id) {
      res.status(404).json({ error: TRIP_NOT_FOUND });
      return;
    }

    const parsed = createTripEquipmentItemSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Enter an item name and a count between 1 and 999." });
      return;
    }

    const item = await addEquipmentItem(id, currentUserId(res), parsed.data);

    res.status(201).json(item);
  }),
);

tripsRouter.patch(
  "/:id/equipment/:itemId",
  asyncHandler(async (req, res) => {
    const id = tripIdParam(req);

    if (!id) {
      res.status(404).json({ error: TRIP_NOT_FOUND });
      return;
    }

    const rawItemId = req.params.itemId;
    const itemId = (Array.isArray(rawItemId) ? rawItemId[0] : rawItemId) ?? "";

    if (!Types.ObjectId.isValid(itemId)) {
      res.status(404).json({ error: ITEM_NOT_FOUND });
      return;
    }

    const parsed = updateTripEquipmentItemSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid item name and count." });
      return;
    }

    const item = await updateEquipmentItem(id, currentUserId(res), itemId, parsed.data);

    res.json(item);
  }),
);

tripsRouter.delete(
  "/:id/equipment/:itemId",
  asyncHandler(async (req, res) => {
    const id = tripIdParam(req);

    if (!id) {
      res.status(404).json({ error: TRIP_NOT_FOUND });
      return;
    }

    const rawItemId = req.params.itemId;
    const itemId = (Array.isArray(rawItemId) ? rawItemId[0] : rawItemId) ?? "";

    if (!Types.ObjectId.isValid(itemId)) {
      res.status(404).json({ error: ITEM_NOT_FOUND });
      return;
    }

    await deleteEquipmentItem(id, currentUserId(res), itemId);

    res.status(204).send();
  }),
);
