import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import {
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateTripEquipmentItem,
  TripEquipmentItem,
  UpdateTripEquipmentItem,
} from "@triply/shared";
import {
  createEquipmentItem,
  deleteEquipmentItem,
  getEquipment,
  updateEquipmentItem,
} from "../api/equipment";
import { TRIPS_KEY, tripQueryKey } from "./useTrips";

export const equipmentQueryKey = (tripId: string) =>
  [...TRIPS_KEY, tripId, "equipment"] as const;

export function useTripEquipment(tripId: string | undefined) {
  return useQuery({
    queryKey: equipmentQueryKey(tripId ?? ""),
    queryFn: async () => {
      const response = await getEquipment(tripId as string);

      return response.equipment;
    },
    enabled: Boolean(tripId),
  });
}

export function useCreateEquipmentItem(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTripEquipmentItem) =>
      createEquipmentItem(tripId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: equipmentQueryKey(tripId), exact: true });
      void queryClient.invalidateQueries({ queryKey: tripQueryKey(tripId), exact: true });
    },
  });
}

export function useUpdateEquipmentItem(tripId: string) {
  const queryClient = useQueryClient();
  const key = equipmentQueryKey(tripId);

  return useMutation({
    mutationFn: ({
      itemId,
      input,
    }: {
      itemId: string;
      input: UpdateTripEquipmentItem;
    }) => updateEquipmentItem(tripId, itemId, input),

    onMutate: async ({ itemId, input }) => {
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<TripEquipmentItem[]>(key);

      queryClient.setQueryData<TripEquipmentItem[]>(key, (current) =>
        current?.map((item) =>
          item.id === itemId ? { ...item, ...input } : item,
        ),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
      void queryClient.invalidateQueries({ queryKey: tripQueryKey(tripId), exact: true });
    },
  });
}

export function useDeleteEquipmentItem(tripId: string) {
  const queryClient = useQueryClient();
  const key = equipmentQueryKey(tripId);

  return useMutation({
    mutationFn: (itemId: string) => deleteEquipmentItem(tripId, itemId),

    onMutate: async (itemId) => {
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<TripEquipmentItem[]>(key);

      queryClient.setQueryData<TripEquipmentItem[]>(key, (current) =>
        current?.filter((item) => item.id !== itemId),
      );

      return { previous };
    },
    onError: (_error, _itemId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
      void queryClient.invalidateQueries({ queryKey: tripQueryKey(tripId), exact: true });
    },
  });
}
