import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BudgetAllocations, ExpenseInput, TripBudgetData } from "@triply/shared";
import { request } from "../api/client";
import { TRIPS_KEY } from "./useTrips";

export function useTripBudget(tripId: string) {
  const client = useQueryClient();
  const key = [...TRIPS_KEY, tripId, "budget"];
  const query = useQuery({ queryKey: key, enabled: Boolean(tripId), queryFn: async ({ signal }) => {
    const data = await request<TripBudgetData>(`/api/trips/${tripId}/budget`, { signal });
    if (!Array.isArray(data.expenses) || !data.summary || !Number.isSafeInteger(data.revision)) throw new Error("Invalid budget response");
    return data;
  } });
  const mutation = useMutation({
    onMutate: async () => { await client.cancelQueries({ queryKey: key, exact: true }); return { key }; },
    mutationFn: (input: { type: "create" | "update"; expense: ExpenseInput; id: string; revision: number } | { type: "delete"; id: string; revision: number } | { type: "allocations"; allocations: BudgetAllocations; revision: number }) => {
      const path = input.type === "allocations" ? "budget" : input.type === "create" ? "expenses" : `expenses/${input.id}`;
      const method = input.type === "create" ? "POST" : input.type === "delete" ? "DELETE" : "PATCH";
      const body = input.type === "allocations" ? { allocations: input.allocations, expectedRevision: input.revision }
        : input.type === "delete" ? { expectedRevision: input.revision }
        : { expense: input.expense, expectedRevision: input.revision, ...(input.type === "create" ? { requestId: input.id } : {}) };
      return request<TripBudgetData>(`/api/trips/${tripId}/${path}`, { method, body: JSON.stringify(body) });
    },
    onSuccess: (data, _input, context) => {
      client.setQueryData<TripBudgetData>(context.key, current => current && current.revision > data.revision ? current : data);
      void client.invalidateQueries({ queryKey: TRIPS_KEY });
    },
    onError: (_error, _input, context) => { void client.invalidateQueries({ queryKey: context?.key ?? key }); },
  });
  return { query, mutation };
}
