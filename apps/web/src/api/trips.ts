import type {
  AskableField,
  AnalyzeTripRequest,
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
import { analysisResponseSchema, editResponseSchema, previewResponseSchema, tripListResponseSchema, tripResponseSchema } from "./responses";

export function refreshTripWeather(id: string): Promise<TripWeatherRefresh> {
  return request<TripWeatherRefresh>(`/api/trips/${id}/weather/refresh`, { method: "POST" });
}
import type { ItineraryEditRequest, ItineraryEditResponse, ItineraryCandidatesResponse } from "@triply/shared";

export function editTripItinerary(tripId: string, input: ItineraryEditRequest) {
  return request<ItineraryEditResponse>(`/api/trips/${tripId}/itinerary/edit`, {
    method: "POST", body: JSON.stringify(input),
  }, editResponseSchema.refine(result => result.trip.id === tripId));
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

  return request<TripSummary[]>(`/api/trips${suffix}`, {}, tripListResponseSchema);
}

export function getTrip(id: string, options: { signal?: AbortSignal; snapshot?: boolean } = {}): Promise<TripDetail> {
  return request<TripDetail>(`/api/trips/${id}${options.snapshot ? "?snapshot=true" : ""}`, { signal: options.signal }, tripResponseSchema.refine(trip => trip.id === id));
}

export function analyzeTrip(input: AnalyzeTripRequest): Promise<TripAnalysisResult> {
  return request<TripAnalysisResult>("/api/trips/analyze", {
    method: "POST",
    body: JSON.stringify(input),
  }, analysisResponseSchema);
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
  }, analysisResponseSchema);
}

export function confirmTrip(id: string): Promise<TripDetail> {
  return request<TripDetail>(`/api/trips/${id}/confirm`, {
    method: "POST",
  }, tripResponseSchema.refine(trip => trip.id === id));
}

export function generateTrip(id: string): Promise<TripDetail> {
  return request<TripDetail>(`/api/trips/${id}/generate`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
  }, tripResponseSchema.refine(trip => trip.id === id));
}

export function regenerateTripDay(
  tripId: string,
  dayIndex: number,
  input: RegenerateDayRequest,
): Promise<RegenerateDayPreview> {
  return request<RegenerateDayPreview>(`/api/trips/${tripId}/days/${dayIndex}/regenerate`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(input),
  }, previewResponseSchema.refine(preview => preview.tripId === tripId && preview.dayIndex === dayIndex));
}

export function deleteTrip(id: string): Promise<void> {
  return request<void>(`/api/trips/${id}`, { method: "DELETE" });
}

export function applyRegeneratedDay(
  tripId: string,
  dayIndex: number,
  previewId: string,
): Promise<TripDetail> {
  return request<TripDetail>(`/api/trips/${tripId}/days/${dayIndex}/apply`, {
    method: "POST",
    body: JSON.stringify({ previewId }),
  }, tripResponseSchema.refine(trip => trip.id === tripId));
}
export function updateTripVisit(tripId: string, itemId: string, status: import("@triply/shared").VisitStatus) {
  return request<import("@triply/shared").VisitMutationResponse>(`/api/trips/${tripId}/visits/${itemId}`, { method: "PATCH", body: JSON.stringify({ status }) }, tripResponseSchema.refine(trip => trip.id === tripId));
}

export function retryTripVisitExpense(tripId: string, itemId: string) {
  return request<import("@triply/shared").VisitMutationResponse>(`/api/trips/${tripId}/visits/${itemId}/expense/retry`, { method: "POST" }, tripResponseSchema.refine(trip => trip.id === tripId));
}
