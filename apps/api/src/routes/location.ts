import type { FastifyInstance } from "fastify";
import type { HttpRoute } from "../http/types.js";
import { geocodeLocation } from "../services/location.js";
import { z } from "zod";

const searchQuery = z.object({ q: z.string().trim().min(2).max(120).refine(value => !/[\u0000-\u001f\u007f]/.test(value)) });

export function registerLocationRoutes(app: FastifyInstance): void {

  app.get<HttpRoute>(
    "/location/search",
    async (req, res) => {
      const parsed = searchQuery.safeParse(req.query);
      if (!parsed.success) return res.code(400).send({ error: "Enter a location of 2–120 characters.", code: "INVALID_LOCATION_QUERY" });
      const q = parsed.data.q;

      const location = await geocodeLocation(q);

      if (!location) {
        return res.code(404).send({ error: "Location not found" });
      }

      const displayName = [location.city, location.country]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(", ");

      return res.send({
        lat: location.lat,
        lng: location.lng,
        city: location.city ?? null,
        country: location.country ?? null,
        displayName: displayName || null,
      });
    },
  );
}
