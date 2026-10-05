import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { Types } from "mongoose";
import {
  analyzeTripRequestSchema,
  updateTripRequirementsSchema,
  type AnalyzeTripRequest,
  type UpdateTripRequirements,
} from "@triply/shared";
import { analyzeTrip } from "../ai/analyzeTrip.js";
import { TripModel } from "../models/Trip.js";
import type { PublicUser } from "../models/User.js";
import {
  saveTripRequirements,
  toTripAnalysisResult,
  upsertTripDraft,
} from "../services/tripDraft.js";

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
    const analysis = await analyzeTrip({ prompt: request.prompt, badges: request.badges });

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