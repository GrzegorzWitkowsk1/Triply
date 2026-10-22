import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApplyPackingSuggestions, BulkPackingInput, TripEquipmentItem } from "@triply/shared";
import { applyPackingPreview, generatePackingPreview, getPackingContext, bulkPacking } from "../api/packing";
import { useIdentityMutation } from "./useIdentityMutation";
import { equipmentQueryKey } from "./useTripEquipment";

export const packingContextQueryKey = (tripId: string) => [...equipmentQueryKey(tripId), "context"] as const;
export function usePackingContext(tripId: string) {
  return useQuery({ queryKey: packingContextQueryKey(tripId), queryFn: ({ signal }) => getPackingContext(tripId, signal),
    staleTime: 0, refetchInterval: 30_000 });
}
export function usePackingGeneration(tripId: string) {
  const client = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [tripId]);
  const mutation = useIdentityMutation({ mutationFn: () => {
    controller.current?.abort();
    controller.current = new AbortController();
    return generatePackingPreview(tripId, controller.current.signal);
  }, onSuccess: async () => { await Promise.all([
    client.invalidateQueries({ queryKey: packingContextQueryKey(tripId), exact: true }),
    client.invalidateQueries({ queryKey: equipmentQueryKey(tripId), exact: true }),
  ]); } });
  return { ...mutation, cancel: () => controller.current?.abort() };
}
export function useApplyPacking(tripId: string) {
  const client = useQueryClient();
  return useIdentityMutation({
    mutationFn: (input: ApplyPackingSuggestions) => applyPackingPreview(tripId, input),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: equipmentQueryKey(tripId), exact: true }); },
    onError: async () => { await client.invalidateQueries({ queryKey: packingContextQueryKey(tripId), exact: true }); },
  });
}

export function useBulkPacking(tripId: string) {
  const client = useQueryClient();
  const key = equipmentQueryKey(tripId);
  return useIdentityMutation({
    mutationFn: (input: BulkPackingInput) => bulkPacking(tripId, input),
    onMutate: async input => {
      await client.cancelQueries({ queryKey: key, exact: true });
      const previous = client.getQueryData<TripEquipmentItem[]>(key);
      const ids = new Set(input.itemIds);
      client.setQueryData<TripEquipmentItem[]>(key, current => current?.map(item => ids.has(item.id) ? { ...item, packed: input.packed } : item));
      return { previous };
    },
    onError: (_error, _input, context) => { if (context?.previous) client.setQueryData(key, context.previous); },
    onSettled: async () => { await client.invalidateQueries({ queryKey: key, exact: true }); },
  });
}
