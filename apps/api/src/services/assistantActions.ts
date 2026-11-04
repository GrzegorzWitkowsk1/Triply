import { createHash, randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { assistantToolRequestsSchema, assistantValidatedActionsSchema, formatMoney, type AssistantActionProposal, type AssistantValidatedAction, type AssistantToolRequest, type SupportedLocale } from "@triply/shared";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { ownerFilter } from "../middleware/tripIdentity.js";
import { ItineraryEditError, loadEditableTrip } from "./tripItineraryEditor.js";
import { EquipmentError } from "./equipment.js";
import { localizeExplanation } from "./contentLanguage.js";
import { assistantToolRegistry, AssistantActionError, type ToolContext } from "./assistantToolRegistry.js";

export interface StoredAssistantProposal extends AssistantActionProposal { baseFingerprint: string; planFingerprint: string; evidence: string; requests: AssistantToolRequest[] }
const factFields = ["status", "analysis", "contentLocale", "itinerary", "itineraryVersion", "attractions", "weather", "expenses", "budgetRevision", "equipment", "budgetAllocations", "budgetAllocationCurrency"] as const;
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) && !(entry instanceof Date) && !(entry instanceof Types.ObjectId) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function facts(trip: TripDocument) { const plain = trip.toObject(); return Object.fromEntries(factFields.map(field => [field, plain[field]])); }
export function publicProposal(proposal: StoredAssistantProposal | AssistantActionProposal): AssistantActionProposal {
  const { proposalId, tripId, status, actions, changes, warnings, conflicts, days, baseItineraryVersion, baseBudgetRevision, createdAt, expiresAt } = proposal;
  return { proposalId, tripId, status: status === "pending" && actions.some(action => action.domain === "packing") ? "failed" : status === "pending" && new Date(expiresAt).getTime() <= Date.now() ? "expired" : status,
    actions, changes, warnings, conflicts, days, baseItineraryVersion, baseBudgetRevision, createdAt, expiresAt };
}
export function tripProposals(trip: TripDocument) { return [...(trip.assistantActionHistory ?? []), ...(trip.assistantAction ? [trip.assistantAction] : [])].map(publicProposal); }
async function snapshot(tripId: string, owner: string) {
  await loadEditableTrip(tripId, owner);
  const raw = await TripModel.collection.findOne({ _id: new Types.ObjectId(tripId), ...ownerFilter(owner) });
  if (!raw || raw.status !== "ready") throw new ItineraryEditError("Trip not found", 404);
  return { raw, trip: new TripModel(raw) };
}
function guard(raw: Record<string, unknown>, owner: string) {
  return { _id: new Types.ObjectId(String(raw._id)), ...ownerFilter(owner), ...Object.fromEntries(factFields.map(field => [field, raw[field] === undefined ? { $exists: false } : raw[field]])) };
}
function archived(trip: TripDocument, replacement?: AssistantProposalStatusReplacement) {
  const previous = trip.assistantAction;
  const history = [...(trip.assistantActionHistory ?? [])];
  if (previous) history.push({ ...publicProposal(previous), status: replacement ?? (publicProposal(previous).status === "pending" ? "rejected" : publicProposal(previous).status), days: [] });
  return history.slice(-20);
}
type AssistantProposalStatusReplacement = AssistantActionProposal["status"];

