import { ownerFilter } from "../middleware/tripIdentity.js";
import { Types } from "mongoose";
import type { CreateTripEquipmentItem, TripEquipmentItem, UpdateTripEquipmentItem } from "@triply/shared";
import { LIMITS } from "@triply/shared";
import { TripModel, type TripDocument } from "../models/Trip.js";

export const TRIP_NOT_FOUND = "Trip not found";
export const ITEM_NOT_FOUND = "Equipment item not found";
export const LIST_FULL = "This packing list is full. Remove an item before adding another.";

export type EquipmentFailure = "trip-not-found" | "item-not-found" | "list-full";

export class EquipmentError extends Error {
  readonly status: number;
  readonly expose = true;
  readonly reason: EquipmentFailure;

  constructor(reason: EquipmentFailure, message: string, status: number) {
    super(message);
    this.name = "EquipmentError";
    this.reason = reason;
    this.status = status;
  }
}

function findOwnedTrip(tripId: string, userId: string): Promise<TripDocument | null> {
  return TripModel.findOne({
    _id: new Types.ObjectId(tripId),
    ...ownerFilter(userId),
  }).exec();
}

function indexOfItem(trip: TripDocument, itemId: string): number {
  return trip.equipment.findIndex((entry) => entry._id.toString() === itemId);
}

export async function getEquipment(tripId: string, userId: string): Promise<TripEquipmentItem[]> {
  const trip = await findOwnedTrip(tripId, userId);

  if (!trip) {
    throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
  }

  return trip.equipment.map((entry) => ({
    id: entry._id.toString(),
    name: entry.name,
    count: entry.count,
  }));
}

export async function addEquipmentItem(
  tripId: string,
  userId: string,
  input: CreateTripEquipmentItem,
): Promise<TripEquipmentItem> {
  const trip = await findOwnedTrip(tripId, userId);

  if (!trip) {
    throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
  }

  if (trip.equipment.length >= LIMITS.equipment) {
    throw new EquipmentError("list-full", LIST_FULL, 400);
  }

  trip.equipment.push({ name: input.name, count: input.count });
  await trip.save();

  const entry = trip.equipment[trip.equipment.length - 1];

  return { id: entry._id.toString(), name: entry.name, count: entry.count };
}

export async function updateEquipmentItem(
  tripId: string,
  userId: string,
  itemId: string,
  input: UpdateTripEquipmentItem,
): Promise<TripEquipmentItem> {
  const trip = await findOwnedTrip(tripId, userId);

  if (!trip) {
    throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
  }

  const index = indexOfItem(trip, itemId);

  if (index === -1) {
    throw new EquipmentError("item-not-found", ITEM_NOT_FOUND, 404);
  }

  const entry = trip.equipment[index];

  if (input.name !== undefined) {
    entry.name = input.name;
  }

  if (input.count !== undefined) {
    entry.count = input.count;
  }

  await trip.save();

  return { id: entry._id.toString(), name: entry.name, count: entry.count };
}

export async function deleteEquipmentItem(
  tripId: string,
  userId: string,
  itemId: string,
): Promise<void> {
  const trip = await findOwnedTrip(tripId, userId);

  if (!trip) {
    throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
  }

  const index = indexOfItem(trip, itemId);

  if (index === -1) {
    throw new EquipmentError("item-not-found", ITEM_NOT_FOUND, 404);
  }

  trip.equipment.splice(index, 1);
  await trip.save();
}