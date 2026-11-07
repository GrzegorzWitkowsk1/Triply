import { randomUUID } from "node:crypto";
import { admissionPriceSchema, expenseCurrencySchema, currencyPrecision, LIMITS, type TripExpense, type AutomaticExpenseResult } from "@triply/shared";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { ownerFilter } from "../middleware/tripIdentity.js";
import { normalizeAdmission } from "./admissionPricingService.js";
import { reliableAdmissionCost, summarizeBudget } from "./budgetSummary.js";
import { visitRevisionGuard } from "./visitedProtection.js";

export const automaticExpenseWrites = {
  async post(trip: TripDocument, owner: string, expenses: TripExpense[], receipts: TripDocument["automaticAdmissions"]) {
    const revision = trip.budgetRevision ?? 0;
    return TripModel.findOneAndUpdate({ _id: trip._id, ...ownerFilter(owner), itineraryVersion: trip.itineraryVersion,
      $and: [visitRevisionGuard(trip), { $or: [{ budgetRevision: revision }, ...(revision === 0 ? [{ budgetRevision: { $exists: false } }] : [])] }],
    }, { $set: { expenses, automaticAdmissions: receipts }, $inc: { budgetRevision: 1 } }, { new: true, runValidators: true }).exec();
  },
};

function potentialAdmission(expense: TripExpense, itemId: string, attractionId: string | null | undefined, dayId: string | null) {
  return expense.type === "actual" && (expense.replacesAdmission || expense.category === "attractions" || expense.category === "other") &&
    (expense.itineraryItemId === itemId || (!expense.itineraryItemId && (!expense.attractionId || expense.attractionId === attractionId) &&
      (expense.dayId === null || expense.dayId === dayId)));
}

/** Only explicit confirmed prices or exactly parsed nonconditional OSM admission evidence qualify. */
export function automaticAdmissionExpense(trip: TripDocument, itemId: string, now: string): TripExpense | null {
  const day = trip.itinerary?.days.find(day => day.activities.some(item => item.itineraryItemId === itemId));
  const item = day?.activities.find(item => item.type === "attraction" && item.itineraryItemId === itemId);
  if (!day || !item) return null;
  const matches = trip.attractions.filter(place => place.placeId && place.placeId === item.placeId);
  const stop = day.stops.find(stop => stop.itineraryItemId === itemId);
  const admission = matches.length === 1 ? matches[0].admission : stop?.admission;
  const price = admissionPriceSchema.safeParse(admission?.price);
  const currency = expenseCurrencySchema.safeParse(trip.analysis.budget.currency);
  if (!admission || admission.status !== "paid" || !price.success || !currency.success ||
    price.data.currency !== currency.data || price.data.fractionDigits !== currencyPrecision(currency.data) ||
    price.data.unit === "unknown" || price.data.reliability === "estimated" || admission.rawChargeConditional || admission.rawFeeConditional || admission.notes) return null;
  // The trip stores total travelers, not an adult/paying-subgroup breakdown.
  if (price.data.unit === "per_person" && (price.data.priceType !== "general" || !Number.isSafeInteger(trip.analysis.travelers) ||
    trip.analysis.travelers! < 1 || trip.analysis.travelers! > LIMITS.travelers)) return null;
  const { reliability: _reliability, ...value } = price.data;
  const evidence = admission.source === "osm" ? normalizeAdmission({ tourism: "attraction", fee: admission.rawFee, charge: admission.rawCharge, currency: admission.rawCurrency }) : null;
  if (price.data.reliability !== "confirmed" && (!evidence?.price || JSON.stringify(evidence.price) !== JSON.stringify(value))) return null;
  // A generic linked attractions/other expense could already be this ticket: ask rather than guess.
  if ((trip.expenses ?? []).some(expense => potentialAdmission(expense, itemId, item.placeId, String(day.dayIndex)))) return null;
  const amountMinor = reliableAdmissionCost(admission, trip.analysis.travelers, currency.data);
  if (!amountMinor || !Number.isSafeInteger(amountMinor)) return null;
  return { id: randomUUID(), title: item.title.slice(0, 120), category: "attractions", type: "actual", amountMinor, currency: currency.data,
    itineraryItemId: itemId, attractionId: item.placeId ?? null, dayId: String(day.dayIndex), date: day.date || null,
    replacesAdmission: false, note: null, createdAt: now, updatedAt: now,
    automaticSource: { type: "visit_admission", itineraryItemId: itemId, unit: price.data.unit,
      participants: price.data.unit === "per_person" ? trip.analysis.travelers : null,
      unitAmountMinor: price.data.amountMinor, postedAmountMinor: amountMinor, currency: currency.data } };
}

/** The pending snapshot is saved with the visit; expense + receipt completion use one document CAS.
 * An ambiguous write failure is reconciled by reading the durable receipt on the next PATCH.
 */
export async function reconcileVisitExpense(tripId: string, owner: string, itemId: string): Promise<{ trip: TripDocument; automaticExpense?: AutomaticExpenseResult }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const trip = await TripModel.findOne({ _id: tripId, ...ownerFilter(owner) }).orFail().exec();
    const receipts = trip.toObject().automaticAdmissions ?? [];
    const receipt = receipts.find(receipt => receipt.itineraryItemId === itemId);
    if (!receipt || receipt.state !== "pending") return { trip };
    try {
      const expenses = trip.toObject().expenses ?? [];
      // A manual ticket recorded during a failed-posting window requires manual resolution.
      if (expenses.some(expense => potentialAdmission(expense, itemId, receipt.expense.attractionId, receipt.expense.dayId))) return { trip, automaticExpense: { itemId, status: "failed" } };
      const ids = new Set(trip.itinerary?.days.flatMap(day => day.activities.map(item => item.itineraryItemId)));
      const expense = { ...receipt.expense, itineraryItemId: ids.has(itemId) ? itemId : null };
      if (expenses.length >= 2000) throw new Error("Expense limit reached");
      expenses.push(expense);
      summarizeBudget({ ...trip.toObject(), expenses });
      receipt.state = "posted";
      const updated = await automaticExpenseWrites.post(trip, owner, expenses, receipts);
      if (updated) return { trip: updated, automaticExpense: { itemId, status: "posted", amountMinor: expense.amountMinor, currency: expense.currency } };
    } catch {
      // Confirm an ambiguous write result before reporting success or failure.
      const current = await TripModel.findOne({ _id: tripId, ...ownerFilter(owner) }).orFail().exec();
      const posted = current.automaticAdmissions?.find(receipt => receipt.itineraryItemId === itemId && receipt.state === "posted");
      return { trip: current, automaticExpense: posted ? { itemId, status: "posted", amountMinor: posted.expense.amountMinor, currency: posted.expense.currency } : { itemId, status: "failed" } };
    }
  }
  const trip = await TripModel.findOne({ _id: tripId, ...ownerFilter(owner) }).orFail().exec();
  return { trip, automaticExpense: { itemId, status: "failed" } };
}
