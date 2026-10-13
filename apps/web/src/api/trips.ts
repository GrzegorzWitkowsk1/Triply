import type {
  AskableField,
  RegenerateDayPreview,
  RegenerateDayRequest,
  TripAnalysisResult,
  TripDetail,
  TripRequirementsAnswers,
  TripStatus,
  TripSummary,
  TripWeatherRefresh,
  UpdateTripRequirements,
} from "@triply/shared";
import { request } from "./client";

export function refreshTripWeather(id: string): Promise<TripWeatherRefresh> {
  return request<TripWeatherRefresh>(`/api/trips/${id}/weather/refresh`, { method: "POST" });
}
import type { ItineraryEditRequest, ItineraryEditResponse, ItineraryCandidatesResponse } from "@triply/shared";

export function editTripItinerary(tripId: string, input: ItineraryEditRequest) {
  return request<ItineraryEditResponse>(`/api/trips/${tripId}/itinerary/edit`, {
    method: "POST", body: JSON.stringify(input),
  });
}

export function getItineraryCandidates(tripId: string, search = "", discover = false) {
  return request<ItineraryCandidatesResponse>(`/api/trips/${tripId}/itinerary/candidates`, {
    method: "POST", body: JSON.stringify({ search, discover }),
  });
}

export type { RegenerateDayPreview, TripAnalysisResult, TripDetail, TripStatus, TripSummary };

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
    regenerate?: boolean;
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

export function confirmTrip(id: string): Promise<TripDetail> {
  return request<TripDetail>(`/api/trips/${id}/confirm`, {
    method: "POST",
  });
}

export function generateTrip(id: string): Promise<TripDetail> {
  return request<TripDetail>(`/api/trips/${id}/generate`, {
    method: "POST",
  });
}

export function regenerateTripDay(
  tripId: string,
  dayIndex: number,
  input: RegenerateDayRequest,
): Promise<RegenerateDayPreview> {
  return request<RegenerateDayPreview>(`/api/trips/${tripId}/days/${dayIndex}/regenerate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function applyRegeneratedDay(
  tripId: string,
  dayIndex: number,
  previewId: string,
): Promise<TripDetail> {
  return request<TripDetail>(`/api/trips/${tripId}/days/${dayIndex}/apply`, {
    method: "POST",
    body: JSON.stringify({ previewId }),
  });
}
