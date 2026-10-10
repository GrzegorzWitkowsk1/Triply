import { useMutation, useQueryClient } from "@tanstack/react-query";
import { confirmTrip, generateTrip } from "../api/trips";
import { TRIPS_KEY, tripQueryKey } from "./useTrips";

export function useConfirmTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => confirmTrip(id),
    onSuccess: (trip) => {
      queryClient.setQueryData(tripQueryKey(trip.id), trip);
      void queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
    },
  });
}

export function useGenerateTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => generateTrip(id),
    onSuccess: (trip) => {
      queryClient.setQueryData(tripQueryKey(trip.id), trip);
      void queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
    },
    onError: (_error, id) => {
      void queryClient.invalidateQueries({ queryKey: tripQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
    },
  });
}
