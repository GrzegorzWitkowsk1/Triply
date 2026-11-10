import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import type { FastifyInstance } from "fastify";
import { currentTripOwner } from "../middleware/tripIdentity.js";
import { env } from "../config/env.js";
import { checkOperation, generationContext, OperationStoppedError, GENERATION_DEADLINE_MS } from "./generationContext.js";
import { GenerationSupersededError } from "./tripGeneration.js";
import { handoffs } from "../models/GuestHandoff.js";
import { GuestActivityError } from "../middleware/guestActivity.js";

type Scope = "generation" | "location";
interface State { _id: string; count: number; windowEnd: Date; active: { id: string; expiresAt: Date }[]; cleanupAt: Date }
const states = () => mongoose.connection.db!.collection<State>("resource_admission", { writeConcern: { w: "majority", wtimeoutMS: 5_000 } });
export const admissionPolicy = {
  generation: { max: env.GENERATION_REQUESTS_PER_10M, windowMs: 600_000, concurrent: 1, durationMs: GENERATION_DEADLINE_MS },
  location: { max: env.LOCATION_REQUESTS_PER_MINUTE, windowMs: 60_000, concurrent: 4, durationMs: 10_000 },
};
export class AdmissionError extends Error {
  constructor(readonly code: "RESOURCE_RATE_LIMITED" | "TOO_MANY_CONCURRENT_OPERATIONS", readonly retryAfter: number, readonly status: number) {
    super(code === "RESOURCE_RATE_LIMITED" ? "Too many requests. Please wait before retrying." : "Another expensive operation is in progress. Please wait before retrying.");
  }
}
export async function prepareResourceAdmission(): Promise<void> {
  await states().createIndex({ cleanupAt: 1 }, { expireAfterSeconds: 0 });
}
/** One atomic document per server-owned identity/scope; expiry never depends on TTL cleanup. */
export async function acquireAdmission(owner: string, scope: Scope, now = new Date(Date.now()), ceiling?: Date) {
  const policy = admissionPolicy[scope];
  const key = `${scope}:${owner}`;
  const id = randomUUID();
  const deadline = new Date(Math.min(now.getTime() + policy.durationMs, ceiling?.getTime() ?? Infinity));
  if (deadline <= now) throw new OperationStoppedError("GENERATION_DEADLINE_EXCEEDED", 504);
  try { await states().updateOne({ _id: key }, { $setOnInsert: { count: 0, windowEnd: now, active: [] } }, { upsert: true }); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error; }
  const active = { $filter: { input: "$active", as: "slot", cond: { $gt: ["$$slot.expiresAt", now] } } };
  const count = { $cond: [{ $lte: ["$windowEnd", now] }, 0, "$count"] };
  const admitted = await states().findOneAndUpdate({ _id: key, $expr: { $and: [
    { $lt: [count, policy.max] }, { $lt: [{ $size: active }, policy.concurrent] },
  ] } }, [{ $set: {
    count: { $add: [count, 1] },
    windowEnd: { $cond: [{ $lte: ["$windowEnd", now] }, new Date(now.getTime() + policy.windowMs), "$windowEnd"] },
    active: { $concatArrays: [active, [{ $literal: { id, expiresAt: deadline } }]] },
    cleanupAt: new Date(now.getTime() + Math.max(policy.windowMs, policy.durationMs) + 86_400_000),
  } }], { returnDocument: "after" });
  if (!admitted) {
    const current = await states().findOne({ _id: key });
    const limited = current && current.windowEnd > now && current.count >= policy.max;
    const releaseTimes = current?.active.filter(a => a.expiresAt > now).map(a => a.expiresAt.getTime()) ?? [];
    const retryAt = limited ? current.windowEnd.getTime() : releaseTimes.length ? Math.min(...releaseTimes) : now.getTime() + 1000;
    throw new AdmissionError(limited ? "RESOURCE_RATE_LIMITED" : "TOO_MANY_CONCURRENT_OPERATIONS", Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000)), limited ? 429 : 409);
  }
  return { deadline, release: async () => { await states().updateOne({ _id: key }, { $pull: { active: { id } } }); } };
}

/** Wrap only full generation, analysis and search. Identity hooks run before the handler. */
export function registerResourceAdmission(app: FastifyInstance): void {
  app.addHook("onRoute", options => {
    const path = options.url.replace(/^\/api/, "");
    const scope: Scope | null = path === "/location/search" ? "location" : path === "/trips/analyze" || path === "/trips/:id/generate" ? "generation" : null;
    if (!scope) return;
    const handler = options.handler;
    options.handler = async function (request, reply) {
      let lease: Awaited<ReturnType<typeof acquireAdmission>> | undefined;
      const controller = new AbortController();
      const cancel = () => { if (!reply.raw.writableEnded) controller.abort(new OperationStoppedError("REQUEST_CANCELLED", 499)); };
      request.raw.once("aborted", cancel);
      reply.raw.once("close", cancel);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (request.raw.aborted || reply.raw.destroyed) cancel();
        controller.signal.throwIfAborted();
        let ceiling: Date | undefined;
        if (request.guestActivity) {
          const activity = request.guestActivity;
          const handoff = await handoffs().findOne({ _id: activity.guestId, state: { $in: ["active", "pending"] } });
          const guestLease = handoff?.activeRequests.find(entry => typeof entry !== "string" && entry.id === activity.id);
          if (!guestLease || typeof guestLease === "string") throw new GuestActivityError();
          // Respect remaining guest authority even if admission/database acquisition was slow.
          ceiling = new Date(guestLease.expiresAt.getTime() - 1000);
        }
        lease = await acquireAdmission(currentTripOwner(request), scope, new Date(Date.now()), ceiling);
        timer = setTimeout(() => controller.abort(new OperationStoppedError("GENERATION_DEADLINE_EXCEEDED", 504)), Math.max(0, lease.deadline.getTime() - Date.now()));
        timer.unref();
        return await generationContext.run({ signal: controller.signal, deadline: lease.deadline }, async () => {
          checkOperation();
          const result = await handler.call(this, request, reply);
          checkOperation();
          return result;
        });
      } catch (error) {
        if (error instanceof AdmissionError) return reply.header("Retry-After", error.retryAfter).code(error.status).send({ error: error.message, code: error.code });
        const stopped = controller.signal.aborted ? controller.signal.reason : error;
        if (stopped instanceof OperationStoppedError) return reply.code(stopped.status).send({ error: stopped.message, code: stopped.code });
        if (error instanceof GenerationSupersededError) return reply.code(409).send({ error: error.message, code: error.code });
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        request.raw.removeListener("aborted", cancel);
        reply.raw.removeListener("close", cancel);
        // Await handler settlement; never release while uncancellable work is still pending.
        await lease?.release();
      }
    };
  });
}
