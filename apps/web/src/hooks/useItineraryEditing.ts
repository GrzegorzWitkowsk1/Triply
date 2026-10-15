import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import { useQueryClient } from "@tanstack/react-query";
import type { ItineraryEditRequest } from "@triply/shared";
import { editTripItinerary } from "../api/trips";
import { ApiError } from "../api/client";
import { TRIPS_KEY, tripQueryKey } from "./useTrips";

export function useItineraryEditing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, ...request }: ItineraryEditRequest & { tripId: string }) => editTripItinerary(tripId, request),
    onSuccess: (result) => {
      void client.cancelQueries({ queryKey: tripQueryKey(result.trip.id) });
      client.setQueryData(tripQueryKey(result.trip.id), result.trip);
      void client.invalidateQueries({ queryKey: TRIPS_KEY });
      void client.invalidateQueries({ queryKey: ["itinerary-candidates", result.trip.id] });
    },
    onError: (error, variables) => {
      if (error instanceof ApiError && error.status === 409) {
        void client.invalidateQueries({ queryKey: tripQueryKey(variables.tripId) });
      }
    },
  });
}
