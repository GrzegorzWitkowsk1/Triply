import type { FastifyInstance } from "fastify";
import type { HttpRoute } from "../http/types.js";
import { createDbReadinessCheck } from "../db.js";

declare module "fastify" {
  interface FastifyContextConfig { healthProbe?: boolean; }
}

export function registerHealthRoutes(app: FastifyInstance): void {
  const checkDb = createDbReadinessCheck();
  let closing = false;
  app.addHook("preClose", async () => { closing = true; });
  app.get<HttpRoute>("/health", { config: { healthProbe: true } }, async (_req, res) => {
    const ready = !closing && await checkDb() && !closing;
    return res.header("Cache-Control", "no-store").code(ready ? 200 : 503).send({
      status: ready ? "ok" : "unavailable", db: ready ? "connected" : "disconnected",
    });
  });
  app.get<HttpRoute>("/health/live", { config: { healthProbe: true } }, (_req, res) => {
    return res.header("Cache-Control", "no-store").send({ status: "ok" });
  });
}
