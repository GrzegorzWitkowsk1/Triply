import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import type { FastifyInstance } from "fastify";
import iconv from "iconv-lite";

const decompressors = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };
export const JSON_BODY_LIMIT = 100 * 1024;
function requestCharset(contentType: string | undefined): string {
  return /charset\s*=\s*"?([^;"\s]+)/i.exec(contentType ?? "")?.[1].toLowerCase() ?? "utf-8";
}
function parserError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status, expose: true });
}
function charsetError(charset: string): Error {
  return parserError(415, `unsupported charset "${charset.toUpperCase()}"`);
}
function strictJsonError(text: string): Error {
  // Match body-parser's strict JSON errors, including native truncation and whitespace-only input.
  const index = text.search(/[^\x20\x09\x0a\x0d]/);
  const masked = index < 0 ? "" : text.slice(0, index) + "#".repeat(text.length - index);
  try { JSON.parse(masked); }
  catch (error) {
    const message = error instanceof Error ? error.message.replace(/#+/g, value => text.slice(index, index + value.length)) : "Invalid request body";
    return parserError(400, message);
  }
  return parserError(400, "Invalid request body");
}
/** Express parsed application/json only, accepted object/array JSON, and ignored other media types. */
export function registerBodyParsing(app: FastifyInstance): void {
  // Express's parser also handled bodies on GET/HEAD, even without route body schemas.
  app.addHttpMethod("GET", { hasBody: true, overrideExisting: true });
  app.addHttpMethod("HEAD", { hasBody: true, overrideExisting: true });
  app.removeAllContentTypeParsers();
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) return payload;
    if (request.headers["content-length"] === undefined && request.headers["transfer-encoding"] === undefined) return payload;
    const charset = requestCharset(request.headers["content-type"]);
    if (!charset.startsWith("utf-")) throw parserError(415, `unsupported charset "${charset.toUpperCase()}"`);
    const encoding = request.headers["content-encoding"]?.toLowerCase();
    if (encoding && encoding !== "identity" && !(encoding in decompressors)) throw parserError(415, `unsupported content encoding "${encoding}"`);
    if (!iconv.encodingExists(charset)) throw charsetError(charset);
    if (!encoding || encoding === "identity") return payload;
    const decoder = decompressors[encoding as keyof typeof decompressors];
    const stream = Object.assign(decoder(), { receivedEncodedLength: 0 });
    stream.on("error", error => { Object.assign(error, { status: 400, expose: true }); });
    payload.on("data", (chunk: Buffer) => { stream.receivedEncodedLength += chunk.length; });
    payload.on("error", error => stream.destroy(error));
    payload.pipe(stream);
    return stream;
  });
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: JSON_BODY_LIMIT }, (request, body, done) => {
    const charset = requestCharset(request.headers["content-type"]);
    if (!charset.startsWith("utf-") || !iconv.encodingExists(charset)) { done(parserError(415, `unsupported charset "${charset.toUpperCase()}"`)); return; }
    let text: string;
    try { text = iconv.decode(typeof body === "string" ? Buffer.from(body) : body, charset); }
    catch { done(parserError(415, `unsupported charset "${charset.toUpperCase()}"`)); return; }
    try {
      if (!text.length) { done(null, {}); return; }
      if (!/^[\x20\x09\x0a\x0d]*[\[{]/.test(text)) {
        throw strictJsonError(text);
      }
      done(null, JSON.parse(text));
    } catch (error) { done(parserError(400, error instanceof Error ? error.message : "Invalid request body")); }
  });
  // No form/text/vendor-JSON parser existed. Drain without interpreting the payload.
  app.addContentTypeParser("*", (_request, payload, done) => {
    payload.on("error", done);
    payload.on("end", () => done(null, undefined));
    payload.resume();
  });
}
