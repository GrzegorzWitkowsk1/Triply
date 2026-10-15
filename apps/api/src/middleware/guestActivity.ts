import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ensureGuestHandoff, handoffs, handoffRetention } from "../models/GuestHandoff.js";

declare module "fastify" { interface FastifyRequest { guestActivity: { guestId: string; id: string } | null; } }
export async function acquireGuestActivity(request: FastifyRequest, guestId: string): Promise<boolean> {
  await ensureGuestHandoff(guestId);
  const id = randomUUID();
  const acquired = await handoffs().updateOne({ _id: guestId, state: "active" }, {
    $push: { activeRequests: id }, $set: { cleanupAt: handoffRetention() },
  });
  if (acquired.modifiedCount !== 1) return false;
  request.guestActivity = { guestId, id };
  return true;
}
export async function releaseGuestActivity(request: FastifyRequest): Promise<void> {
  const lease = request.guestActivity;
  if (!lease) return;
  await handoffs().updateOne({ _id: lease.guestId }, { $pull: { activeRequests: lease.id } });
  request.guestActivity = null;
}
export function registerGuestActivity(app: FastifyInstance): void {
  app.decorateRequest("guestActivity", null);
  app.addHook("onRoute", options => {
    const handler = options.handler;
    options.handler = async function (request, reply) {
      try { return await handler.call(this, request, reply); }
      finally { await releaseGuestActivity(request); }
    };
  });
  // Also handles validation/preHandler errors after acquiring a lease.
  app.addHook("onSend", async request => { await releaseGuestActivity(request); });
}
