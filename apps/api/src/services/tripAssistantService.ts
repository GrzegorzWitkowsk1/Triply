import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { TripModel } from "../models/Trip.js";
import { itineraryEditRequestSchema, type AssistantMessageRequest, type AssistantMessageResult, type AssistantResponse, type ItineraryEditOperation } from "@triply/shared";
import { createAIProvider } from "../ai/providers/factory.js";
import { TripAssistantConversationModel } from "../models/TripAssistantConversation.js";
import { applyItineraryOperation, editTripItinerary, ItineraryEditError, loadEditableTrip, recalculateEditedDay } from "./tripItineraryEditor.js";
import { createRoutingProvider } from "../routing/index.js";
import { createDayRegenerationPreview } from "./tripRegeneration.js";
import { interpretAssistantIntent } from "./assistantIntent.js";
import { buildAssistantContext, factualAnswer, resolveAttraction, resolveDay } from "./assistantContext.js";

async function conversation(tripId: string, userId: string, conversationId?: string) {
  await loadEditableTrip(tripId, userId);
  const filter = { tripId: new Types.ObjectId(tripId), userId: new Types.ObjectId(userId) };
  if (conversationId) {
    if (!Types.ObjectId.isValid(conversationId)) throw new ItineraryEditError("Conversation not found", 404);
    const found = await TripAssistantConversationModel.findOne({ ...filter, _id: conversationId });
    if (!found) throw new ItineraryEditError("Conversation not found", 404);
    return found;
  }
  return TripAssistantConversationModel.findOneAndUpdate(filter, { $setOnInsert: filter }, { upsert: true, new: true, setDefaultsOnInsert: true });
}
export async function getAssistantConversation(tripId: string, userId: string, conversationId?: string) {
  const stored = await conversation(tripId, userId, conversationId);
  return { conversationId: stored.id as string, messages: stored.messages };
}

