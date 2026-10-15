import type { FastifyReply, FastifyRequest } from "fastify";
import { GuestLimitError } from "../services/guestLimits.js";

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    if ("status" in error && typeof error.status === "number") return error.status;
    if ("statusCode" in error && typeof error.statusCode === "number") return error.statusCode;
  }
  return undefined;
}
export function errorHandler(error: unknown, _request: FastifyRequest, reply: FastifyReply): void {
  if (reply.sent) return;
  if (error instanceof GuestLimitError) {
    if (error.resetsAt) reply.header("Retry-After", Math.max(1, Math.ceil((Date.parse(error.resetsAt) - Date.now()) / 1000)));
    reply.code(error.status).send({ error: error.message, code: error.code, ...error.details,
      ...(error.resetsAt ? { resetsAt: error.resetsAt } : {}) });
    return;
  }
  const status = getHttpStatus(error);
  if (typeof error === "object" && error !== null && "expose" in error && error.expose === true && "message" in error) {
    reply.code(status ?? 500).send({ error: typeof error.message === "string" ? error.message : "Request could not be processed" });
    return;
  }
  if (status && status >= 400 && status < 500) {
    reply.code(status).send({ error: status === 400 ? "Invalid request body" : "Request could not be processed" });
    return;
  }
  // Do not log raw driver/provider messages that might contain credentials.
  console.error("[api] request failed:", error instanceof Error ? error.name : "Unknown error");
  reply.code(500).send({ error: "Internal server error" });
}
