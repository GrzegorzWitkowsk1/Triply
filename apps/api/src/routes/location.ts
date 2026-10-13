import type { FastifyInstance } from "fastify";
import type { HttpRoute } from "../http/types.js";
import { geocodeLocation } from "../services/location.js";

export function registerLocationRoutes(app: FastifyInstance): void {

  app.get<HttpRoute>(
    "/location/search",
    async (req, res) => {
      const qRaw = req.query.q;
      const q = typeof qRaw === "string" ? qRaw : Array.isArray(qRaw) ? String(qRaw[0]) : "";

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
