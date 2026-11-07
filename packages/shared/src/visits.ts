import { z } from "zod";
import type { ItineraryDay, TripDetail } from "./trip.js";

export const visitStatusSchema = z.enum(["planned", "visited", "skipped"]);
export type VisitStatus = z.infer<typeof visitStatusSchema>;
/** Only the successful transition response carries this one-time signal. Never cache it. */
export type AutomaticExpenseResult = { itemId: string; status: "posted"; amountMinor: number; currency: string }
  | { itemId: string; status: "failed" };
export type VisitMutationResponse = TripDetail & { expensePromptItemId?: string; automaticExpense?: AutomaticExpenseResult };
export const itineraryItemIdSchema = z.uuid();
export const updateVisitSchema = z.object({ status: visitStatusSchema }).strict();
export const visitProgressSchema = z.object({
  itineraryItemId: itineraryItemIdSchema,
  status: z.enum(["visited", "skipped"]),
  visitedAt: z.iso.datetime().optional(),
  skippedAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime(),
}).refine(record => record.status === "visited"
  ? Boolean(record.visitedAt) && record.skippedAt === undefined
  : Boolean(record.skippedAt) && record.visitedAt === undefined, "Status must have its matching server timestamp");
export type VisitProgress = z.infer<typeof visitProgressSchema>;

/** History entries refer to retired occurrences and never contribute to progress. */
export function visitProgress(days: readonly ItineraryDay[], records: readonly VisitProgress[] = []) {
  const statuses = new Map(records.map(record => [record.itineraryItemId, record.status]));
  const items = days.flatMap(day => day.activities.filter(item => item.type === "attraction"));
  const total = items.length;
  const visited = items.filter(item => item.itineraryItemId && statuses.get(item.itineraryItemId) === "visited").length;
  const skipped = items.filter(item => item.itineraryItemId && statuses.get(item.itineraryItemId) === "skipped").length;
  const remaining = total - visited - skipped;
  return { total, planned: remaining, remaining, visited, skipped, percentage: total ? visited / total * 100 : 0 };
}

/** Schedule and visit revisions advance independently. Keep the newest of each. */
export function mergeConfirmedTrip(current: TripDetail | undefined, incoming: TripDetail): TripDetail {
  if (!current) return incoming;
  const schedule = (current.itineraryVersion ?? 0) > (incoming.itineraryVersion ?? 0) ? current : incoming;
  const visits = (current.visitRevision ?? 0) > (incoming.visitRevision ?? 0) ? current : incoming;
  const budget = (current.budgetData?.revision ?? 0) > (incoming.budgetData?.revision ?? 0) ? current : incoming;
  const pending = (current.budgetData?.revision ?? 0) !== (incoming.budgetData?.revision ?? 0) ? budget : visits;
  return { ...schedule, visitRevision: visits.visitRevision, visits: visits.visits, budgetData: budget.budgetData,
    pendingVisitExpenseItemIds: pending.pendingVisitExpenseItemIds };
}