export async function sendAssistantMessage(tripId: string, userId: string, input: AssistantMessageRequest): Promise<AssistantMessageResult> {
  const trip = await loadEditableTrip(tripId, userId);
  const stored = await conversation(tripId, userId, input.conversationId);
  const revision = stored.revision;
  let response: AssistantResponse;
  try {
    if (input.candidate && (!stored.pending || !["add", "replace"].includes(stored.pending.operation ?? ""))) throw new ItineraryEditError("There is no pending attraction selection.");
    const interpreted = input.candidate && stored.pending
      ? { ...stored.pending, ...(stored.pending.operation === "add" ? { attraction: input.candidate.attractionId } : { replacement: input.candidate.attractionId }) }
      : await interpretAssistantIntent(createAIProvider(), {
      currentDate: new Date().toISOString(), context: buildAssistantContext(trip, input.selectedDayId),
      history: stored.messages.slice(-12).map(message => ({ ...message, text: message.text.slice(0,2000) })), pending: stored.pending, lastDay: stored.lastDay, lastAttraction: stored.lastAttraction, message: input.message,
    });
    // The pending operation is authoritative; a clarification cannot replace it.
    const intent = stored.pending && stored.pending.intent !== "clarification" && !stored.pending.multipleActions
      ? { ...interpreted, intent: stored.pending.intent, question: stored.pending.question, operation: stored.pending.operation,
          before: interpreted.before ?? stored.pending.before,
          day: stored.pending.day && resolveDay(trip.itinerary!.days, stored.pending.day, stored.lastDay, input.selectedDayId).length === 1 ? stored.pending.day : interpreted.day,
          targetDay: stored.pending.targetDay && resolveDay(trip.itinerary!.days, stored.pending.targetDay, null).length === 1 ? stored.pending.targetDay : interpreted.targetDay,
          attraction: interpreted.attraction ?? stored.pending.attraction, replacement: interpreted.replacement ?? stored.pending.replacement,
          preferences: Object.fromEntries(Object.keys(stored.pending.preferences).map(key => [key,
            stored.pending!.preferences[key as keyof typeof interpreted.preferences] || interpreted.preferences[key as keyof typeof interpreted.preferences]])) as typeof interpreted.preferences }
      : interpreted;
    const clarify = (message: string): AssistantResponse => { stored.pending = intent; return { type: "clarification", message }; };
    const days = resolveDay(trip.itinerary!.days, intent.day, stored.lastDay, input.selectedDayId);
    const day = days.length === 1 ? days[0] : undefined;
    const attractions = resolveAttraction(trip, intent.attraction, intent.day ? day : undefined, stored.lastAttraction);
    const attraction = attractions.length === 1 ? attractions[0] : undefined;
    stored.prepared = null;
    if (intent.multipleActions) response = clarify("I can prepare these changes sequentially, with confirmation for each. Which change should we handle first? Please restate that change.");
    else if (intent.intent === "unsupported") response = { type: "message", message: "I can answer questions about this itinerary and prepare day regeneration or attraction edits. That request is outside those capabilities." };
    else if (intent.intent === "clarification") response = clarify("Please specify the trip question or itinerary change you want.");
    else if ((intent.day && !day) || ((intent.intent === "regenerate_day" || intent.operation === "add") && !day)) response = clarify(`Which itinerary day do you mean? Available days: ${trip.itinerary!.days.map(d => `${d.dayIndex}${d.date ? ` (${d.date})` : ""}`).join(", ")}.`);
    else if (intent.intent === "trip_question") {
      if (intent.question === "why" && !attraction) response = clarify(`Which attraction do you mean? ${attractions.map(a => a.name).join(", ")}`);
      else response = { type: "message", message: factualAnswer(trip, intent.question, intent.day || (stored.lastDay && ["schedule", "first", "last", "duration"].includes(intent.question)) ? day : undefined, attraction?.id ?? undefined) };
    } else if (intent.intent === "regenerate_day" && day) {
      if (!Object.values(intent.preferences).some(Boolean)) response = clarify("How should this day change: less walking, more food, relaxed pace, indoor attractions, or a different plan?");
      else response = { type: "action_preview", actionType: "regenerate_day", message: `Review the proposed day ${day.dayIndex}. Your itinerary changes only when you apply the preview.`, preview: await createDayRegenerationPreview({ trip, dayIndex: day.dayIndex, preferences: intent.preferences }) };
    } else {
      let operation: ItineraryEditOperation | undefined;
      const target = resolveDay(trip.itinerary!.days, intent.targetDay, null);
      const newPlaces = resolveAttraction(trip, intent.operation === "add" ? intent.attraction : intent.replacement, undefined, null, true);
      if (intent.operation === "add" || intent.operation === "replace") {
        if (newPlaces.length !== 1 || !newPlaces[0].id) {
          response = clarify(`Choose an unscheduled attraction using the existing picker, or tell me its exact name.${newPlaces.length ? ` Matches: ${newPlaces.map(p => p.name).join(", ")}.` : ""}`);
          const pickerDay = intent.operation === "add" ? day : attraction ? trip.itinerary!.days.find(d => d.dayIndex === attraction.dayIndex) : undefined;
          if (pickerDay && response.type === "clarification") response.picker = { dayIndex: pickerDay.dayIndex, replace: intent.operation === "replace", stopCount: pickerDay.activities.filter(a => a.type === "attraction").length };
        }
        else if (intent.operation === "add" && day) operation = { type: "add", dayIndex: day.dayIndex, attractionId: newPlaces[0].id, ...(input.candidate ? { position: input.candidate.position } : {}) };
        else if (attraction?.id) operation = { type: "replace", dayIndex: attraction.dayIndex, oldAttractionId: attraction.id, newAttractionId: newPlaces[0].id };
      } else if (attraction?.id) {
        if (intent.operation === "remove") operation = { type: "remove", dayIndex: attraction.dayIndex, attractionId: attraction.id };
        if (intent.operation === "move" && target.length === 1) operation = { type: "move", sourceDayIndex: attraction.dayIndex, targetDayIndex: target[0].dayIndex, attractionId: attraction.id };
        if (intent.operation === "reorder") {
          const source = trip.itinerary!.days.find(d => d.dayIndex === attraction.dayIndex)!;
          const before = resolveAttraction(trip, intent.before, source, null);
          if (before.length === 1 && before[0].id && before[0].id !== attraction.id) {
            const ids = source.activities.filter(a => a.type === "attraction").map(a => a.placeId!).filter(id => id !== attraction.id);
            ids.splice(ids.indexOf(before[0].id), 0, attraction.id);
            operation = { type: "reorder", dayIndex: source.dayIndex, attractionIds: ids };
          }
        }
      }
      if (!operation) response ??= clarify(`Please specify ${!attraction && intent.operation !== "add" ? `the exact attraction${attractions.length ? ` (${attractions.map(a => a.name).join(", ")})` : ""}` : "the destination day or attraction to place it before"}.`);
      else {
        const request = itineraryEditRequestSchema.parse({ operation, expectedVersion: trip.itineraryVersion });
        const proposed = trip.toObject().itinerary!.days;
        const affected = applyItineraryOperation(proposed, trip.attractions, request);
        const provider = createRoutingProvider();
        const previewDays = [];
        for (const index of affected) previewDays.push(await recalculateEditedDay(trip, proposed.find(d => d.dayIndex === index)!, provider));
        const warnings = previewDays.flatMap(d => d.warnings);
        const id = randomUUID();
        stored.prepared = { id, expiresAt: new Date(Date.now() + 30 * 60_000), request, days: previewDays, warnings };
        const description = operation.type === "move" ? `Move ${attraction!.name} from day ${operation.sourceDayIndex} to day ${operation.targetDayIndex}`
          : operation.type === "remove" ? `Remove ${attraction!.name} from day ${operation.dayIndex}`
          : operation.type === "add" ? `Add ${newPlaces[0].name} to day ${operation.dayIndex}`
          : operation.type === "replace" ? `Replace ${attraction!.name} with ${newPlaces[0].name} on day ${operation.dayIndex}`
          : `Reorder day ${"dayIndex" in operation ? operation.dayIndex : ""}: place ${attraction!.name} before ${intent.before}`;
        response = { type: "action_preview", actionType: "edit_itinerary", previewId: id, days: previewDays, warnings, message: `${description}. Review the proposed schedule before applying it.` };
      }
    }
    if (day) stored.lastDay = day.dayIndex;
    if (attraction?.id) { stored.lastAttraction = attraction.id; stored.lastDay = attraction.dayIndex; }
    if (response!.type !== "clarification") stored.pending = null;
  } catch (error) {
    response = { type: "error", retryable: true, message: error instanceof ItineraryEditError ? error.message : "I couldn't prepare a reliable response. Please try again or clarify your request." };
  }
  if (response!.message.length > 12000) response!.message = `${response!.message.slice(0,11900)}\nThis answer is shortened. Ask about a specific day for its full schedule.`;
  const messages = [...stored.messages, { id: randomUUID(), role: "user" as const, text: input.message }, { id: randomUUID(), role: "ai" as const, text: response!.message }].slice(-40);
  const saved = await TripAssistantConversationModel.findOneAndUpdate({ _id: stored._id, revision }, { $set: { messages, pending: stored.pending, prepared: stored.prepared, lastDay: stored.lastDay, lastAttraction: stored.lastAttraction }, $inc: { revision: 1 } }, { new: true });
  if (!saved) throw new ItineraryEditError("Another message is being processed. Please retry.", 409);
  return { conversationId: saved.id as string, messages, response: response! };
}

