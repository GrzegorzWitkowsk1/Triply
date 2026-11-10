import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerHealthRoutes } from "./health.js";

describe("readiness", () => {
  it("returns 503 before MongoDB connects", async () => {
    const app = Fastify();
    registerHealthRoutes(app);
    try {
      const result = await app.inject({ url: "/health" });
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual({ status: "unavailable", db: "disconnected" });
    } finally { await app.close(); }
  });
});
