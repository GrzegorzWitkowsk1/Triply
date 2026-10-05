import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { geocodeLocation } from "../services/location.js";

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export const locationRouter = Router();

locationRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const qRaw = req.query.q;
    const q = typeof qRaw === "string" ? qRaw : Array.isArray(qRaw) ? String(qRaw[0]) : "";

    const location = await geocodeLocation(q);

    if (!location) {
      res.status(404).json({ error: "Location not found" });
      return;
    }

    const displayName = [location.city, location.country]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(", ");

    res.json({
      lat: location.lat,
      lng: location.lng,
      city: location.city ?? null,
      country: location.country ?? null,
      displayName: displayName || null,
    });
  }),
);
