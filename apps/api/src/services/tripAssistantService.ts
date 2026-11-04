import { createHash, randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { assistantEnabledToolNames, contentLocale, type AssistantToolName, type AssistantToolRequest, type AssistantMessageRequest, type AssistantMessageResult, type AssistantResponse } from "@triply/shared";
import { TripAssistantConversationModel } from "../models/TripAssistantConversation.js";
import { ItineraryEditError, loadEditableTrip } from "./tripItineraryEditor.js";
import { assistantResponseLocale } from "./contentLanguage.js";
import { createAIProvider } from "../ai/providers/factory.js";
import { env } from "../config/env.js";
import { assistantPrompt, ASSISTANT_PROMPT_VERSION } from "../ai/prompts/assistant.js";
import { publicMessages, assistantHistory } from "./assistantHistory.js";
import { buildConversationContext } from "./assistantTripContext.js";
import { assistantCompletion, assistantError } from "./assistantProvider.js";
import { AiError } from "../ai/errors.js";
import { createAssistantProposal, executeAssistantProposal, rejectAssistantProposal, tripProposals } from "./assistantActions.js";
import { AssistantActionError, assistantToolRegistry } from "./assistantToolRegistry.js";
import { allowedAssistantTools, isActionRequest, isBudgetQuestion, isPackingRequest, normalizeIntent, selectAssistantTools } from "./assistantToolSelection.js";
import { factualAnswer } from "./assistantContext.js";

function actionClarification(tools: readonly AssistantToolName[], locale: "en" | "pl") {
  return tools.length && tools.every(tool => tool.endsWith("expense"))
    ? locale === "pl" ? "Podaj nazwę wydatku, kwotę i walutę oraz czy jest planowany czy poniesiony." : "Specify the expense name, amount, currency and whether it is planned or actual."
    : locale === "pl" ? "Podaj dokładną nazwę atrakcji oraz docelowy dzień lub godzinę. Zmiana wymaga podglądu i potwierdzenia." : "Specify the exact attraction name and target day or time. The change requires a preview and confirmation.";
}

async function conversation(tripId: string, userId: string, conversationId?: string) {
  const filter = { tripId: new Types.ObjectId(tripId), userId: new Types.ObjectId(userId) };
  if (conversationId) {
    if (!Types.ObjectId.isValid(conversationId)) throw new ItineraryEditError("Conversation not found", 404);
    const found = await TripAssistantConversationModel.findOne({ ...filter, _id: conversationId });
    if (!found) throw new ItineraryEditError("Conversation not found", 404);
    return found;
  }
  try {
    return await TripAssistantConversationModel.findOneAndUpdate(filter, { $setOnInsert: filter }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const found = await TripAssistantConversationModel.findOne(filter);
    if (!found) throw error;
    return found;
  }
}
export async function getAssistantConversation(tripId: string, userId: string, conversationId?: string) {
  const trip = await loadEditableTrip(tripId, userId);
  const stored = await conversation(tripId, userId, conversationId);
  return { conversationId: stored.id as string, messages: publicMessages(stored.messages), proposals: tripProposals(trip) };
}

export interface AssistantDiagnostics {
  requestId?: string; signal?: AbortSignal;
  log?: (fields: Record<string, unknown>) => void;
}
export async function sendAssistantMessage(tripId: string, userId: string, input: AssistantMessageRequest, options: AssistantDiagnostics = {}): Promise<AssistantMessageResult> {
  const trip = await loadEditableTrip(tripId, userId);
  const stored = await conversation(tripId, userId, input.conversationId);
  const requestHash = createHash("sha256").update(JSON.stringify({ message: input.message, locale: input.locale, selectedDayId: input.selectedDayId, retryMessageId: input.retryMessageId, timeZone: input.timeZone })).digest("hex");
  if (input.requestId && stored.lastRequestId === input.requestId && stored.lastResponse) {
    if (stored.lastRequestHash !== requestHash) throw new ItineraryEditError("This request identifier was already used for a different message.", 409);
    return { tripId, requestId: input.requestId, conversationId: stored.id as string, messages: publicMessages(stored.messages), response: stored.lastResponse, proposals: tripProposals(trip) };
  }
  if (input.candidate) throw new ItineraryEditError("The assistant is read-only. Use the itinerary editor.", 400);
  let previous = publicMessages(stored.messages);
  if (input.retryMessageId) {
    const user = previous.at(-2), ai = previous.at(-1);
    if (!user || user.role !== "user" || user.id !== input.retryMessageId || user.text !== input.message || !ai?.failed) throw new ItineraryEditError("Only the latest failed message can be retried.", 409);
    previous = previous.slice(0, -2);
  }
  const revision = stored.revision;
  const claim = await TripAssistantConversationModel.updateOne({ _id: stored._id, revision,
    $or: [{ processingUntil: null }, { processingUntil: { $lt: new Date() } }] }, { $set: { processingUntil: new Date(Date.now() + 60_000) }, $inc: { revision: 1 } });
  if (!claim.modifiedCount) throw new ItineraryEditError("Another message is being processed. Please retry.", 409);
  const locale = assistantResponseLocale(input.message, contentLocale(input.locale));
  const signal = AbortSignal.any([AbortSignal.timeout(Math.min(env.AI_TIMEOUT_MS, 40_000)), ...(options.signal ? [options.signal] : [])]);
  const started = Date.now();
  let retries = 0, contextSize = 0, historyCount = 0;
  let errorCode: string | null = null, providerErrorCode: string | null = null;
  let stage = "context";
  const providerDiagnostics = (fields: Record<string, unknown>) => options.log?.({ ...fields, requestId: options.requestId ?? input.requestId, tripId, stage: "provider_response" });
  let day = stored.lastDay, attraction = stored.lastAttraction;
  let actionDraft: AssistantToolRequest[] | null = stored.actionDraft ?? null;
  let actionEvidence = stored.actionEvidence ?? "";
  let proposalForResult: import("@triply/shared").AssistantActionProposal | undefined;
  let response: AssistantResponse;
  let allowedTools: AssistantToolName[] = [];
  try {
    if (isPackingRequest(input.message)) throw new AssistantActionError("CLARIFICATION_REQUIRED", locale === "pl" ? "Listami pakowania zarządza osobny Asystent Pakowania. Otwórz go, aby dodać, usunąć lub spakować przedmioty." : "Packing lists are managed by the separate Packing Assistant. Open it to add, remove or pack items.");
    actionDraft = actionDraft?.filter(request => assistantEnabledToolNames.includes(request.tool)) ?? null;
    const pendingProposal = trip.assistantAction && trip.assistantAction.actions.every(action => action.domain !== "packing") && ["pending", "failed"].includes(trip.assistantAction.status) ? trip.assistantAction : null;
    const actionsEnabled = isActionRequest(input.message, Boolean(pendingProposal || actionDraft));
    allowedTools = allowedAssistantTools(input.message, pendingProposal?.requests ?? actionDraft ?? []);
    const history = assistantHistory(previous, actionsEnabled ? 12000 : 16000);
    historyCount = history.length;
    const context = buildConversationContext(trip, { ...input, history: previous, lastDay: day, lastAttraction: attraction }, actionsEnabled ? 18000 : 28000);
    // User-established referents survive provider failure without feeding error text back to the model.
    day = context.referents.dayIndex; attraction = context.referents.attractionId;
    contextSize = JSON.stringify(context).length;
    const entities = actionsEnabled ? {
      attractions: trip.attractions.slice(0, 100).map(p => ({ id: p.placeId, name: p.name, environment: p.environment })),
      expenses: trip.expenses.slice(-100).map(e => ({ id: e.id, title: e.title, amountMinor: e.amountMinor, currency: e.currency, type: e.type })),
      coverage: "Entity lists are bounded. Use literal user references; the server resolves against the complete authorized trip and rejects ambiguity.",
    } : undefined;
    const prompt = JSON.stringify({ context, history, message: input.message, entities,
      ...(actionsEnabled ? { pendingProposal: pendingProposal ? { status: pendingProposal.status, requests: pendingProposal.requests, changes: pendingProposal.changes } : null, clarificationDraft: actionDraft } : {}),
      recentProposals: tripProposals(trip).filter(p => p.actions.every(action => action.domain !== "packing")).slice(-3).map(p => ({ status: p.status, changes: p.changes.slice(0, 8) })),
    });
    // Conservative character budget (~25k tokens at two characters/token).
    if (prompt.length + assistantPrompt(locale).length > 50000) throw new RangeError("Assistant request exceeds context budget");
    if (actionsEnabled) {
      stage = "tool_selection";
      const intent = normalizeIntent(input.message);
      // Generic environment replacement needs only authoritative saved metadata.
      // It still goes through the same registry, validators and proposal CAS.
      const environmentReplacement = allowedTools.length === 1 && allowedTools[0] === "suggest_replacement"
        && /outdoor|open.air|fresh air|na swiezym powietrzu|na zewnatrz/.test(intent)
        && /indoor|inside|pod dachem|wewnatrz|w budynku/.test(intent)
        && !trip.attractions.some(place => intent.includes(normalizeIntent(place.name)));
      if (environmentReplacement) assistantToolRegistry.suggest_replacement.resolve({ attraction: "outdoor attraction", environment: "indoor" }, { trip, evidence: input.message, locale, selectedDayId: input.selectedDayId });
      const selection = environmentReplacement
        ? { actions: [{ tool: "suggest_replacement", arguments: { attraction: "outdoor attraction", environment: "indoor" } }] as AssistantToolRequest[], native: false }
        : await selectAssistantTools(createAIProvider(), { systemInstruction: assistantPrompt(locale, true), prompt, allowedTools, onDiagnostics: providerDiagnostics }, signal, () => { retries++; });
      options.log?.({ requestId: options.requestId, tripId, stage: "tool_selection", native: selection.native, tools: selection.actions.map(a => a.tool) });
      actionEvidence = `${actionEvidence || pendingProposal?.evidence || ""}\n${input.message}`;
      if (actionEvidence.length > 10000) {
        actionEvidence = input.message;
        actionDraft = [];
        throw new AssistantActionError("CLARIFICATION_REQUIRED", locale === "pl" ? "Podaj ponownie cały zestaw zmian, aby bezpiecznie zastąpić długą serię poprawek." : "Restate the complete set of changes to safely replace this long series of amendments.");
      }
      actionDraft = selection.actions;
      if (selection.actions.length) {
        stage = "proposal_preparation";
        proposalForResult = await createAssistantProposal(tripId, userId, selection.actions, { selectedDayId: input.selectedDayId, lastDay: day, lastAttraction: attraction, evidence: actionEvidence, locale }, fields => options.log?.({ requestId: options.requestId ?? input.requestId, ...fields }));
        options.log?.({ requestId: options.requestId, tripId, proposalId: proposalForResult.proposalId, stage: "proposal_validation", status: proposalForResult.status, tools: selection.actions.map(a => a.tool), conflictCount: proposalForResult.conflicts.length });
        response = { type: "action_proposal", message: locale === "pl" ? "Sprawdź wszystkie zmiany poniżej. Nic nie zostało jeszcze zmienione." : "Review all changes below. Nothing has been changed yet.", proposal: proposalForResult };
        const edit = proposalForResult.actions.find(a => a.domain === "itinerary");
        if (edit?.domain === "itinerary") { const op = edit.operation; attraction = "attractionId" in op ? op.attractionId : "oldAttractionId" in op ? op.oldAttractionId : attraction; day = op.type === "move" ? op.targetDayIndex : op.dayIndex; }
        actionDraft = null; actionEvidence = "";
      } else {
        // Native providers may return arbitrary text instead of tools. It is not
        // a validated action result and must not be presented as one.
        response = { type: "clarification", message: actionClarification(allowedTools, locale) };
        options.log?.({ requestId: options.requestId ?? input.requestId, tripId, stage: "tool_selection_no_actions", native: selection.native });
      }
    } else {
      actionDraft = null; actionEvidence = "";
      stage = "read_only_completion";
      response = { type: "message", message: isBudgetQuestion(input.message)
        ? factualAnswer(trip, "budget", undefined, undefined, input.message, locale)
        : await assistantCompletion(createAIProvider(), { responseFormat: "text", schema: { type: "string" }, systemInstruction: assistantPrompt(locale), prompt, onDiagnostics: providerDiagnostics }, signal, () => { retries++; }) };
    }
  } catch (error) {
    if (options.signal?.aborted) {
      await TripAssistantConversationModel.updateOne({ _id: stored._id, revision: revision + 1 }, { $set: { processingUntil: null } });
      throw error;
    }
    if (error instanceof AssistantActionError && error.code === "TOOL_INTENT_MISMATCH") {
      response = { type: "clarification", message: actionClarification(allowedTools, locale) };
    } else if (error instanceof AssistantActionError && error.code === "CLARIFICATION_REQUIRED") {
      response = { type: "clarification", message: error.message };
    } else if (error instanceof AssistantActionError && error.code === "PROPOSAL_STALE") {
      errorCode = error.code;
      response = { type: "clarification", message: locale === "pl" ? "Dane podróży zmieniły się podczas przygotowania podglądu. Poproś o nową propozycję." : "Trip data changed while preparing the preview. Request a new proposal." };
    } else {
    const normalized = assistantError(error);
    errorCode = normalized.code;
    providerErrorCode = error instanceof AiError ? error.code ?? null : null;
    const pl = locale === "pl";
    const message = normalized.code === "PROVIDER_TIMEOUT"
      ? pl ? "Asystent nie odpowiedział na czas. Spróbuj ponownie." : "The assistant took too long to respond. Please try again."
      : normalized.code === "RATE_LIMITED"
        ? pl ? "Asystent jest teraz zajęty. Spróbuj ponownie za chwilę." : "The assistant is busy. Please try again in a moment."
        : normalized.code === "PROVIDER_BAD_RESPONSE"
          ? pl ? "Asystent zwrócił nieprawidłową odpowiedź. Twoja wiadomość została zachowana. Spróbuj ponownie." : "The assistant returned an invalid response. Your message has been kept. Please try again."
        : normalized.code === "CONTEXT_TOO_LARGE"
          ? pl ? "Zapytaj o konkretny dzień lub miejsce, aby ograniczyć kontekst." : "Ask about a specific day or place to reduce the context."
          : pl ? "Asystent jest chwilowo niedostępny. Twoja wiadomość została zachowana." : "The assistant is temporarily unavailable. Your message has been kept.";
    response = { type: "error", ...normalized, message };
    }
  } finally {
    options.log?.({ requestId: options.requestId ?? input.requestId, tripId, provider: env.AI_PROVIDER,
      clientRequestId: input.requestId,
      model: env.AI_MODEL ?? (env.AI_PROVIDER === "gemini" ? "gemini-flash-latest" : null), promptVersion: ASSISTANT_PROMPT_VERSION,
      contextCharacters: contextSize, historyMessageCount: historyCount, latencyMs: Date.now() - started, retryCount: retries, fallbackUsed: false,
      errorCode, providerErrorCode, stage, errorCategory: errorCode === "INTERNAL_ERROR" ? "internal_exception" : errorCode ? "validated_failure" : null, cancelled: options.signal?.aborted ?? false });
  }
  const failed = response.type === "error";
  const messages = [...previous, { id: input.retryMessageId ?? randomUUID(), role: "user" as const, text: input.message, ...(failed ? { failed: true } : {}) },
    { id: randomUUID(), role: "ai" as const, text: response.message, ...(failed ? { failed: true } : {}), ...(proposalForResult ? { proposalId: proposalForResult.proposalId } : {}) }].slice(-40);
  if (options.signal?.aborted) {
    await TripAssistantConversationModel.updateOne({ _id: stored._id, revision: revision + 1 }, { $set: { processingUntil: null } });
    throw options.signal.reason;
  }
  const saved = await TripAssistantConversationModel.findOneAndUpdate({ _id: stored._id, revision: revision + 1 },
    { $set: { messages, responseLocale: locale, lastDay: day, lastAttraction: attraction, pending: null, prepared: null,
      processingUntil: null, lastRequestId: input.requestId ?? null, lastRequestHash: requestHash, lastResponse: response, actionDraft, actionEvidence } }, { new: true }).catch(async error => {
        await TripAssistantConversationModel.updateOne({ _id: stored._id, revision: revision + 1 }, { $set: { processingUntil: null } });
        throw error;
      });
  if (!saved) throw new ItineraryEditError("Conversation changed. Reload it before sending again.", 409);
  return { tripId, requestId: input.requestId, conversationId: saved.id as string, messages, response, proposals: proposalForResult ? [...tripProposals(trip).map(p => p.proposalId === trip.assistantAction?.proposalId && p.status === "pending" ? { ...p, status: "rejected" as const } : p), proposalForResult] : tripProposals(trip) };
}

export async function confirmAssistantEdit(tripId: string, userId: string, previewId: string, locale: import("@triply/shared").SupportedLocale = "en") {
  return executeAssistantProposal(tripId, userId, previewId, locale);
}
export async function cancelAssistantAction(tripId: string, userId: string, previewId: string) {
  return rejectAssistantProposal(tripId, userId, previewId);
}
export async function recordAssistantRegeneration(_tripId: string, _userId: string) {
  // Manual regeneration is independent of read-only conversation history.
}
