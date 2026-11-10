import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import mongoose from "mongoose";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ensureGuestHandoff, handoffs, handoffRetention } from "../models/GuestHandoff.js";

declare module "fastify" { interface FastifyRequest { guestActivity: { guestId: string; id: string } | null; } }
export const GUEST_ACTIVITY_MS = 5 * 60_000;
const activity = new AsyncLocalStorage<FastifyRequest["guestActivity"]>();
/** Auditable commit boundary; kept explicit so races can be controlled in tests. */
export const guestActivityWrites = {
  check(lease: NonNullable<FastifyRequest["guestActivity"]>, session: mongoose.mongo.ClientSession) {
    return handoffs().updateOne({ _id: lease.guestId, state: { $in: ["active", "pending"] },
      activeRequests: { $elemMatch: { id: lease.id, expiresAt: { $gt: new Date(Date.now()) } } },
    }, { $inc: { writeRevision: 1 } }, { session });
  },
};
export class GuestActivityError extends Error {
  readonly expose = true;
  constructor(message = "Your guest operation expired or sign-in has finished. Refresh the page before trying again.", readonly status = 409) { super(message); }
}

/** Legacy bare markers get one bounded drain period, never renewed by later observers. */
export async function recoverGuestActivity(guestId: string): Promise<void> {
  const now = new Date(Date.now());
  await handoffs().updateOne({ _id: guestId }, [{ $set: { activeRequests: {
    $filter: { input: { $map: { input: "$activeRequests", as: "lease", in: {
      $cond: [{ $eq: [{ $type: "$$lease" }, "string"] },
        { id: "$$lease", expiresAt: new Date(now.getTime() + GUEST_ACTIVITY_MS) }, "$$lease"],
    } } }, as: "lease", cond: { $gt: ["$$lease.expiresAt", now] } },
  } } }]);
}

/** Only database work belongs here: lease validation and persistence commit together.
 * The handoff write conflicts with migration's transaction, including across instances.
 */
export async function guestWrite<T>(work: (session: mongoose.mongo.ClientSession | null) => PromiseLike<T>): Promise<T> {
  const lease = activity.getStore();
  if (!lease) return await work(null);
  try {
    // Mongoose also restores document save state if a transaction is retried.
    return await mongoose.connection.transaction(async session => {
      const valid = await guestActivityWrites.check(lease, session);
      if (!valid.modifiedCount) throw new GuestActivityError();
      return await work(session);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10_000 });
  } catch (error) {
    if (error instanceof GuestActivityError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === 11000) throw error;
    // No fallback write on standalone MongoDB or uncertain transaction outcomes.
    throw new GuestActivityError("Your guest operation could not be saved safely. Refresh the page and try again.", 503);
  }
}
export async function acquireGuestActivity(request: FastifyRequest, guestId: string): Promise<boolean> {
  await ensureGuestHandoff(guestId);
  const id = randomUUID();
  const acquired = await handoffs().updateOne({ _id: guestId, state: "active" }, {
    $push: { activeRequests: { id, expiresAt: new Date(Date.now() + GUEST_ACTIVITY_MS) } }, $set: { cleanupAt: handoffRetention() },
  });
  if (acquired.modifiedCount !== 1) return false;
  request.guestActivity = { guestId, id };
  return true;
}
export async function releaseGuestActivity(request: FastifyRequest): Promise<void> {
  const lease = request.guestActivity;
  if (!lease) return;
  await handoffs().updateOne({ _id: lease.guestId }, { $pull: { activeRequests: { id: lease.id } } });
  request.guestActivity = null;
}
export function registerGuestActivity(app: FastifyInstance): void {
  app.decorateRequest("guestActivity", null);
  app.addHook("onRoute", options => {
    const handler = options.handler;
    options.handler = async function (request, reply) {
      try { return await activity.run(request.guestActivity, () => handler.call(this, request, reply)); }
      finally { await releaseGuestActivity(request); }
    };
  });
  // Also handles validation/preHandler errors after acquiring a lease.
  app.addHook("onSend", async request => { await releaseGuestActivity(request); });
}
