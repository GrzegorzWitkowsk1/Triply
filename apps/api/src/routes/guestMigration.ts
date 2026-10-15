import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { confirmMigration, discardMigration, migrationStatus } from "../services/guestMigration.js";

export function registerGuestMigrationRoutes(app: FastifyInstance): void {
  const options = { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
  app.get("/api/auth/guest-migration/status", options, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return migrationStatus(req);
  });
  for (const operation of ["confirm", "discard"] as const) {
    app.post(`/api/auth/guest-migration/${operation}`, options, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!z.object({}).strict().safeParse(req.body ?? {}).success) return reply.code(400).send({ error: "No identity fields are accepted for guest imports." });
      if (operation === "confirm") return confirmMigration(req);
      return discardMigration(req);
    });
  }
}