export async function confirmAssistantEdit(tripId: string, userId: string, previewId: string) {
  const stored = await conversation(tripId, userId);
  const prepared = stored.prepared;
  if (!prepared || prepared.id !== previewId || prepared.expiresAt.getTime() <= Date.now()) throw new ItineraryEditError("This preview expired or was already applied. Prepare a new one.", 410);
  // Claim once, atomically with cancellation; failed applies require a new preview.
  const claim = await TripAssistantConversationModel.updateOne({ _id: stored._id, "prepared.id": previewId, "prepared.expiresAt": { $gt: new Date() } }, { $set: { prepared: null }, $inc: { revision: 1 } });
  if (!claim.modifiedCount) throw new ItineraryEditError("This preview expired or was already applied. Prepare a new one.", 410);
  // Existing editor revalidates ownership, operation and version and performs atomic CAS.
  const result = await editTripItinerary(tripId, userId, prepared.request);
  await TripAssistantConversationModel.updateOne({ _id: stored._id }, { $push: { messages: { $each: [{ id: randomUUID(), role: "ai", text: "Confirmed: your itinerary was updated." }], $slice: -40 } }, $inc: { revision: 1 } }).catch(() => { console.warn("[assistant] Applied edit; conversation confirmation could not be saved."); });
  return result;
}

export async function cancelAssistantAction(tripId: string, userId: string, previewId: string) {
  const trip = await loadEditableTrip(tripId, userId);
  await TripAssistantConversationModel.updateOne({ tripId: trip._id, userId: trip.user, "prepared.id": previewId }, { $set: { prepared: null }, $inc: { revision: 1 } });
  await TripModel.updateOne({ _id: trip._id, user: trip.user, "regeneration.previewId": previewId }, { $set: { regeneration: null } });
}

export async function recordAssistantRegeneration(tripId: string, userId: string) {
  await TripAssistantConversationModel.updateOne({ tripId: new Types.ObjectId(tripId), userId: new Types.ObjectId(userId) }, {
    $push: { messages: { $each: [{ id: randomUUID(), role: "ai", text: "Confirmed: your itinerary was updated." }], $slice: -40 } }, $inc: { revision: 1 },
  });
}
