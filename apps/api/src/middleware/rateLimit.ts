import { currentTripOwner } from "./tripIdentity.js";
import { getSessionGuest } from "../config/session.js";
import { createHash } from "node:crypto";
import { isIPv6 } from "node:net";
import { Address6 } from "ip-address";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** Official counter engine with the existing shared scopes and draft-8 headers. */
export function createLimiters(app: FastifyInstance) {
  function limiter(max: number, minutes: number, keyGenerator: (request: FastifyRequest) => string, message: string) {
    const check = app.createRateLimit({ max, timeWindow: minutes * 60_000, keyGenerator });
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const result = await check(request);
      if (result.isAllowed) return;
      const name = `${max}-in-${minutes}min`;
      const partition = Buffer.from(createHash("sha256").update(result.key).digest("hex").slice(0, 12)).toString("base64");
      reply.header("RateLimit", `"${name}"; r=${result.remaining}; t=${result.ttlInSeconds}`);
      reply.header("RateLimit-Policy", `"${name}"; q=${max}; w=${minutes * 60}; pk=:${partition}:`);
      if (result.isExceeded) {
        await reply.header("Retry-After", result.ttlInSeconds).code(429).send({ error: message,
          ...(getSessionGuest(request) ? { code: "GUEST_RATE_LIMITED" } : {}) });
      }
    };
  }
  return {
    auth: limiter(10, 15, request => {
      const ip = request.ip;
      if (!isIPv6(ip)) return ip;
      const address = new Address6(ip);
      if (address.isMapped4() || (address.is4() && address.isInSubnet(new Address6("::/96")))) return address.to4().correctForm();
      return new Address6(`${ip}/56`).networkForm();
    }, "Too many authentication attempts. Try again later."),
    planning: limiter(20, 10, request => currentTripOwner(request),
      "Too many planning requests. Wait a few minutes and try again."),
  };
}
