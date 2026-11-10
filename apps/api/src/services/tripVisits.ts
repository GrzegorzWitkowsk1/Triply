import { guestWrite } from "../middleware/guestActivity.js";
import { itineraryItemIdSchema, updateVisitSchema, type VisitStatus, type VisitProgress, type AutomaticExpenseResult } from "@triply/shared";
import { automaticAdmissionExpense, reconcileVisitExpense } from "./automaticVisitExpenses.js";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { ownerFilter, storedOwner } from "../middleware/tripIdentity.js";
import { ensureItemIdentities } from "./itineraryIdentity.js";
import { ItineraryEditError, loadEditableTrip } from "./tripItineraryEditor.js";
import { guestOwnerId } from "../middleware/tripIdentity.js";
import { UserModel } from "../models/User.js";
import { loadBudgetTrip } from "./expenses.js";

/** Recovery does not change visit state and also supports a retired occurrence's pending receipt. */
export async function retryTripVisitExpense(tripId: string, owner: string, itemId: string) {
  if (!itineraryItemIdSchema.safeParse(itemId).success) throw new ItineraryEditError("Invalid itinerary item ID");
  const trip = await loadBudgetTrip(tripId, owner);
  if (!trip.automaticAdmissions?.some(receipt => receipt.itineraryItemId === itemId)) throw new ItineraryEditError("Automatic expense not found", 404);
  return reconcileVisitExpense(tripId, owner, itemId);
}

/** Lazy, version-guarded backfill. No itinerary generation or planner calls. */
export async function ensureTripItemIdentities(trip: TripDocument): Promise<TripDocument> {
  if (!trip.itinerary) return trip;
  const itinerary = trip.toObject().itinerary!;
  if (!ensureItemIdentities(itinerary.days)) return trip;
  const original = trip.toObject().itinerary!;
  let identityGuard: Record<string, unknown> = {};
  for (const [dayIndex, day] of itinerary.days.entries()) {
    const itemIndex = day.activities.findIndex((item, index) => item.itineraryItemId !== original.days[dayIndex].activities[index].itineraryItemId);
    if (itemIndex < 0) continue;
    identityGuard = { [`itinerary.days.${dayIndex}.activities.${itemIndex}.itineraryItemId`]: original.days[dayIndex].activities[itemIndex].itineraryItemId ?? { $exists: false } };
    break;
  }
  const version = trip.itineraryVersion ?? 0;
  const updated = await guestWrite(session => TripModel.findOneAndUpdate({ _id: trip._id, ...ownerFilter(storedOwner(trip)),
    ...identityGuard,
    $or: [{ itineraryVersion: version }, ...(version === 0 ? [{ itineraryVersion: { $exists: false } }] : [])],
  }, { $set: { itinerary, itineraryVersion: version } }, { new: true, runValidators: true }).session(session).exec());
  if (updated) return updated;
  const current = await TripModel.findOne({ _id: trip._id, ...ownerFilter(storedOwner(trip)) }).exec();
  if (!current) throw new ItineraryEditError("Trip not found", 404);
  return ensureTripItemIdentities(current);
}

export async function updateTripVisit(tripId: string, owner: string, itemId: string, status: VisitStatus): Promise<{ trip: TripDocument; expensePromptItemId?: string; automaticExpense?: AutomaticExpenseResult }> {
  if (!itineraryItemIdSchema.safeParse(itemId).success || !updateVisitSchema.safeParse({ status }).success) {
    throw new ItineraryEditError("Invalid visit status or itinerary item ID");
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const trip = await loadEditableTrip(tripId, owner);
    if (!trip.itinerary!.days.some(day => day.activities.some(item => item.type === "attraction" && item.itineraryItemId === itemId))) {
      throw new ItineraryEditError("Itinerary item not found", 404);
    }
    const records = trip.toObject().visits ?? [];
    const existing = records.find(record => record.itineraryItemId === itemId);
    if ((existing?.status ?? "planned") === status) return trip.automaticAdmissions?.some(receipt => receipt.itineraryItemId === itemId && receipt.state === "pending") ? reconcileVisitExpense(tripId, owner, itemId) : { trip };
    const firstVisit = status === "visited" && existing?.status !== "visited" && !(trip.expensePromptedItemIds ?? []).includes(itemId);
    const account = firstVisit && !guestOwnerId(owner) ? await UserModel.findById(owner).select("journeyPreferences") : null;
    const offerExpense = Boolean(account && (account.journeyPreferences?.promptForExpenseAfterVisit ?? true));
    const now = new Date().toISOString();
    const automaticAdmissions = trip.toObject().automaticAdmissions ?? [];
    const automatic = firstVisit && !automaticAdmissions.some(receipt => receipt.itineraryItemId === itemId)
      ? automaticAdmissionExpense(trip, itemId, now) : null;
    if (automatic) automaticAdmissions.push({ itineraryItemId: itemId, state: "pending", expense: automatic });
    const visits: VisitProgress[] = records.filter(record => record.itineraryItemId !== itemId);
    if (status !== "planned") visits.push({ itineraryItemId: itemId, status, updatedAt: now,
      ...(status === "visited" ? { visitedAt: now } : { skippedAt: now }) });
    const revision = trip.visitRevision ?? 0;
    const updated = await guestWrite(session => TripModel.findOneAndUpdate({ _id: trip._id, ...ownerFilter(owner), status: "ready",
      itineraryVersion: trip.itineraryVersion,
      $or: [{ visitRevision: revision }, ...(revision === 0 ? [{ visitRevision: { $exists: false } }] : [])],
      $and: [{ $or: [{ budgetRevision: trip.budgetRevision ?? 0 }, ...(!trip.budgetRevision ? [{ budgetRevision: { $exists: false } }] : [])] }],
    }, { $set: { visits, automaticAdmissions }, $inc: { visitRevision: 1 },
      ...(status === "visited" || existing?.status === "visited" ? { $addToSet: { expensePromptedItemIds: itemId } } : {}),
    }, { new: true, runValidators: true }).session(session).exec());
    if (updated) {
      if (automaticAdmissions.some(receipt => receipt.itineraryItemId === itemId && receipt.state === "pending")) return reconcileVisitExpense(tripId, owner, itemId);
      return { trip: updated, ...(firstVisit && offerExpense && !automatic ? { expensePromptItemId: itemId } : {}) };
    }
  }
  throw new ItineraryEditError("The trip has changed. Try again.", 409);
}