/** All domain preparation reuses the manual services; this function performs no database writes. */
export async function prepareAssistantBatch(source: TripDocument, actions: AssistantValidatedAction[], timestamp: string, locale: SupportedLocale) {
  if (!assistantValidatedActionsSchema.safeParse(actions).success) throw new AssistantActionError("VALIDATION_FAILED", "Invalid registered action arguments.");
  if (actions.some(action => action.domain === "packing")) throw new AssistantActionError("TOOL_DISABLED", "Packing actions are disabled.");
  const trip = new TripModel(source.toObject());
  const changes: AssistantActionProposal["changes"] = [];
  const affected = new Set<number>();
  const warnings: string[] = [];
  let itinerary = false, expense = false;
  const visits = (value: TripDocument) => value.itinerary!.days.flatMap(d => d.activities.filter(a => a.type === "attraction").map(a => ({ id: a.placeId!, name: a.title, dayIndex: d.dayIndex, value: `${locale === "pl" ? "Dzień" : "Day"} ${d.dayIndex} (${d.date}) ${a.startTime.slice(11, 16)}–${a.endTime.slice(11, 16)}` })));
  for (const action of actions) {
    if (action.domain === "itinerary") {
      const before = visits(trip);
      const prepared = await assistantToolRegistry[action.tool].prepareDraft(trip, action, timestamp);
      itinerary = true;
      prepared.affectedDayIndices.forEach(index => affected.add(index)); warnings.push(...prepared.warnings);
      if (action.operation.type === "replace") {
        const replacement = trip.attractions.find(p => p.placeId === (action.operation as { newAttractionId: string }).newAttractionId);
        const environment = replacement?.environment === "indoor" ? locale === "pl" ? "wewnątrz" : "indoors" : replacement?.environment === "outdoor" ? locale === "pl" ? "na zewnątrz" : "outdoors" : locale === "pl" ? "otoczenie nieznane" : "environment unknown";
        warnings.push(locale === "pl" ? `Zamiennik: ${replacement?.name} (${environment}). Wybrano ze znanych atrakcji podróży. Dostępność opiera się na zapisanych danych, bez sprawdzenia na żywo.` : `Replacement: ${replacement?.name} (${environment}). Selected from known trip attractions. Availability uses saved data, without live verification.`);
      }
      const after = visits(trip);
      for (const id of new Set([...before.map(v => v.id), ...after.map(v => v.id)])) {
        const a = before.find(v => v.id === id), b = after.find(v => v.id === id);
        if (a?.value !== b?.value) changes.push({ tool: action.tool, entityId: id, label: b?.name ?? a!.name, before: a?.value ?? null, after: b?.value ?? null, dayIndex: b?.dayIndex ?? a?.dayIndex });
      }
    } else if (action.domain === "expense") {
      const op = action.operation;
      const before = op.type === "create" ? undefined : trip.expenses.find(e => e.id === op.expenseId);
      await assistantToolRegistry[action.tool].prepareDraft(trip, action, timestamp); expense = true;
      const id = op.type === "create" ? op.requestId : op.expenseId;
      const after = trip.expenses.find(e => e.id === id);
      const categories = locale === "pl"
        ? { attractions: "Atrakcje", food_drinks: "Jedzenie i napoje", transport: "Transport", accommodation: "Noclegi", shopping: "Zakupy", other: "Inne" }
        : { attractions: "Attractions", food_drinks: "Food & Drinks", transport: "Transport", accommodation: "Accommodation", shopping: "Shopping", other: "Other" };
      const format = (value: typeof before) => value ? [
        `${value.title}: ${formatMoney(value.amountMinor, value.currency, locale)} (${locale === "pl" ? value.type === "actual" ? "poniesiony" : "planowany" : value.type})`,
        categories[value.category],
        value.dayId ? `${locale === "pl" ? "Dzień" : "Day"} ${value.dayId}` : locale === "pl" ? "Bez przypisanego dnia" : "No assigned day",
        value.date ?? (locale === "pl" ? "Bez daty" : "No date"),
      ].join(" · ") : null;
      changes.push({ tool: action.tool, entityId: id, label: after?.title ?? before!.title, before: format(before), after: format(after) });

    }
  }
  const payload = {
    ...(itinerary ? { itinerary: trip.toObject().itinerary, itineraryVersion: source.itineraryVersion + 1, regeneration: null } : {}),
    ...(expense ? { expenses: trip.toObject().expenses, budgetRevision: (source.budgetRevision ?? 0) + 1 } : {}),
  };
  const days = trip.itinerary!.days.filter(d => affected.has(d.dayIndex));
  return { payload, changes, warnings: [...new Set(warnings)].slice(0, 30).map(message => localizeExplanation(message, locale)), days };
}

