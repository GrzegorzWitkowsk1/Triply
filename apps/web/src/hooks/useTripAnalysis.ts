import { getSelectedLanguage } from "../i18n";
import { GUEST_USAGE_KEY } from "./useGuestUsage";
import { TRIPS_KEY } from "./useTrips";
import { useQueryClient } from "@tanstack/react-query";
import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import type {
  AskableField,
  AnalyzeTripRequest,
  TripRequirementsAnswers,
} from "@triply/shared";
import { analyzeTrip, updateTripRequirements } from "../api/trips";

export function useAnalyzeTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: GUEST_USAGE_KEY }); },
    mutationFn: (input: AnalyzeTripRequest) => analyzeTrip({ ...input, locale: getSelectedLanguage() }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: TRIPS_KEY }); },
  });
}

export function useUpdateTripRequirements() {
  const queryClient = useQueryClient();
  return useMutation({
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: GUEST_USAGE_KEY }); },
    mutationFn: (input: {
      draftId: string;
      regenerate?: boolean;
      answers: TripRequirementsAnswers;
      confirmedFields: AskableField[];
    }) => updateTripRequirements(input.draftId, input),
  });
}
