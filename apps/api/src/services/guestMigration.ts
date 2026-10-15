import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import type { FastifyRequest } from "fastify";
import type { GuestMigrationResult, GuestMigrationStatus } from "@triply/shared";
import { ensureGuestHandoff, handoffs, handoffRetention } from "../models/GuestHandoff.js";
import { TripModel } from "../models/Trip.js";
import { getSessionGuest, newSession, regenerateSession, saveSession, setSessionUserId, storageId } from "../config/session.js";
import { sessionContents } from "../config/mongoSession.js";
import { currentUserId } from "../middleware/auth.js";

export const MIGRATION_WINDOW_MS = 15 * 60_000;
const hashSession = (id: string) => createHash("sha256").update(id).digest("hex");
export class MigrationError extends Error {
  readonly expose = true;
  constructor(message: string, readonly status: number) { super(message); }
}

/** Audited persistence boundary; the test harness can inject a transaction interruption here. */
export const migrationWrites = {
  transfer(guestId: string, userId: string, session: mongoose.mongo.ClientSession) {
    return TripModel.collection.updateMany({ guestId, user: null }, {
      $set: { user: new mongoose.Types.ObjectId(userId) }, $unset: { guestId: "", guestSlot: "" },
    }, { session });
  },
};

/** Called only after credential validation; no source/destination is accepted from a client. */
export async function authenticateWithGuestHandoff(request: FastifyRequest, userId: string): Promise<void> {
  const guest = getSessionGuest(request);
  const previous = request.triplySession;
  if (!guest || !previous) {
    await regenerateSession(request); setSessionUserId(request, userId); await saveSession(request);
    return;
  }
  // Recheck expiry/revocation after password hashing/verification.
  if (!await request.server.triplySessionStore.get(storageId(previous.id))) {
    request.triplySession = null;
    throw new MigrationError("Your guest session changed or expired. Refresh the page before signing in again.", 409);
  }
  const next = newSession();
  next.data.userId = userId;
  const contextId = randomBytes(32).toString("hex");
  next.data.guestMigrationId = contextId;
  await ensureGuestHandoff(guest.id);
  const claimed = await handoffs().updateOne({ _id: guest.id, state: "active" }, { $set: {
    state: "pending", contextId, userId, sessionHash: hashSession(next.id),
    expiresAt: new Date(Date.now() + MIGRATION_WINDOW_MS), cleanupAt: handoffRetention(),
  } });
  if (claimed.modifiedCount !== 1) {
    // A stale response must not overwrite the winning tab's authenticated cookie.
    request.triplySession = null;
    throw new MigrationError("Sign-in has already started in another tab. Refresh this page to continue.", 409);
  }
  try {
    await request.server.triplySessionStore.save(next.id, next.data);
  } catch (error) {
    // This fresh secret has never been sent to the browser. Cancel its handoff.
    await handoffs().updateOne({ _id: guest.id, contextId, state: "pending" }, {
      $set: { state: "active" }, $unset: { contextId: "", userId: "", sessionHash: "", expiresAt: "" },
    });
    throw error;
  }
  next.savedContents = sessionContents(next.data);
  request.triplySession = next;
  // The durable fence already revokes access even if session deletion is interrupted.
  try { await request.server.triplySessionStore.destroy(storageId(previous.id)); }
  catch { console.warn("[guest-migration] retired session cleanup deferred to expiry"); }
}

function binding(request: FastifyRequest) {
  const session = request.triplySession;
  if (!session?.data.guestMigrationId) return null;
  return { contextId: session.data.guestMigrationId, userId: currentUserId(request), sessionHash: hashSession(session.id) };
}
export async function migrationStatus(request: FastifyRequest): Promise<GuestMigrationStatus> {
  const filter = binding(request);
  if (!filter) return { status: "none" };
  let context = await handoffs().findOne(filter);
  if (!context) return { status: "expired" };
  if (context.state === "completed") return { status: "completed", importedCount: context.importedCount ?? 0 };
  if (context.state === "discarded") return { status: context.empty ? "none" : "discarded" };
  if (context.state === "expired" || !context.expiresAt || context.expiresAt.getTime() <= Date.now()) {
    await handoffs().updateOne({ ...filter, state: "pending" }, { $set: { state: "expired" } });
    return { status: "expired" };
  }
  const tripCount = await TripModel.countDocuments({ guestId: context._id, user: null });
  const busy = context.activeRequests.length > 0;
  if (!tripCount && !busy) {
    context = await handoffs().findOneAndUpdate({ ...filter, state: "pending", activeRequests: { $size: 0 } },
      { $set: { state: "discarded", empty: true } }, { returnDocument: "after" });
    if (context) return { status: "none" };
    // Confirmation/discard may have won while the empty-source status was read.
    return migrationStatus(request);
  }
  return { status: "pending", tripCount, expiresAt: context?.expiresAt?.toISOString() ?? "", busy };
}

export async function confirmMigration(request: FastifyRequest): Promise<GuestMigrationResult> {
  const filter = binding(request);
  if (!filter) throw new MigrationError("There is no guest import available in this sign-in session.", 403);
  const transaction = await mongoose.startSession();
  try {
    return await transaction.withTransaction(async () => {
      const context = await handoffs().findOne(filter, { session: transaction });
      if (!context) throw new MigrationError("This guest import is no longer available.", 403);
      if (context.state === "completed") return { importedCount: context.importedCount ?? 0, alreadyImported: true };
      if (context.state !== "pending" || !context.expiresAt || context.expiresAt.getTime() <= Date.now()) {
        throw new MigrationError("This guest import has expired or was discarded. Your guest trips have not been deleted.", 410);
      }
      if (context.activeRequests.length) throw new MigrationError("Your last guest operation is still finishing. Please try importing again in a moment.", 409);
      // Touch the fence in the same transaction as the trip updates and receipt.
      const locked = await handoffs().updateOne({ ...filter, state: "pending", activeRequests: { $size: 0 } },
        { $set: { state: "completed" } }, { session: transaction });
      if (!locked.modifiedCount) throw new MigrationError("Import state changed. Check its status and try again.", 409);
      // Deliberately bypass immutable guest fields only in this authorized transaction.
      // Native updates preserve every other field, including timestamps, sharing and itineraryVersion.
      const moved = await migrationWrites.transfer(context._id, filter.userId, transaction);
      await handoffs().updateOne(filter, { $set: { importedCount: moved.modifiedCount } }, { session: transaction });
      return { importedCount: moved.modifiedCount, alreadyImported: false };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10_000 });
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError("Import could not finish safely. Your trips are preserved. Check the import status and try again.", 503);
  } finally { await transaction.endSession(); }
}

export async function discardMigration(request: FastifyRequest): Promise<GuestMigrationStatus> {
  const filter = binding(request);
  if (!filter) throw new MigrationError("There is no guest import available in this sign-in session.", 403);
  const context = await handoffs().findOneAndUpdate({ ...filter, state: "pending" }, { $set: { state: "discarded" } }, { returnDocument: "after" });
  if (!context && !await handoffs().findOne(filter)) throw new MigrationError("This import context is unavailable.", 403);
  return migrationStatus(request);
}
