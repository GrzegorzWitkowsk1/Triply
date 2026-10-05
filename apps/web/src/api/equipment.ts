import type {
  CreateTripEquipmentItem,
  TripEquipmentItem,
  TripEquipmentResponse,
  UpdateTripEquipmentItem,
} from "@triply/shared";
import { request } from "./client";

export type { TripEquipmentItem, TripEquipmentResponse };

export function getEquipment(tripId: string): Promise<TripEquipmentResponse> {
  return request<TripEquipmentResponse>(`/api/trips/${tripId}/equipment`);
}

export function createEquipmentItem(
  tripId: string,
  input: CreateTripEquipmentItem,
): Promise<TripEquipmentItem> {
  const payload: CreateTripEquipmentItem = input;

  return request<TripEquipmentItem>(`/api/trips/${tripId}/equipment`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateEquipmentItem(
  tripId: string,
  itemId: string,
  input: UpdateTripEquipmentItem,
): Promise<TripEquipmentItem> {
  const payload: UpdateTripEquipmentItem = input;

  return request<TripEquipmentItem>(
    `/api/trips/${tripId}/equipment/${itemId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export function deleteEquipmentItem(tripId: string, itemId: string): Promise<void> {
  return request<void>(`/api/trips/${tripId}/equipment/${itemId}`, {
    method: "DELETE",
  });
}