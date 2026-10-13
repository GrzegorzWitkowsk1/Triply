import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";

/** Preserve Express's default weak ETags and conditional GET/HEAD responses. */
export function registerResponseCompatibility(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload;
    // Express's finalhandler writes HTML directly, bypassing res.send/ETag.
    if (reply.statusCode === 404 && reply.getHeader("content-type") === "text/html; charset=utf-8") return payload;
    const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const digest = createHash("sha1").update(buffer).digest("base64").slice(0, 27);
    const tag = `W/"${buffer.length.toString(16)}-${digest}"`;
    reply.header("ETag", tag);
    const match = request.headers["if-none-match"];
    if (["GET", "HEAD"].includes(request.method) && reply.statusCode >= 200 && reply.statusCode < 300 && match &&
      !/(?:^|,)\s*no-cache\s*(?:,|$)/i.test(request.headers["cache-control"] ?? "") &&
      (match.trim() === "*" || match.split(",").some(value => value.trim().replace(/^W\//, "") === tag.replace(/^W\//, "")))) {
      reply.code(304).removeHeader("Content-Type").removeHeader("Content-Length").removeHeader("Transfer-Encoding");
      return "";
    }
    return payload;
  });
}
