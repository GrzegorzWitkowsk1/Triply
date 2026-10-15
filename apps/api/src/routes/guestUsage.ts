import type { FastifyInstance } from "fastify";
import { currentTripOwner } from "../middleware/tripIdentity.js";
import { guestUsage } from "../services/guestLimits.js";

export function registerGuestUsageRoutes(app: FastifyInstance): void {
  app.get("/guest/usage", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return guestUsage(currentTripOwner(req));
  });
}
