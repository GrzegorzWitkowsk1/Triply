import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSessionGuest } from "../config/session.js";
import { Address6 } from "ip-address";
import { isIPv6 } from "node:net";

export function guestNetworkLimit(app: FastifyInstance) {
  const check = app.createRateLimit({ max: 120, timeWindow: "15 minutes", keyGenerator: req => {
    if (!isIPv6(req.ip)) return `guest-network:${req.ip}`;
    const ip = new Address6(req.ip);
    return `guest-network:${ip.isMapped4() ? ip.to4().correctForm() : new Address6(`${req.ip}/56`).networkForm()}`;
  } });
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getSessionGuest(request)) return;
    // Include provider-backed reads as detail/backfill and location search can cost resources.
    if (request.url.split("?")[0] === "/api/guest/usage") return;
    const result = await check(request);
    if (!result.isAllowed && result.isExceeded) await reply.header("Retry-After", result.ttlInSeconds).code(429).send({
      code: "GUEST_RATE_LIMITED", error: "Too many guest requests from this network. Please try again later.",
    });
  };
}
