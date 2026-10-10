import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TripDetail } from "@triply/shared";
import { ApiError } from "../api/client";
import { confirmTrip, generateTrip, getTrip } from "../api/trips";
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
    mutationFn: generateTripOnce,
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

const pendingGenerations = new Map<string, Promise<TripDetail>>();

// Share the request across effects, rapid clicks, and mounted observers.
export function generateTripOnce(id: string): Promise<TripDetail> {
  const pending = pendingGenerations.get(id);
  if (pending) return pending;

  const request = generateTrip(id)
    .catch(async (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        const trip = await getTrip(id);
        if (trip.status === "generating" || trip.status === "ready") return trip;
      }
      throw error;
    })
    .finally(() => pendingGenerations.delete(id));
  pendingGenerations.set(id, request);
  return request;
}
