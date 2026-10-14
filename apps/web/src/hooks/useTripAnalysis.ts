import { useMutation } from "@tanstack/react-query";
import type {
  AskableField,
  AnalyzeTripRequest,
  TripRequirementsAnswers,
} from "@triply/shared";
import { analyzeTrip, updateTripRequirements } from "../api/trips";

export function useAnalyzeTrip() {
  return useMutation({
    mutationFn: (input: AnalyzeTripRequest) => analyzeTrip(input),
  });
}

export function useUpdateTripRequirements() {
  return useMutation({
    mutationFn: (input: {
      draftId: string;
      regenerate?: boolean;
      answers: TripRequirementsAnswers;
      confirmedFields: AskableField[];
    }) => updateTripRequirements(input.draftId, input),
  });
}
