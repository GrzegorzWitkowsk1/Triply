import type { IncomingMessage } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";

const malformedPath = Symbol("malformedPath");
type CompatibleRequest = IncomingMessage & { [malformedPath]?: boolean; originalUrl?: string };

/** Keep malformed parameters inside the normal security/body/session/auth lifecycle. */
export function rewriteUrl(request: IncomingMessage): string {
  const url = request.url ?? "/";
  const queryIndex = url.indexOf("?");
  const path = queryIndex < 0 ? url : url.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : url.slice(queryIndex);
  return path.split("/").map(segment => {
    try { decodeURIComponent(segment); return segment; }
    catch {
      (request as CompatibleRequest)[malformedPath] = true;
      return encodeURIComponent(segment);
    }
  }).join("/") + query;
}

export function originalPath(request: FastifyRequest): string {
  return ((request.raw as CompatibleRequest).originalUrl ?? request.raw.url ?? "/").split("?")[0];
}

export async function validatePathParameters(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // The expense router decoded its mounted trip ID, but matched item suffixes as raw URLs.
  if (request.routeOptions.url?.endsWith("/expenses/:expenseId")) {
    await validateMountedTripParameter(request, reply);
    return;
  }
  if ((request.raw as CompatibleRequest)[malformedPath] && Object.keys(request.params ?? {}).length) {
    await reply.code(400).send({ error: "Invalid request body" });
  }
}

export async function validateMountedTripParameter(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const tripId = /^\/api\/trips\/([^/]+)/i.exec(originalPath(request))?.[1];
  if (!tripId) return;
  try { decodeURIComponent(tripId); }
  catch { await reply.code(400).send({ error: "Invalid request body" }); }
}
