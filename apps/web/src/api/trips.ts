import type {
  AskableField,
  TripAnalysisResult,
  TripDetail,
  TripRequirementsAnswers,
  TripStatus,
  TripSummary,
  UpdateTripRequirements,
} from "@triply/shared";
import { request } from "./client";

export type { TripAnalysisResult, TripDetail, TripStatus, TripSummary };

export function listTrips(params: { status?: TripStatus } = {}): Promise<TripSummary[]> {
  const query = new URLSearchParams();

  if (params.status) {
    query.set("status", params.status);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";

  return request<TripSummary[]>(`/api/trips${suffix}`);
}

export function getTrip(id: string): Promise<TripDetail> {
  return request<TripDetail>(`/api/trips/${id}`);
}

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