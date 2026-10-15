import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import { GUEST_USAGE_KEY } from "./useGuestUsage";
import { useQueryClient } from "@tanstack/react-query";
import type { RegenerateDayRequest } from "@triply/shared";
import { applyRegeneratedDay, regenerateTripDay } from "../api/trips";
import { TRIPS_KEY, tripQueryKey } from "./useTrips";

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
    onSuccess: (trip) => {
      queryClient.setQueryData(tripQueryKey(trip.id), trip);
      void queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
    },
  });
}