import type {
  AskableField,
  TripAnalysisResult,
  TripRequirementsAnswers,
  UpdateTripRequirements,
} from "@triply/shared";
import { request } from "./client";

export type { TripAnalysisResult };

export function analyzeTrip(input: {
  prompt: string;
  badges: string[];
}): Promise<TripAnalysisResult> {
  return request<TripAnalysisResult>("/api/trips/analyze", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTripRequirements(
  draftId: string,
  input: {
    answers: TripRequirementsAnswers;
    confirmedFields: AskableField[];
  },
): Promise<TripAnalysisResult> {
  const payload: UpdateTripRequirements = input;

  return request<TripAnalysisResult>(`/api/trips/${draftId}/requirements`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}