export async function createAssistantProposal(tripId: string, owner: string, requests: AssistantToolRequest[], context: Omit<ToolContext, "trip">, log?: (fields: Record<string, unknown>) => void): Promise<AssistantActionProposal> {
  const { raw, trip } = await snapshot(tripId, owner);
  assistantToolRequestsSchema.parse(requests);
  const actions = requests.map(request => assistantToolRegistry[request.tool].resolve(request.arguments, { ...context, trip }));
  const createdAt = new Date().toISOString();
  let prepared: Awaited<ReturnType<typeof prepareAssistantBatch>>;
  let conflicts: string[] = [];
  try { prepared = await prepareAssistantBatch(trip, actions, createdAt, context.locale); }
  catch (error) {
    if (!(error instanceof ItineraryEditError) && !(error instanceof EquipmentError)) throw error;
    conflicts = [localizeExplanation(error.message, context.locale), ...(error instanceof ItineraryEditError ? error.warnings.map(w => localizeExplanation(w, context.locale)) : [])].slice(0, 20);
    prepared = { payload: {}, changes: [], warnings: [], days: [] };
  }
  const proposal: StoredAssistantProposal = { proposalId: randomUUID(), tripId, actions, changes: prepared.changes, warnings: prepared.warnings, conflicts, days: prepared.days,
    status: conflicts.length ? "failed" : "pending", baseItineraryVersion: trip.itineraryVersion, baseBudgetRevision: trip.budgetRevision ?? 0,
    createdAt, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), baseFingerprint: hash(facts(trip)), planFingerprint: hash(prepared.payload), evidence: context.evidence.slice(-10000), requests };
  if (canonical(proposal).length > 100000) throw new RangeError("Assistant proposal exceeds context budget");
  const currentProposal = raw.assistantAction;
  // Model queries cast whole subdocuments and insert nested defaults. A raw BSON
  // snapshot must reach MongoDB unchanged, including key order and absent fields.
  const saved = await TripModel.collection.findOneAndUpdate({ ...guard(raw, owner), assistantAction: currentProposal === undefined ? { $exists: false } : currentProposal },
    { $set: { assistantAction: proposal, assistantActionHistory: archived(trip), updatedAt: new Date() } }, { returnDocument: "after" });
  if (!saved) {
    const current = await TripModel.collection.findOne({ _id: trip._id, ...ownerFilter(owner) });
    log?.({ stage: "proposal_cas_rejected", tripId, proposalId: proposal.proposalId, baseItineraryVersion: raw.itineraryVersion ?? 0,
      currentItineraryVersion: current?.itineraryVersion ?? null, baseBudgetRevision: raw.budgetRevision ?? 0, currentBudgetRevision: current?.budgetRevision ?? null,
      changedFields: current ? [...factFields, "assistantAction" as const].filter(field => canonical(raw[field]) !== canonical(current[field])) : ["ownership_or_trip"] });
    throw new AssistantActionError("PROPOSAL_STALE", "Trip changed while preparing the preview. Request a new proposal.", 409);
  }
  return publicProposal(proposal);
}

