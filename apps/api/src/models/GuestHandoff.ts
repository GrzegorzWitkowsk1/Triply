import mongoose from "mongoose";

export interface GuestHandoff {
  _id: string;
  state: "active" | "pending" | "completed" | "discarded" | "expired";
  activeRequests: string[];
  contextId?: string;
  userId?: string;
  sessionHash?: string;
  expiresAt?: Date;
  importedCount?: number;
  empty?: boolean;
  cleanupAt: Date;
}
export const handoffs = () => mongoose.connection.db!.collection<GuestHandoff>("guest_handoffs", {
  writeConcern: { w: "majority", wtimeoutMS: 5_000 },
});
export const handoffRetention = () => new Date(Date.now() + 30 * 86400_000);
export async function prepareGuestHandoffs(): Promise<void> {
  await handoffs().createIndex({ contextId: 1 }, { unique: true, partialFilterExpression: { contextId: { $type: "string" } } });
  await handoffs().createIndex({ cleanupAt: 1 }, { expireAfterSeconds: 0 });
}
export async function guestIsRetired(guestId: string): Promise<boolean> {
  return Boolean(await handoffs().findOne({ _id: guestId, state: { $ne: "active" } }, { projection: { _id: 1 } }));
}
export async function ensureGuestHandoff(guestId: string): Promise<void> {
  try {
    await handoffs().updateOne({ _id: guestId }, { $setOnInsert: { state: "active", activeRequests: [], cleanupAt: handoffRetention() } }, { upsert: true });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
  }
}
