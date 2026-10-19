import type mongoose from "mongoose";
import { isDate } from "node:util/types";
import { attractionKeySchema, destinationIdSchema, savedAttractionSnapshotSchema, type GuestMigrationReceipt, type SavedAttractionSnapshot } from "@triply/shared";
import { SavedDestinationModel } from "../models/SavedDestination.js";
import { SavedAttractionModel } from "../models/SavedAttraction.js";

async function* batches<T>(rows: AsyncIterable<T>) {
  let batch: T[] = [];
  for await (const row of rows) {
    batch.push(row);
    if (batch.length === 100) { yield batch; batch = []; }
  }
  if (batch.length) yield batch;
}

/** Use only inside the existing authorized handoff transaction. No provider calls. */
export async function transferSaved(guestId: string, userId: string, session: mongoose.mongo.ClientSession): Promise<Omit<GuestMigrationReceipt, "importedCount">> {
  const source = { ownerType: "guest", ownerId: guestId };
  const target = { ownerType: "user", ownerId: userId };
  const receipt = { importedDestinationCount: 0, importedAttractionCount: 0, mergedDestinationCount: 0, mergedAttractionCount: 0 };
  // Sequential operations on the shared transaction session; bounded per-record documents.
  for await (const rows of batches(SavedDestinationModel.collection.find(source, { session }).sort({ destinationId: 1 }))) {
    const existingRows = await SavedDestinationModel.collection.find({ ...target, destinationId: { $in: rows.map(row => row.destinationId) } }, { session }).toArray();
    const existingByKey = new Map(existingRows.map(row => [row.destinationId, row]));
    // The unique owner/key index makes concurrent account saves safe.
    // An E11000 aborts this transaction and the entire handoff retries from a new snapshot.
    await SavedDestinationModel.collection.bulkWrite(rows.map(row => {
      if (!destinationIdSchema.safeParse(row.destinationId).success) throw new Error("Invalid stored saved destination");
      const key = { ...target, destinationId: row.destinationId };
      const existing = existingByKey.get(row.destinationId);
      if (existing) receipt.mergedDestinationCount++;
      return { updateOne: { filter: existing ? key : { _id: row._id, ...source },
        update: { $set: { ...(existing ? {} : target), createdAt: earliestSavedAt(existing?.createdAt, row.createdAt) } } } };
    }), { session, ordered: true });
    await SavedDestinationModel.collection.deleteMany({ ...source, _id: { $in: rows.map(row => row._id) } }, { session });
    receipt.importedDestinationCount += rows.length;
  }
  for await (const rows of batches(SavedAttractionModel.collection.find(source, { session }).sort({ attractionKey: 1 }))) {
    const existingRows = await SavedAttractionModel.collection.find({ ...target, attractionKey: { $in: rows.map(row => row.attractionKey) } }, { session }).toArray();
    const existingByKey = new Map(existingRows.map(row => [row.attractionKey, row]));
    await SavedAttractionModel.collection.bulkWrite(rows.map(row => {
      if (!attractionKeySchema.safeParse(row.attractionKey).success || !["overpass", "geoapify", "unknown"].includes(row.provider) ||
          (row.providerPlaceId !== undefined && (typeof row.providerPlaceId !== "string" || row.providerPlaceId.length > 2000))) throw new Error("Invalid stored attraction identity");
      const snapshot = savedAttractionSnapshotSchema.parse(row.snapshot);
      const key = { ...target, attractionKey: row.attractionKey };
      const existing = existingByKey.get(row.attractionKey);
      const previous = savedAttractionSnapshotSchema.safeParse(existing?.snapshot);
      const merged = previous.success ? mergeSnapshot(previous.data, snapshot) : snapshot;
      const provider = existing && ["overpass", "geoapify"].includes(existing.provider) ? existing.provider : row.provider;
      const providerPlaceId = existing?.providerPlaceId?.trim() || row.providerPlaceId;
      if (existing) receipt.mergedAttractionCount++;
      return { updateOne: { filter: existing ? key : { _id: row._id, ...source }, update: {
        $set: { ...(existing ? {} : target), createdAt: earliestSavedAt(existing?.createdAt, row.createdAt), snapshot: merged, provider,
          ...(providerPlaceId ? { providerPlaceId } : {}) },
      } } };
    }), { session, ordered: true });
    await SavedAttractionModel.collection.deleteMany({ ...source, _id: { $in: rows.map(row => row._id) } }, { session });
    receipt.importedAttractionCount += rows.length;
  }
  return receipt;
}

export function earliestSavedAt(...values: unknown[]): Date {
  const times = values.filter((value): value is Date => isDate(value) && Number.isFinite(value.getTime())).map(value => value.getTime());
  return new Date(times.length ? Math.min(...times) : Date.now());
}
/** Account data wins non-empty conflicts; fill gaps only, retaining coordinate pairs. */
export function mergeSnapshot(account: SavedAttractionSnapshot, guest: SavedAttractionSnapshot): SavedAttractionSnapshot {
  const merged = { ...account };
  for (const field of ["destinationName", "country", "address", "description", "image"] as const) {
    if (!merged[field]?.trim() && guest[field]?.trim()) merged[field] = guest[field];
  }
  return savedAttractionSnapshotSchema.parse(merged);
}
