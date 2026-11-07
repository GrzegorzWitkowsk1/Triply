import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { VisitStatus, TripDetail, AutomaticExpenseResult, TripBudgetData } from "@triply/shared";
import { useIdentityMutation } from "./useIdentityMutation";
import { updateTripVisit, retryTripVisitExpense } from "../api/trips";
import { cacheConfirmedTrip } from "../query/confirmedTrip";
import { tripQueryKey } from "./useTrips";

export function useTripVisits(tripId: string | undefined, onExpensePrompt?: (trip: TripDetail, itemId: string) => void) {
  const client = useQueryClient();
  const route = useRef(tripId);
  route.current = tripId;
  const locked = useRef(false);
  const offered = useRef(new Set<string>());
  const [expenseFeedback, setExpenseFeedback] = useState<(AutomaticExpenseResult & { tripId: string }) | null>(null);
  const mutation = useIdentityMutation({
    onMutate: ({ itemId }) => ({ previousStatus: client.getQueryData<TripDetail>(tripQueryKey(tripId ?? ""))?.visits?.find(record => record.itineraryItemId === itemId)?.status ?? "planned" }),
    mutationFn: ({ itemId, status, retryExpense }: { itemId: string; status: VisitStatus; retryExpense?: boolean }) => retryExpense ? retryTripVisitExpense(tripId!, itemId) : updateTripVisit(tripId!, itemId, status),
    onSuccess: async ({ expensePromptItemId, automaticExpense, ...trip }, variables, context) => {
      if (!await cacheConfirmedTrip(client, trip)) return;
      if (trip.budgetData) client.setQueryData<TripBudgetData>(["trips", trip.id, "budget"], current => current && current.revision > trip.budgetData!.revision ? current : trip.budgetData);
      const current = client.getQueryData<TripDetail>(tripQueryKey(trip.id));
      const latestBudget = client.getQueryData<TripBudgetData>(["trips", trip.id, "budget"]);
      if (current && route.current === trip.id && current.visitRevision === trip.visitRevision && (current.budgetData?.revision ?? 0) === (trip.budgetData?.revision ?? 0) &&
        (latestBudget?.revision ?? 0) <= (trip.budgetData?.revision ?? 0)) {
        setExpenseFeedback(automaticExpense ? { ...automaticExpense, tripId: trip.id } : null);
      }
      const promptKey = `${trip.id}:${variables.itemId}`;
      if (current && route.current === trip.id && context.previousStatus !== "visited" && !offered.current.has(promptKey) && variables.status === "visited" && expensePromptItemId === variables.itemId &&
        current.visitRevision === trip.visitRevision && current.visits?.some(record => record.itineraryItemId === variables.itemId && record.status === "visited")) {
        offered.current.add(promptKey);
        onExpensePrompt?.(current, variables.itemId);
      }
    },
    onSettled: () => { void client.invalidateQueries({ queryKey: tripQueryKey(tripId ?? "") }); },
  });
  const change = async (itemId: string, status: VisitStatus, retryExpense = false) => {
    if (locked.current || !tripId) return;
    locked.current = true;
    try { await mutation.mutateAsync({ itemId, status, retryExpense }); }
    catch { /* The mutation error is rendered beside the timeline. */ }
    finally { locked.current = false; }
  };
  return { ...mutation, expenseFeedback: expenseFeedback?.tripId === tripId ? expenseFeedback : null, change,
    retryExpense: (itemId: string) => change(itemId, "planned", true) };
}
