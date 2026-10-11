import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { Types } from "mongoose";
import {
  analyzeTripRequestSchema,
  applyRegenerationRequestSchema,
  createTripEquipmentItemSchema,
  regenerateDayRequestSchema,
  tripListQuerySchema,
  updateTripEquipmentItemSchema,
  updateTripRequirementsSchema,
  type AnalyzeTripRequest,
  type RegenerationPreferences,
  type TripStatus,
  type UpdateTripRequirements,
} from "@triply/shared";
import { aiService } from "../ai/index.js";
import { assistantMessageRequestSchema } from "@triply/shared";
import { cancelAssistantAction, confirmAssistantEdit, getAssistantConversation, recordAssistantRegeneration, sendAssistantMessage } from "../services/tripAssistantService.js";
import { itineraryCandidatesRequestSchema, itineraryEditRequestSchema } from "@triply/shared";
import { editTripItinerary, itineraryCandidates, ItineraryEditError } from "../services/tripItineraryEditor.js";
import { TripModel } from "../models/Trip.js";
import type { PublicUser } from "../models/User.js";
import {
  backfillTripAttractions,
  backfillTripWeather,
  confirmTripRequirements,
  saveTripRequirements,
  toTripAnalysisResult,
  toTripDetail,
  toTripSummary,
  TripRequirementsIncompleteError,
  upsertTripDraft,
} from "../services/tripDraft.js";
import {
  claimTripForGeneration,
  GENERIC_GENERATION_ERROR,
  GenerationSupersededError,
  GenerationUnavailableError,
  generationInputsReady,
  logGenerationFailure,
  markGenerationFailed,
  runTripGeneration,
} from "../services/tripGeneration.js";
import {
  addEquipmentItem,
  deleteEquipmentItem,
  getEquipment,
  ITEM_NOT_FOUND,
  TRIP_NOT_FOUND,
  updateEquipmentItem,
} from "../services/equipment.js";
import {
  applyDayRegeneration,
  createDayRegenerationPreview,
  NoSuitableAlternativesError,
  RegenerationConflictError,
  RegenerationNotFoundError,
  TripDayNotFoundError,
} from "../services/tripRegeneration.js";

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

