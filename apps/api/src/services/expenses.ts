import { expenseInputSchema, budgetAllocationsSchema, type BudgetAllocations, type ExpenseInput, type ExpenseOperation } from "@triply/shared";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { ItineraryEditError } from "./tripItineraryEditor.js";
import { summarizeBudget, totalBudgetMinor } from "./budgetSummary.js";
import { Types } from "mongoose";

export async function loadBudgetTrip(tripId: string, userId: string): Promise<TripDocument> {
  if (!Types.ObjectId.isValid(tripId) || !Types.ObjectId.isValid(userId)) throw new ItineraryEditError("Trip not found", 404);
  const trip = await TripModel.findOne({ _id: tripId, user: userId });
  if (!trip) throw new ItineraryEditError("Trip not found", 404);
  return trip;
}
export function validateExpenseAssociations(trip: TripDocument, expense: ExpenseInput, existing?: ExpenseInput) {
  if (expense.dayId !== null && expense.dayId !== existing?.dayId && !trip.itinerary?.days.some(d => String(d.dayIndex) === expense.dayId)) throw new ItineraryEditError("Day does not belong to this trip");
  if (expense.attractionId !== null && expense.attractionId !== existing?.attractionId && !trip.attractions.some(p => p.placeId === expense.attractionId)) throw new ItineraryEditError("Attraction does not belong to this trip");
  if (expense.replacesAdmission) {
    const count = trip.itinerary?.days.find(d => String(d.dayIndex) === expense.dayId)?.activities.filter(a => a.type === "attraction" && a.placeId === expense.attractionId).length ?? 0;
    const unchanged = existing?.replacesAdmission && existing.dayId === expense.dayId && existing.attractionId === expense.attractionId;
    if (count !== 1 && !unchanged) throw new ItineraryEditError("Select a single scheduled admission to replace");
  }
}
export async function mutateExpense(tripId: string, userId: string, operation: ExpenseOperation, revision: number): Promise<TripDocument> {
  const trip = await loadBudgetTrip(tripId, userId);
  const current = trip.toObject().expenses ?? [];
  // Stable client UUID makes retries idempotent, even after the revision advances.
  if (operation.type === "create") {
    const previous = current.find(e => e.id === operation.requestId);
    if (previous) {
      const { id: _id, createdAt: _created, updatedAt: _updated, ...input } = previous;
      if (JSON.stringify(expenseInputSchema.parse(input)) !== JSON.stringify(expenseInputSchema.parse(operation.expense))) throw new ItineraryEditError("Request identifier already used", 409);
      return trip;
    }
  }
  if ((trip.budgetRevision ?? 0) !== revision) throw new ItineraryEditError("Expenses changed. Refresh and try again.", 409);
  const index = operation.type === "create" ? -1 : current.findIndex(e => e.id === operation.expenseId);
  if (operation.type !== "create" && index < 0) throw new ItineraryEditError("Expense not found", 404);
  if (operation.type === "delete") current.splice(index, 1);
  else {
    const parsed = expenseInputSchema.safeParse(operation.expense);
    if (!parsed.success) throw new ItineraryEditError(parsed.error.issues[0]?.message ?? "Invalid expense");
    const expense = parsed.data;
    validateExpenseAssociations(trip, expense, current[index]);
    const occurrences = trip.itinerary?.days.flatMap(d => d.activities.filter(a => a.type === "attraction" && a.placeId === expense.attractionId)).length ?? 0;
    if (expense.replacesAdmission && current.some((e, i) => i !== index && e.replacesAdmission && (e.dayId === expense.dayId || occurrences === 1) && e.attractionId === expense.attractionId)) throw new ItineraryEditError("This admission already has a replacement expense");
    const now = new Date().toISOString();
    if (operation.type === "create") current.push({ ...expense, id: operation.requestId, createdAt: now, updatedAt: now });
    else current[index] = { ...current[index], ...expense, updatedAt: now };
  }
  if (current.length > 2000) throw new ItineraryEditError("Expense limit reached");
  try { summarizeBudget({ ...trip.toObject(), expenses: current }); } catch { throw new ItineraryEditError("Combined expenses exceed the supported money range"); }
  const updated = await TripModel.findOneAndUpdate({ _id: trip._id, user: trip.user,
    $and: [{ $or: [{ budgetRevision: revision }, ...(revision === 0 ? [{ budgetRevision: { $exists: false } }] : [])] },
      { $or: [{ itineraryVersion: trip.itineraryVersion ?? 0 }, ...(!trip.itineraryVersion ? [{ itineraryVersion: { $exists: false } }] : [])] }],
  }, { $set: { expenses: current }, $inc: { budgetRevision: 1 } }, { new: true, runValidators: true });
  if (!updated) throw new ItineraryEditError("Trip changed. Refresh and try again.", 409);
  return updated;
}
export async function updateBudgetAllocations(tripId: string, userId: string, allocations: BudgetAllocations, revision: number) {
  const trip = await loadBudgetTrip(tripId, userId);
  const parsed = budgetAllocationsSchema.safeParse(allocations);
  if (!parsed.success) throw new ItineraryEditError("Invalid allocations");
  const sum = Object.values(parsed.data).reduce((total, value) => total + BigInt(value!), 0n);
  const budget = totalBudgetMinor(trip);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER) || (sum > 0 && (budget === null || sum > BigInt(budget)))) throw new ItineraryEditError("Allocations must fit a known trip budget");
  const updated = await TripModel.findOneAndUpdate({ _id: trip._id, user: trip.user,
    $or: [{ budgetRevision: revision }, ...(revision === 0 ? [{ budgetRevision: { $exists: false } }] : [])],
    "analysis.budget": trip.analysis.budget, "analysis.travelers": trip.analysis.travelers,
  }, { $set: { budgetAllocations: parsed.data, budgetAllocationCurrency: trip.analysis.budget.currency }, $inc: { budgetRevision: 1 } }, { new: true, runValidators: true });
  if (!updated) throw new ItineraryEditError("Budget changed. Refresh and try again.", 409);
  return updated;
}
