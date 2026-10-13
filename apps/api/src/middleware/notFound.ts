import type { FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "./auth.js";
import { originalPath, validateMountedTripParameter } from "../http/url.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}
export async function notFoundHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = originalPath(request);
  if (/^\/api(?:\/|$)/i.test(path) && !request.user) {
    await requireAuth(request, reply);
    if (reply.sent) return;
  }
  await validateMountedTripParameter(request, reply);
  if (reply.sent) return;
  reply.header("Content-Security-Policy", "default-src 'none'");
  await reply.code(404).type("text/html; charset=utf-8").send(
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot ' +
    escapeHtml(request.method) + " " + escapeHtml(path) + "</pre>\n</body>\n</html>\n",
  );
}