tripsRouter.get(["/:id/assistant/conversations", "/:id/assistant/conversations/:conversationId"], asyncHandler(async (req, res) => {
  try {
    res.json(await getAssistantConversation(tripIdParam(req) ?? "", currentUserId(res), typeof req.params.conversationId === "string" ? req.params.conversationId : undefined));
  } catch (error) {
    if (!(error instanceof ItineraryEditError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
}));
tripsRouter.post("/:id/assistant/messages", aiLimiter, asyncHandler(async (req, res) => {
  const parsed = assistantMessageRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter a message of 1–2000 characters and valid conversation/day identifiers." }); return; }
  try { res.json(await sendAssistantMessage(tripIdParam(req) ?? "", currentUserId(res), parsed.data)); }
  catch (error) {
    if (!(error instanceof ItineraryEditError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
}));
tripsRouter.post("/:id/assistant/actions/:previewId/apply", asyncHandler(async (req, res) => {
  const previewId = req.params.previewId;
  if (typeof previewId !== "string" || !/^[a-f\d-]{36}$/i.test(previewId)) { res.status(400).json({ error: "Invalid preview" }); return; }
  try { const result = await confirmAssistantEdit(tripIdParam(req) ?? "", currentUserId(res), previewId); res.json({ ...result, trip: toTripDetail(result.trip) }); }
  catch (error) {
    if (!(error instanceof ItineraryEditError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
}));
tripsRouter.delete("/:id/assistant/actions/:previewId", asyncHandler(async (req, res) => {
  const previewId = req.params.previewId;
  if (typeof previewId !== "string" || !/^[a-f\d-]{36}$/i.test(previewId)) { res.status(400).json({ error: "Invalid preview" }); return; }
  try { await cancelAssistantAction(tripIdParam(req) ?? "", currentUserId(res), previewId); res.status(204).end(); }
  catch (error) {
    if (!(error instanceof ItineraryEditError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
}));

tripsRouter.post("/:id/itinerary/edit", asyncHandler(async (req, res) => {
  const parsed = itineraryEditRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid edit operation" });
    return;
  }
  try {
    const result = await editTripItinerary(tripIdParam(req) ?? "", currentUserId(res), parsed.data);
    res.json({ ...result, trip: toTripDetail(result.trip) });
  } catch (error) {
    if (!(error instanceof ItineraryEditError)) throw error;
    res.status(error.status).json({ error: error.message, warnings: error.warnings, conflicts: error.conflicts });
  }
}));

tripsRouter.post("/:id/itinerary/candidates", aiLimiter, asyncHandler(async (req, res) => {
  const parsed = itineraryCandidatesRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid attraction search" });
    return;
  }
  try {
    res.json(await itineraryCandidates(tripIdParam(req) ?? "", currentUserId(res), parsed.data.search, parsed.data.discover));
  } catch (error) {
    if (!(error instanceof ItineraryEditError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
}));

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

    if (draft.status !== "draft" && draft.status !== "failed" && !(draft.status === "ready" && parsed.data.regenerate)) {
      res.status(409).json({ error: "Requirements can only be edited before itinerary generation." });
      return;
    }

    const request: UpdateTripRequirements = parsed.data;
    const saved = await saveTripRequirements(
      draft,
      request.answers,
      request.confirmedFields,
      request.regenerate === true,
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

    const filter: { user: Types.ObjectId; status?: TripStatus } = {
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

    if (trip.status === "draft" || trip.status === "ready") {
      await backfillTripWeather(trip);
      await backfillTripAttractions(trip);
    }

    res.json(toTripDetail(trip));
  }),
);

function tripIdParam(req: Request): string | null {
  const rawId = req.params.id;
  const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";

  return Types.ObjectId.isValid(id) ? id : null;
}

function dayIndexParam(req: Request): number | null {
  const raw = req.params.dayId;
  const value = ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim();

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const dayIndex = Number.parseInt(value, 10);

  return dayIndex >= 1 ? dayIndex : null;
}

function mergePreferences(
  selected: RegenerationPreferences,
  interpreted: RegenerationPreferences,
): RegenerationPreferences {
  return {
    lessWalking: selected.lessWalking || interpreted.lessWalking,
    moreFood: selected.moreFood || interpreted.moreFood,
    relaxedPace: selected.relaxedPace || interpreted.relaxedPace,
    preferIndoor: selected.preferIndoor || interpreted.preferIndoor,
    surpriseMe: selected.surpriseMe || interpreted.surpriseMe,
  };
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

tripsRouter.post(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const id = tripIdParam(req);

    if (!id) {
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

    try {
      const saved = await confirmTripRequirements(trip);
      res.json(toTripDetail(saved));
    } catch (error) {
      if (error instanceof TripRequirementsIncompleteError) {
        res.status(400).json({
          error: "A few trip details are still missing.",
          missingFields: error.missing,
        });
        return;
      }

      throw error;
    }
  }),
);

tripsRouter.post(
  "/:id/generate",
  asyncHandler(async (req, res) => {
    const id = tripIdParam(req);

    if (!id) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    const userId = currentUserId(res);

    const existing = await TripModel.findOne({
      _id: new Types.ObjectId(id),
      user: new Types.ObjectId(userId),
    }).exec();

    if (!existing) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    if (existing.status === "ready" && existing.itinerary) {
      res.json(toTripDetail(existing));
      return;
    }

    if (!generationInputsReady(existing)) {
      res
        .status(400)
        .json({ error: "Add a destination and trip length before generating an itinerary." });
      return;
    }

    const claimed = await claimTripForGeneration(id, userId);

    if (!claimed) {
      res.status(409).json({
        error: "This itinerary is already being generated. Please wait for it to finish.",
      });
      return;
    }

    try {
      const generated = await runTripGeneration(claimed);
      res.json(toTripDetail(generated));
    } catch (error) {
      if (error instanceof GenerationSupersededError) {
        res.status(409).json({ error: "This itinerary is being generated by another request." });
        return;
      }
      logGenerationFailure(error);
      const message = error instanceof GenerationUnavailableError ? error.message : GENERIC_GENERATION_ERROR;
      const marked = await markGenerationFailed(id, userId, message, claimed.generation.startedAt);
      res.status(marked ? 502 : 409).json({
        error: marked ? message : "This itinerary is being generated by another request.",
      });
    }
  }),
);

tripsRouter.post(
  "/:id/days/:dayId/regenerate",
  aiLimiter,
  asyncHandler(async (req, res) => {
    const id = tripIdParam(req);

    if (!id) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    const dayIndex = dayIndexParam(req);

    if (dayIndex === null) {
      res.status(404).json({ error: "Day not found" });
      return;
    }

    const parsed = regenerateDayRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error:
          parsed.error.issues[0]?.message ??
          "Choose at least one preference or describe what you'd like to change.",
      });
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

    if (!trip.itinerary) {
      res.status(400).json({ error: "Generate the itinerary before regenerating a day." });
      return;
    }

    const customInstructions = parsed.data.customInstructions?.trim() ?? "";
    let preferences = parsed.data.preferences;
    let customInstructionWarning: string | null = null;

    if (customInstructions.length > 0) {
      try {
        const interpreted = await aiService.parseRegeneration({
          customInstructions,
          selectedPreferences: parsed.data.preferences,
        });
        preferences = mergePreferences(parsed.data.preferences, interpreted);
      } catch {
        customInstructionWarning =
          "We couldn't interpret your custom instructions, so we used your selected preferences.";
      }
    }

    try {
      const preview = await createDayRegenerationPreview({
        trip,
        dayIndex,
        preferences,
        customInstructions,
        variation: parsed.data.variation ?? 0,
        customInstructionWarning,
      });

      res.json(preview);
    } catch (error) {
      if (error instanceof TripDayNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }

      if (error instanceof NoSuitableAlternativesError) {
        res.status(422).json({ error: error.message, warnings: error.warnings });
        return;
      }

      if (error instanceof RegenerationConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }

      throw error;
    }
  }),
);

tripsRouter.post(
  "/:id/days/:dayId/apply",
  asyncHandler(async (req, res) => {
    const id = tripIdParam(req);

    if (!id) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    const dayIndex = dayIndexParam(req);

    if (dayIndex === null) {
      res.status(404).json({ error: "Day not found" });
      return;
    }

    const parsed = applyRegenerationRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "A valid preview is required to apply changes." });
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

    try {
      const updated = await applyDayRegeneration(trip, parsed.data.previewId, dayIndex);
      await recordAssistantRegeneration(id, currentUserId(res)).catch(() => { console.warn("[assistant] Applied regeneration; conversation confirmation could not be saved."); });
      res.json(toTripDetail(updated));
    } catch (error) {
      if (error instanceof RegenerationNotFoundError) {
        res.status(410).json({ error: error.message });
        return;
      }

      if (error instanceof RegenerationConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }

      throw error;
    }
  }),
);
