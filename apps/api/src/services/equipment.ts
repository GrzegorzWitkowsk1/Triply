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
    category: entry.category ?? "other",
    packed: entry.packed ?? false,
    source: entry.source ?? "manual",
    ...(entry.source === "ai" && entry.reason ? { reason: entry.reason } : {}),
  }));
}

export async function addEquipmentItem(
  tripId: string,
  userId: string,
  input: CreateTripEquipmentItem,
): Promise<TripEquipmentItem> {
  const itemId = new Types.ObjectId();
  const trip = await TripModel.findOneAndUpdate({
    _id: new Types.ObjectId(tripId), ...ownerFilter(userId),
    $expr: { $lt: [{ $size: "$equipment" }, LIMITS.equipment] },
  }, { $push: { equipment: { _id: itemId, name: input.name, count: input.count, category: input.category ?? "other", packed: false } },
    $inc: { __v: 1 } }, { new: true, runValidators: true }).exec();
  if (!trip) {
    if (!await findOwnedTrip(tripId, userId)) throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
    throw new EquipmentError("list-full", LIST_FULL, 400);
  }
  const entry = trip.equipment.find(item => item._id.equals(itemId))!;

  return { id: entry._id.toString(), name: entry.name, count: entry.count, category: entry.category, packed: entry.packed, source: entry.source ?? "manual", ...(entry.source === "ai" && entry.reason ? { reason: entry.reason } : {}) };
}

export async function updateEquipmentItem(
  tripId: string,
  userId: string,
  itemId: string,
  input: UpdateTripEquipmentItem,
): Promise<TripEquipmentItem> {
  const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)
    .map(([key, value]) => [`equipment.$.${key}`, value]));
  const trip = await TripModel.findOneAndUpdate({ _id: new Types.ObjectId(tripId), ...ownerFilter(userId),
    "equipment._id": new Types.ObjectId(itemId) }, { $set: fields, $inc: { __v: 1 } }, { new: true, runValidators: true }).exec();
  if (!trip) {
    if (!await findOwnedTrip(tripId, userId)) throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
    throw new EquipmentError("item-not-found", ITEM_NOT_FOUND, 404);
  }
  const entry = trip.equipment[indexOfItem(trip, itemId)];

  return { id: entry._id.toString(), name: entry.name, count: entry.count, category: entry.category, packed: entry.packed, source: entry.source ?? "manual", ...(entry.source === "ai" && entry.reason ? { reason: entry.reason } : {}) };
}

export async function deleteEquipmentItem(
  tripId: string,
  userId: string,
  itemId: string,
): Promise<void> {
  const result = await TripModel.updateOne({ _id: new Types.ObjectId(tripId), ...ownerFilter(userId),
    "equipment._id": new Types.ObjectId(itemId) }, { $pull: { equipment: { _id: new Types.ObjectId(itemId) } }, $inc: { __v: 1 } }).exec();
  if (!result.matchedCount) {
    if (!await findOwnedTrip(tripId, userId)) throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
    throw new EquipmentError("item-not-found", ITEM_NOT_FOUND, 404);
  }
}

/** Explicit ID scope makes filters/collapsed categories a client concern, never an implicit "all" update. */
export async function bulkPackingItems(tripId: string, owner: string, input: import("@triply/shared").BulkPackingInput): Promise<import("@triply/shared").BulkPackingResult> {
  if (!Types.ObjectId.isValid(tripId)) throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
  const ids = input.itemIds.map(id => new Types.ObjectId(id));
  const trip = await TripModel.findOneAndUpdate({ _id: new Types.ObjectId(tripId), ...ownerFilter(owner), "equipment._id": { $all: ids } },
    { $set: { "equipment.$[selected].packed": input.packed }, $inc: { __v: 1 } },
    { new: true, runValidators: true, arrayFilters: [{ "selected._id": { $in: ids } }] }).exec();
  if (!trip) {
    if (!await findOwnedTrip(tripId, owner)) throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
    throw new EquipmentError("item-not-found", "Some selected items changed or no longer belong to this checklist. Reload and try again.", 409);
  }
  return { equipment: trip.equipment.map(entry => ({ id: entry._id.toString(), name: entry.name, count: entry.count,
    category: entry.category ?? "other", packed: entry.packed ?? false, source: entry.source ?? "manual",
    ...(entry.source === "ai" && entry.reason ? { reason: entry.reason } : {}) })), updatedCount: ids.length };
}
