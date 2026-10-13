import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type { HttpRoute, HttpRequest } from "../http/types.js";
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
import { recoverTripDestination, validateGenerationRequirements } from "../services/tripDestination.js";
import { refreshTripWeather, toWeatherRefresh } from "../services/tripWeather.js";
import { registerExpenseRoutes } from "./expenses.js";
import { currentUserId } from "../middleware/auth.js";
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

export function registerTripRoutes(app: FastifyInstance, aiLimiter: preHandlerAsyncHookHandler): void {
  registerExpenseRoutes(app);

  for (const path of ["/trips/:id/assistant/conversations", "/trips/:id/assistant/conversations/:conversationId"]) app.get<HttpRoute>(path, async (req, res) => {
    try {
      return res.send(await getAssistantConversation(tripIdParam(req) ?? "", currentUserId(req), typeof req.params.conversationId === "string" ? req.params.conversationId : undefined));
    } catch (error) {
      if (!(error instanceof ItineraryEditError)) throw error;
      return res.code(error.status).send({ error: error.message });
    }
  });
  app.post<HttpRoute>("/trips/:id/assistant/messages", { preHandler: aiLimiter },
    async (req, res) => {
    const parsed = assistantMessageRequestSchema.safeParse(req.body);
    if (!parsed.success) { return res.code(400).send({ error: "Enter a message of 1–2000 characters and valid conversation/day identifiers." }); }
    try { return res.send(await sendAssistantMessage(tripIdParam(req) ?? "", currentUserId(req), parsed.data)); }
    catch (error) {
      if (!(error instanceof ItineraryEditError)) throw error;
      return res.code(error.status).send({ error: error.message });
    }
  });
  app.post<HttpRoute>("/trips/:id/assistant/actions/:previewId/apply", async (req, res) => {
    const previewId = req.params.previewId;
    if (typeof previewId !== "string" || !/^[a-f\d-]{36}$/i.test(previewId)) { return res.code(400).send({ error: "Invalid preview" }); }
    try { const result = await confirmAssistantEdit(tripIdParam(req) ?? "", currentUserId(req), previewId); return res.send({ ...result, trip: toTripDetail(result.trip) }); }
    catch (error) {
      if (!(error instanceof ItineraryEditError)) throw error;
      return res.code(error.status).send({ error: error.message });
    }
  });
  app.delete<HttpRoute>("/trips/:id/assistant/actions/:previewId", async (req, res) => {
    const previewId = req.params.previewId;
    if (typeof previewId !== "string" || !/^[a-f\d-]{36}$/i.test(previewId)) { return res.code(400).send({ error: "Invalid preview" }); }
    try { await cancelAssistantAction(tripIdParam(req) ?? "", currentUserId(req), previewId); return res.code(204).send(); }
    catch (error) {
      if (!(error instanceof ItineraryEditError)) throw error;
      return res.code(error.status).send({ error: error.message });
    }
  });

  app.post<HttpRoute>("/trips/:id/itinerary/edit", async (req, res) => {
    const parsed = itineraryEditRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid edit operation" });
    }
    try {
      const result = await editTripItinerary(tripIdParam(req) ?? "", currentUserId(req), parsed.data);
      return res.send({ ...result, trip: toTripDetail(result.trip) });
    } catch (error) {
      if (!(error instanceof ItineraryEditError)) throw error;
      return res.code(error.status).send({ error: error.message, warnings: error.warnings, conflicts: error.conflicts, issues: error.issues });
    }
  });

  app.post<HttpRoute>("/trips/:id/itinerary/candidates", { preHandler: aiLimiter },
    async (req, res) => {
    const parsed = itineraryCandidatesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.code(400).send({ error: "Invalid attraction search" });
    }
    try {
      return res.send(await itineraryCandidates(tripIdParam(req) ?? "", currentUserId(req), parsed.data.search, parsed.data.discover));
    } catch (error) {
      if (!(error instanceof ItineraryEditError)) throw error;
      return res.code(error.status).send({ error: error.message });
    }
  });

  app.post<HttpRoute>(
    "/trips/analyze",
    { preHandler: aiLimiter },
    async (req, res) => {
      const parsed = analyzeTripRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.code(400).send({
          error: "Describe your trip or pick at least one interest to get started.",
        });
      }

      const request: AnalyzeTripRequest = parsed.data;
      const analysis = await aiService.parseTrip({ prompt: request.prompt, badges: request.badges });

      const draft = await upsertTripDraft({
        userId: currentUserId(req),
        prompt: request.prompt,
        badges: request.badges,
        analysis,
      });

      return res.send(toTripAnalysisResult(draft));
    },
  );

  app.patch<HttpRoute>(
    "/trips/:id/requirements",
    async (req, res) => {
      const rawId = req.params.id;
      const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";

      if (!Types.ObjectId.isValid(id)) {
        return res.code(404).send({ error: "Trip draft not found" });
      }

      const parsed = updateTripRequirementsSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.code(400).send({ error: "Some of the answers are not valid." });
      }

      const draft = await TripModel.findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(currentUserId(req)),
      }).exec();

      if (!draft) {
        return res.code(404).send({ error: "Trip draft not found" });
      }

      if (draft.status !== "draft" && draft.status !== "failed" && !(draft.status === "ready" && parsed.data.regenerate)) {
        return res.code(409).send({ error: "Requirements can only be edited before itinerary generation." });
      }

      const request: UpdateTripRequirements = parsed.data;
      const saved = await saveTripRequirements(
        draft,
        request.answers,
        request.confirmedFields,
        request.regenerate === true,
      );

      return res.send(toTripAnalysisResult(saved));
    },
  );

  app.get<HttpRoute>(
    "/trips",
    async (req, res) => {
      const parsed = tripListQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        return res.code(400).send({ error: "That trip filter is not valid." });
      }

      const filter: { user: Types.ObjectId; status?: TripStatus } = {
        user: new Types.ObjectId(currentUserId(req)),
      };

      if (parsed.data.status) {
        filter.status = parsed.data.status;
      }

      const trips = await TripModel.find(filter).sort({ createdAt: -1 }).exec();

      return res.send(trips.map((trip) => toTripSummary(trip)));
    },
  );

  app.get<HttpRoute>(
    "/trips/:id",
    async (req, res) => {
      const rawId = req.params.id;
      const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";

      if (!Types.ObjectId.isValid(id)) {
        return res.code(404).send({ error: "Trip not found" });
      }

      const trip = await TripModel.findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(currentUserId(req)),
      }).exec();

      if (!trip) {
        return res.code(404).send({ error: "Trip not found" });
      }

      if (trip.status === "draft" || trip.status === "ready") {
        await backfillTripWeather(trip);
        await backfillTripAttractions(trip);
      }

      return res.send(toTripDetail(trip));
    },
  );

  app.post<HttpRoute>(
    "/trips/:id/weather/refresh",
    async (req, res) => {
      const id = tripIdParam(req);
      if (!id) { return res.code(404).send({ error: "Trip not found" }); }
      const trip = await TripModel.findOne({ _id: new Types.ObjectId(id), user: new Types.ObjectId(currentUserId(req)) }).exec();
      if (!trip) { return res.code(404).send({ error: "Trip not found" }); }
      const controller = new AbortController();
      const cancel = () => { if (!res.raw.writableEnded) controller.abort(); };
      res.raw.on("close", cancel);
      console.info({ event: "weather-refresh", provider: "open-meteo", stage: "requested", tripId: id });
      try {
        const saved = await refreshTripWeather(trip, { force: true, signal: controller.signal });
        const result = toWeatherRefresh(saved);
        const failed = result.weatherAvailability.reason && ["timeout", "network", "http_error", "invalid_response"].includes(result.weatherAvailability.reason);
        console.info({ event: "weather-refresh", provider: "open-meteo", stage: !failed && result.weather.length ? "succeeded" : "failed", code: result.weatherAvailability.status, reason: result.weatherAvailability.reason, tripId: id });
        return res.send(result);
      } catch (error) {
        console.info({ event: "weather-refresh", provider: "open-meteo", stage: "failed", code: controller.signal.aborted ? "cancelled" : "refresh_error", tripId: id });
        if (!controller.signal.aborted) throw error;
      } finally { res.raw.off("close", cancel); }
    },
  );

  function tripIdParam(req: HttpRequest): string | null {
    const rawId = req.params.id;
    const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";

    return Types.ObjectId.isValid(id) ? id : null;
  }

  function dayIndexParam(req: HttpRequest): number | null {
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

  app.get<HttpRoute>(
    "/trips/:id/equipment",
    async (req, res) => {
      const id = tripIdParam(req);

      if (!id) {
        return res.code(404).send({ error: TRIP_NOT_FOUND });
      }

      const equipment = await getEquipment(id, currentUserId(req));

      return res.send({ equipment });
    },
  );

  app.post<HttpRoute>(
    "/trips/:id/equipment",
    async (req, res) => {
      const id = tripIdParam(req);

      if (!id) {
        return res.code(404).send({ error: TRIP_NOT_FOUND });
      }

      const parsed = createTripEquipmentItemSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.code(400).send({ error: "Enter an item name and a count between 1 and 999." });
      }

      const item = await addEquipmentItem(id, currentUserId(req), parsed.data);

      return res.code(201).send(item);
    },
  );

  app.patch<HttpRoute>(
    "/trips/:id/equipment/:itemId",
    async (req, res) => {
      const id = tripIdParam(req);

      if (!id) {
        return res.code(404).send({ error: TRIP_NOT_FOUND });
      }

      const rawItemId = req.params.itemId;
      const itemId = (Array.isArray(rawItemId) ? rawItemId[0] : rawItemId) ?? "";

      if (!Types.ObjectId.isValid(itemId)) {
        return res.code(404).send({ error: ITEM_NOT_FOUND });
      }

      const parsed = updateTripEquipmentItemSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.code(400).send({ error: "Enter a valid item name and count." });
      }

      const item = await updateEquipmentItem(id, currentUserId(req), itemId, parsed.data);

      return res.send(item);
    },
  );

  app.delete<HttpRoute>(
    "/trips/:id/equipment/:itemId",
    async (req, res) => {
      const id = tripIdParam(req);

      if (!id) {
        return res.code(404).send({ error: TRIP_NOT_FOUND });
      }

      const rawItemId = req.params.itemId;
      const itemId = (Array.isArray(rawItemId) ? rawItemId[0] : rawItemId) ?? "";

      if (!Types.ObjectId.isValid(itemId)) {
        return res.code(404).send({ error: ITEM_NOT_FOUND });
      }

      await deleteEquipmentItem(id, currentUserId(req), itemId);

      return res.code(204).send();
    },
  );

  app.post<HttpRoute>(
    "/trips/:id/confirm",
    async (req, res) => {
      const id = tripIdParam(req);

      if (!id) {
        return res.code(404).send({ error: "Trip not found" });
      }

      const trip = await TripModel.findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(currentUserId(req)),
      }).exec();

      if (!trip) {
        return res.code(404).send({ error: "Trip not found" });
      }

      try {
        const saved = await confirmTripRequirements(trip);
        return res.send(toTripDetail(saved));
      } catch (error) {
        if (error instanceof TripRequirementsIncompleteError) {
          return res.code(400).send({
            error: "A few trip details are still missing.",
            missingFields: error.missing,
          });
        }

        throw error;
      }
    },
  );

  app.post<HttpRoute>(
    "/trips/:id/generate",
    async (req, res) => {
      const id = tripIdParam(req);

      if (!id) {
        return res.code(404).send({ error: "Trip not found" });
      }

      const userId = currentUserId(req);

      const existing = await TripModel.findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(userId),
      }).exec();

      if (!existing) {
        return res.code(404).send({ error: "Trip not found" });
      }

      if (existing.status === "ready" && existing.itinerary) {
        return res.send(toTripDetail(existing));
        return;
      }

      validateGenerationRequirements(existing);
      const resolved = await recoverTripDestination(existing);
      // Validate the fresh snapshot too if another process completed recovery.
      validateGenerationRequirements(resolved);
      const claimed = await claimTripForGeneration(id, userId, resolved.updatedAt);

      if (!claimed) {
        return res.code(409).send({
          error: "The trip changed or its itinerary is already being generated. Reload it and try again.",
        });
      }

      try {
        const generated = await runTripGeneration(claimed);
        return res.send(toTripDetail(generated));
      } catch (error) {
        if (error instanceof GenerationSupersededError) {
          return res.code(409).send({ error: "This itinerary is being generated by another request." });
        }
        logGenerationFailure(error);
        const message = error instanceof GenerationUnavailableError ? error.message : GENERIC_GENERATION_ERROR;
        const marked = await markGenerationFailed(id, userId, message, claimed.generation.startedAt);
        return res.code(marked ? 502 : 409).send({
          error: marked ? message : "This itinerary is being generated by another request.",
        });
      }
    },
  );

  app.post<HttpRoute>(
    "/trips/:id/days/:dayId/regenerate",
    { preHandler: aiLimiter },
    async (req, res) => {
      const id = tripIdParam(req);

      if (!id) {
        return res.code(404).send({ error: "Trip not found" });
      }

      const dayIndex = dayIndexParam(req);

      if (dayIndex === null) {
        return res.code(404).send({ error: "Day not found" });
      }

      const parsed = regenerateDayRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.code(400).send({
          error:
            parsed.error.issues[0]?.message ??
            "Choose at least one preference or describe what you'd like to change.",
        });
      }

      const trip = await TripModel.findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(currentUserId(req)),
      }).exec();

      if (!trip) {
        return res.code(404).send({ error: "Trip not found" });
      }

      if (!trip.itinerary) {
        return res.code(400).send({ error: "Generate the itinerary before regenerating a day." });
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

        return res.send(preview);
      } catch (error) {
        if (error instanceof TripDayNotFoundError) {
          return res.code(404).send({ error: error.message });
        }

        if (error instanceof NoSuitableAlternativesError) {
          return res.code(422).send({ error: error.message, warnings: error.warnings });
        }

        if (error instanceof RegenerationConflictError) {
          return res.code(409).send({ error: error.message });
        }

        throw error;
      }
    },
  );

  app.post<HttpRoute>(
    "/trips/:id/days/:dayId/apply",
    async (req, res) => {
      const id = tripIdParam(req);

      if (!id) {
        return res.code(404).send({ error: "Trip not found" });
      }

      const dayIndex = dayIndexParam(req);

      if (dayIndex === null) {
        return res.code(404).send({ error: "Day not found" });
      }

      const parsed = applyRegenerationRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.code(400).send({ error: "A valid preview is required to apply changes." });
      }

      const trip = await TripModel.findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(currentUserId(req)),
      }).exec();

      if (!trip) {
        return res.code(404).send({ error: "Trip not found" });
      }

      try {
        const updated = await applyDayRegeneration(trip, parsed.data.previewId, dayIndex);
        await recordAssistantRegeneration(id, currentUserId(req)).catch(() => { console.warn("[assistant] Applied regeneration; conversation confirmation could not be saved."); });
        return res.send(toTripDetail(updated));
      } catch (error) {
        if (error instanceof RegenerationNotFoundError) {
          return res.code(410).send({ error: error.message });
        }

        if (error instanceof RegenerationConflictError) {
          return res.code(409).send({ error: error.message });
        }

        throw error;
      }
    },
  );
}
