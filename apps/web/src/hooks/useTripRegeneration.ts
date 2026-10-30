import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import { GUEST_USAGE_KEY } from "./useGuestUsage";
import { useQueryClient } from "@tanstack/react-query";
import type { RegenerateDayRequest } from "@triply/shared";
import { applyRegeneratedDay, regenerateTripDay } from "../api/trips";
import { TRIPS_KEY, tripQueryKey } from "./useTrips";
import { cacheConfirmedTrip } from "../query/confirmedTrip";
import { ApiError } from "../api/client";

interface RegenerateDayVariables {
  tripId: string;
  dayIndex: number;
  request: RegenerateDayRequest;
}

export function useRegenerateDay() {
  const queryClient = useQueryClient();
  return useMutation({
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: GUEST_USAGE_KEY }); },
    mutationFn: ({ tripId, dayIndex, request }: RegenerateDayVariables) =>
      regenerateTripDay(tripId, dayIndex, request),
  });
}

interface ApplyRegenerationVariables {
  tripId: string;
  dayIndex: number;
  previewId: string;
}

export function useApplyRegeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: GUEST_USAGE_KEY }); },
    mutationFn: ({ tripId, dayIndex, previewId }: ApplyRegenerationVariables) =>
      applyRegeneratedDay(tripId, dayIndex, previewId),
    onSuccess: async (trip) => {
      await cacheConfirmedTrip(queryClient, trip);
      void queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
    },
    onError: (error, variables) => {
      if (error instanceof ApiError && (error.status === 409 || error.status === 410)) void queryClient.invalidateQueries({ queryKey: tripQueryKey(variables.tripId) });
    },
  });
}
