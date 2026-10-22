import { applyPackingSuggestionsSchema, packingPreviewSchema, packingContextStatusSchema, type BulkPackingInput, type BulkPackingResult, type ApplyPackingSuggestions, type PackingApplyResult } from "@triply/shared";
import { request, requestWithTimeout } from "./client";

export async function generatePackingPreview(tripId: string, signal: AbortSignal) {
  const raw = await requestWithTimeout<unknown>(`/api/trips/${tripId}/equipment/generate`, {
    method: "POST", body: "{}", signal, headers: { "Idempotency-Key": crypto.randomUUID() },
  }, 100_000);
  return packingPreviewSchema.parse(raw);
}
export async function getPackingContext(tripId: string, signal?: AbortSignal) {
  return packingContextStatusSchema.parse(await request<unknown>(`/api/trips/${tripId}/equipment/context`, { signal }));
}
export function bulkPacking(tripId: string, input: BulkPackingInput) {
  return request<BulkPackingResult>(`/api/trips/${tripId}/equipment/bulk`, { method: "PATCH", body: JSON.stringify(input) });
}
export function applyPackingPreview(tripId: string, input: ApplyPackingSuggestions) {
  return request<PackingApplyResult>(`/api/trips/${tripId}/equipment/apply`, {
    method: "POST", body: JSON.stringify(applyPackingSuggestionsSchema.parse(input)),
  });
}
