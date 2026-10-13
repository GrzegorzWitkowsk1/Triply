import type { FastifyInstance } from "fastify";
import type { HttpRoute } from "../http/types.js";
import { isDbConnected } from "../db.js";

export function registerHealthRoutes(app: FastifyInstance): void {

  app.get<HttpRoute>("/health", (_req, res) => {
    return res.send({
      status: "ok",
      db: isDbConnected() ? "connected" : "disconnected",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "0.1.0",
    });
  });
}
