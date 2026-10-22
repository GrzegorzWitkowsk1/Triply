import type { FastifyReply, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { requireAuth, currentUserId } from "./auth.js";
import { getSessionGuest, getSessionUserId } from "../config/session.js";
import { acquireGuestActivity } from "./guestActivity.js";

// Tagged service identity keeps user IDs compatible without impersonating users.
export function currentTripOwner(request: FastifyRequest): string {
  const guest = getSessionGuest(request);
  return guest ? `guest:${guest.id}` : currentUserId(request);
}
export function guestOwnerId(owner: string): string | null {
  return /^guest:[a-f0-9]{32}$/.test(owner) ? owner.slice(6) : null;
}
export function ownerFilter(owner: string) {
  const guestId = guestOwnerId(owner);
  return guestId ? { guestId, user: null } : { user: new Types.ObjectId(owner), guestId: null };
}
export function storedOwner(trip: { user?: Types.ObjectId | null; guestId?: string | null }): string {
  if (trip.guestId && !trip.user) return `guest:${trip.guestId}`;
  if (trip.user && !trip.guestId) return trip.user.toString();
  throw new Error("Ambiguous trip ownership");
}

/** Explicit allowlist; account endpoints and the assistant stay user-only. */
export async function requireTripIdentity(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = request.url.split("?")[0].toLowerCase().replace(/\/+$/, "");
  const method = request.method === "HEAD" ? "GET" : request.method;
  const tripPath = path.replace(/^\/api\/trips\/[a-f0-9]{24}(?=\/|$)/, "/api/trips/:id");
  const allowed: Record<string, readonly string[]> = {
    "/api/guest/usage": ["GET"], "/api/trips": ["GET"], "/api/trips/analyze": ["POST"],
    "/api/location/search": ["GET"], "/api/trips/:id": ["GET", "DELETE"],
    "/api/trips/:id/requirements": ["PATCH"], "/api/trips/:id/confirm": ["POST"],
    "/api/trips/:id/generate": ["POST"], "/api/trips/:id/weather/refresh": ["POST"],
    "/api/trips/:id/equipment/context": ["GET"], "/api/trips/:id/equipment/bulk": ["PATCH"],
    "/api/trips/:id/equipment/generate": ["POST"], "/api/trips/:id/equipment/apply": ["POST"],
    "/api/trips/:id/equipment": ["GET", "POST"], "/api/trips/:id/itinerary/edit": ["POST"],
    "/api/trips/:id/itinerary/candidates": ["POST"], "/api/trips/:id/export/pdf": ["GET"],
    "/api/trips/:id/export/calendar": ["GET"], "/api/trips/:id/sharing": ["GET", "POST", "DELETE"],
    "/api/trips/:id/sharing/rotate": ["POST"], "/api/trips/:id/expenses": ["GET", "POST"],
    "/api/trips/:id/budget": ["GET", "PATCH"],
  };
  const savedPath = /^\/api\/saved\/(?:destinations|attractions)$/.test(path) && ["GET", "POST"].includes(method) ||
    /^\/api\/saved\/(?:destinations|attractions)\/status$/.test(path) && method === "GET" ||
    /^\/api\/saved\/(?:destinations|attractions)\/[^/]+$/.test(path) && method === "DELETE";
  const supported = savedPath || allowed[tripPath]?.includes(method) ||
    (method === "POST" && /^\/api\/trips\/:id\/days\/\d+\/(?:regenerate|apply)$/.test(tripPath)) ||
    (["PATCH", "DELETE"].includes(method) && /^\/api\/trips\/:id\/(?:equipment\/[a-f0-9]{24}|expenses\/[a-f0-9-]+)$/.test(tripPath));
  const guest = getSessionGuest(request);
  if (supported && !getSessionUserId(request) && guest) {
    if (await acquireGuestActivity(request, guest.id)) return;
    await reply.code(409).send({ error: "Guest sign-in is in progress. Refresh the page to continue with your account." });
    return;
  }
  if (supported && !getSessionUserId(request) && request.cookies["triply.sid"]?.startsWith("s:g_")) {
    await reply.code(401).send({ code: "GUEST_SESSION_EXPIRED", error: "Your guest session has expired. Enter Guest Mode again to start a new session." });
    return;
  }
  await requireAuth(request, reply);
}
