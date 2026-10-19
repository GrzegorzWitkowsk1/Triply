import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import type { FastifyRequest } from "fastify";
import type { GuestMigrationResult, GuestMigrationStatus, GuestMigrationReceipt } from "@triply/shared";
import type { GuestHandoff } from "../models/GuestHandoff.js";
import { transferSaved } from "./savedMigration.js";
import { SavedDestinationModel } from "../models/SavedDestination.js";
import { SavedAttractionModel } from "../models/SavedAttraction.js";
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
  transferSaved,
  transfer(guestId: string, userId: string, session: mongoose.mongo.ClientSession) {
    return TripModel.collection.updateMany({ guestId, user: null }, {
      $set: { user: new mongoose.Types.ObjectId(userId) }, $unset: { guestId: "", guestSlot: "" },
    }, { session });
  },
};

function receipt(context: Partial<GuestHandoff>): GuestMigrationReceipt {
  return { importedCount: context.importedCount ?? 0, importedDestinationCount: context.importedDestinationCount ?? 0,
    importedAttractionCount: context.importedAttractionCount ?? 0, mergedDestinationCount: context.mergedDestinationCount ?? 0,
    mergedAttractionCount: context.mergedAttractionCount ?? 0 };
}

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
  if (context.state === "completed") return { status: "completed", ...receipt(context) };
  if (context.state === "discarded") return { status: context.empty ? "none" : "discarded" };
  if (context.state === "expired" || !context.expiresAt || context.expiresAt.getTime() <= Date.now()) {
    await handoffs().updateOne({ ...filter, state: "pending" }, { $set: { state: "expired" } });
    return { status: "expired" };
  }
  const tripCount = await TripModel.countDocuments({ guestId: context._id, user: null });
  const owner = { ownerType: "guest", ownerId: context._id };
  const [destinationCount, attractionCount] = await Promise.all([
    SavedDestinationModel.countDocuments(owner), SavedAttractionModel.countDocuments(owner),
  ]);
  const busy = context.activeRequests.length > 0;
  if (!tripCount && !destinationCount && !attractionCount && !busy) {
    context = await handoffs().findOneAndUpdate({ ...filter, state: "pending", activeRequests: { $size: 0 } },
      { $set: { state: "discarded", empty: true } }, { returnDocument: "after" });
    if (context) return { status: "none" };
    // Confirmation/discard may have won while the empty-source status was read.
    return migrationStatus(request);
  }
  return { status: "pending", tripCount, destinationCount, attractionCount, expiresAt: context?.expiresAt?.toISOString() ?? "", busy };
}

export async function confirmMigration(request: FastifyRequest): Promise<GuestMigrationResult> {
  const filter = binding(request);
  if (!filter) throw new MigrationError("There is no guest import available in this sign-in session.", 403);
  const transaction = await mongoose.startSession();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transaction.withTransaction(async () => {
          const context = await handoffs().findOne(filter, { session: transaction });
          if (!context) throw new MigrationError("This guest import is no longer available.", 403);
          if (context.state === "completed") return { ...receipt(context), alreadyImported: true };
          if (context.state !== "pending" || !context.expiresAt || context.expiresAt.getTime() <= Date.now()) {
            throw new MigrationError("This guest import has expired or was discarded. Your guest data has not been deleted.", 410);
          }
          if (context.activeRequests.length) throw new MigrationError("Your last guest operation is still finishing. Please try importing again in a moment.", 409);
          // Touch the fence in the same transaction as all resource updates and the receipt.
          const locked = await handoffs().updateOne({ ...filter, state: "pending", activeRequests: { $size: 0 } },
            { $set: { state: "completed" } }, { session: transaction });
          if (!locked.modifiedCount) throw new MigrationError("Import state changed. Check its status and try again.", 409);
          // Deliberately bypass immutable ownership fields only in this authorized transaction.
          const moved = await migrationWrites.transfer(context._id, filter.userId, transaction);
          const saved = await migrationWrites.transferSaved(context._id, filter.userId, transaction);
          const result = { importedCount: moved.modifiedCount, ...saved };
          await handoffs().updateOne(filter, { $set: result }, { session: transaction });
          return { ...result, alreadyImported: false };
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10_000 });
      } catch (error) {
        // Concurrent account upserts can raise E11000 rather than a transient transaction label.
        if (attempt < 2 && error && typeof error === "object" && "code" in error && error.code === 11000) continue;
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError("Import could not finish safely. Your guest data is preserved. Check the import status and try again.", 503);
  } finally { await transaction.endSession(); }
}

export async function discardMigration(request: FastifyRequest): Promise<GuestMigrationStatus> {
  const filter = binding(request);
  if (!filter) throw new MigrationError("There is no guest import available in this sign-in session.", 403);
  const context = await handoffs().findOneAndUpdate({ ...filter, state: "pending" }, { $set: { state: "discarded" } }, { returnDocument: "after" });
  if (!context && !await handoffs().findOne(filter)) throw new MigrationError("This import context is unavailable.", 403);
  return migrationStatus(request);
}
