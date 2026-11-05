import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Readable } from "node:stream";
import { ATTACHMENT_LIMITS as L, validateAttachmentFile } from "@triply/shared";
import { requireAuth } from "../middleware/auth.js";
import { getSessionUserId } from "../config/session.js";
import { AttachmentError, type AttachmentBytes } from "../services/attachmentExtraction.js";

declare module "fastify" {
  interface FastifyRequest { attachmentSignal?: AbortSignal; }
}
export async function registerAttachmentTransport(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { files: L.files, fields: 1, parts: L.files + 1,
    fileSize: L.pdfBytes, fieldSize: L.metadataBytes, fieldNameSize: 40, headerPairs: 30 } });
  const check = app.createRateLimit({ max: 6, timeWindow: 10 * 60_000, keyGenerator: req => req.user!.id });
  const owners = new Set<string>();
  app.addHook("onRequest", async (req, reply) => {
    if (!/^multipart\/form-data(?:;|$)/i.test(req.headers["content-type"] ?? "")) return;
    if (Number(req.headers["content-length"] ?? 0) > L.transportBytes) {
      await reply.code(413).send({ code: "ATTACHMENT_TOTAL_SIZE", error: "Attachment request is too large" });
    }
  });
  // Sessions load in the parent's preValidation. Multipart's parser only marks the request;
  // it does not consume bytes until parts() is called in the authorized handler.
  app.addHook("preValidation", async (req, reply) => {
    if (!req.isMultipart()) return;
    if (!getSessionUserId(req)) {
      await reply.code(401).send({ code: "ATTACHMENT_AUTH_REQUIRED", error: "Attachments require an account" }); return;
    }
    await requireAuth(req, reply);
    if (reply.sent) return;
    const limit = await check(req);
    if (!limit.isAllowed && limit.isExceeded) { await reply.code(429).send({ code: "ATTACHMENT_RATE_LIMIT", error: "Attachment analysis limit reached" }); return; }
    const owner = req.user!.id;
    if (owners.size >= 2 || owners.has(owner)) { await reply.code(429).send({ code: "ATTACHMENT_BUSY", error: "Attachment processing is busy" }); return; }
    owners.add(owner);
    const controller = new AbortController();
    req.attachmentSignal = controller.signal;
    const release = () => { owners.delete(owner); controller.abort(); cleanup(); };
    const cleanup = () => { reply.raw.off("close", release); reply.raw.off("finish", release); req.raw.off("aborted", release); clearTimeout(timer); };
    const timer = setTimeout(release, 100_000);
    reply.raw.once("close", release); reply.raw.once("finish", release); req.raw.once("aborted", release);
  });
  const parentHandler = app.errorHandler;
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AttachmentError) {
      return reply.code(error.status).send({ error: error.message, code: error.code, failures: error.failures });
    }
    if (req.isMultipart()) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      return reply.code(400).send({ code: code === "FST_REQ_FILE_TOO_LARGE" ? "ATTACHMENT_SIZE" :
        /LIMIT/.test(code) ? "ATTACHMENT_COUNT" : "ATTACHMENT_FAILED", error: "Attachment request could not be processed" });
    }
    return parentHandler.call(app, error, req, reply);
  });
}

export async function readAttachmentRequest(req: FastifyRequest): Promise<{ metadata: unknown; files: AttachmentBytes[] }> {
  const files: AttachmentBytes[] = [];
  const signal = AbortSignal.any([...(req.attachmentSignal ? [req.attachmentSignal] : []), AbortSignal.timeout(15_000)]);
  let currentFile: Readable | undefined;
  const abort = () => { currentFile?.destroy(new AttachmentError("ATTACHMENT_TIMEOUT", 408)); req.raw.destroy(); };
  signal.addEventListener("abort", abort, { once: true });
  let metadata: unknown, total = 0, wireBytes = 0;
  const count = (chunk: Buffer) => {
    wireBytes += chunk.length;
    // Last-resort streaming transport cap, including headers/preamble. No unbounded drain.
    if (wireBytes > L.transportBytes) req.raw.destroy();
  };
  req.raw.on("data", count);
  try {
    for await (const part of req.parts()) {
      if (signal.aborted) throw new AttachmentError("ATTACHMENT_TIMEOUT", 408);
      if (part.type === "field") {
        if (part.fieldname !== "metadata" || metadata !== undefined || part.valueTruncated || typeof part.value !== "string") throw new AttachmentError("ATTACHMENT_METADATA");
        try { metadata = JSON.parse(part.value); } catch { throw new AttachmentError("ATTACHMENT_METADATA"); }
      } else {
        if (part.fieldname !== "files") { part.file.resume(); throw new AttachmentError("ATTACHMENT_METADATA"); }
        const headerError = validateAttachmentFile({ name: part.filename, type: part.mimetype, size: 1 });
        if (headerError) { part.file.resume(); throw new AttachmentError("ATTACHMENT_FAILED", 422, [{ index: files.length, code: headerError }]); }
        let bytes: Buffer;
        currentFile = part.file;
        try { bytes = await part.toBuffer(); }
        catch { throw new AttachmentError("ATTACHMENT_FAILED", 422, [{ index: files.length, code: signal.aborted ? "ATTACHMENT_TIMEOUT" : "ATTACHMENT_SIZE" }]); }
        finally { currentFile = undefined; }
        total += bytes.length;
        if (total > L.totalBytes) throw new AttachmentError("ATTACHMENT_TOTAL_SIZE", 413);
        files.push({ name: part.filename, type: part.mimetype, bytes });
      }
    }
    if (!metadata || !files.length) throw new AttachmentError("ATTACHMENT_METADATA");
    return { metadata, files };
  } finally { req.raw.off("data", count); signal.removeEventListener("abort", abort); }
}