export async function executeAssistantProposal(tripId: string, owner: string, proposalId: string, locale: SupportedLocale = "en"): Promise<{ trip: TripDocument; proposal: AssistantActionProposal }> {
  const { raw, trip } = await snapshot(tripId, owner);
  const candidate = trip.assistantAction?.proposalId === proposalId ? trip.assistantAction : trip.assistantActionHistory?.find(p => p.proposalId === proposalId);
  if (!candidate) throw new AssistantActionError("PROPOSAL_NOT_FOUND", "Proposal not found.", 404);
  if (candidate.status === "completed") return { trip, proposal: publicProposal(candidate) };
  if (candidate.status !== "pending") throw new AssistantActionError(`PROPOSAL_${candidate.status.toUpperCase()}`, "This proposal can no longer be applied. Request a new one.", 409);
  const proposal = candidate as StoredAssistantProposal;
  const terminal = async (status: AssistantActionProposal["status"]) => { await TripModel.updateOne({ _id: trip._id, ...ownerFilter(owner), "assistantAction.proposalId": proposalId, "assistantAction.status": "pending" }, { $set: { "assistantAction.status": status } }); };
  if (proposal.actions.some(action => action.domain === "packing")) { await terminal("failed"); throw new AssistantActionError("PROPOSAL_FAILED", "Packing actions are disabled. Use Packing Assistant.", 409); }
  if (new Date(proposal.expiresAt).getTime() <= Date.now()) { await terminal("expired"); throw new AssistantActionError("PROPOSAL_EXPIRED", "Proposal expired. Request a new one.", 410); }
  if (proposal.baseFingerprint !== hash(facts(trip))) { await terminal("stale"); throw new AssistantActionError("PROPOSAL_STALE", "Trip data changed. Review a new proposal before applying it.", 409); }
  let prepared: Awaited<ReturnType<typeof prepareAssistantBatch>>;
  try {
    // Re-resolve against the same authoritative state by validating all executable operations in the domain services.
    prepared = await prepareAssistantBatch(trip, proposal.actions, proposal.createdAt, locale);
    if (hash(prepared.payload) !== proposal.planFingerprint) { await terminal("stale"); throw new AssistantActionError("PROPOSAL_STALE", "The recalculated result differs from the approved preview. Request a new proposal.", 409); }
  } catch (error) {
    if (!(error instanceof AssistantActionError)) await terminal("failed");
    if (error instanceof EquipmentError) throw new AssistantActionError("VALIDATION_FAILED", localizeExplanation(error.message, locale), error.status);
    throw error;
  }
  if (new Date(proposal.expiresAt).getTime() <= Date.now()) { await terminal("expired"); throw new AssistantActionError("PROPOSAL_EXPIRED", "Proposal expired. Request a new one.", 410); }
  const completed = { ...proposal, evidence: "", requests: [], status: "completed" as const };
  trip.set(prepared.payload);
  await trip.validate(Object.keys(prepared.payload));
  const saved = await TripModel.collection.findOneAndUpdate({ ...guard(raw, owner), "assistantAction.proposalId": proposalId, "assistantAction.status": "pending", "assistantAction.expiresAt": { $gt: new Date().toISOString() } },
    { $set: { ...prepared.payload, assistantAction: completed, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!saved) {
    const current = await loadEditableTrip(tripId, owner);
    const receipt = tripProposals(current).find(p => p.proposalId === proposalId && p.status === "completed");
    if (receipt) return { trip: current, proposal: receipt };
    if (new Date(proposal.expiresAt).getTime() <= Date.now()) { await terminal("expired"); throw new AssistantActionError("PROPOSAL_EXPIRED", "Proposal expired. Request a new one.", 410); }
    await terminal("stale"); throw new AssistantActionError("PROPOSAL_STALE", "Trip changed during confirmation. No proposal changes were saved.", 409);
  }
  return { trip: TripModel.hydrate(saved), proposal: publicProposal(completed) };
}
export async function rejectAssistantProposal(tripId: string, owner: string, proposalId: string) {
  const trip = await loadEditableTrip(tripId, owner);
  if (trip.assistantAction?.proposalId !== proposalId) throw new AssistantActionError("PROPOSAL_NOT_FOUND", "Proposal not found.", 404);
  if (trip.assistantAction.status === "completed") throw new AssistantActionError("PROPOSAL_COMPLETED", "This proposal has already been applied.", 409);
  const current = await TripModel.findOneAndUpdate({ _id: trip._id, ...ownerFilter(owner), "assistantAction.proposalId": proposalId, "assistantAction.status": "pending" }, { $set: { "assistantAction.status": "rejected" } }, { new: true });
  if (current) return publicProposal(current.assistantAction!);
  if (trip.assistantAction.status === "rejected") return publicProposal(trip.assistantAction);
  throw new AssistantActionError("PROPOSAL_STALE", "Proposal changed during cancellation. Refresh the conversation.", 409);
}
