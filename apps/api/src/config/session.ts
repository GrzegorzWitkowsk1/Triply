import { randomBytes } from "node:crypto";
import { Signer } from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "./env.js";
import { createMongoSessionStore, sessionContents, SESSION_TTL_MS, type SessionData } from "./mongoSession.js";

export const SESSION_COOKIE_NAME = "triply.sid";
export const sessionCookieOptions = {
  httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/",
} as const;

export interface TriplySession {
  id: string;
  data: SessionData;
  savedContents: string | null;
}
declare module "fastify" {
  interface FastifyRequest { triplySession: TriplySession | null; }
  interface FastifyInstance { triplySessionStore: ReturnType<typeof createMongoSessionStore>; }
}
function newSession(): TriplySession {
  return {
    id: randomBytes(24).toString("base64url"), savedContents: null,
    data: { cookie: { ...sessionCookieOptions, originalMaxAge: SESSION_TTL_MS,
      expires: new Date(Date.now() + SESSION_TTL_MS).toISOString() } },
  };
}

function isSecure(request: FastifyRequest): boolean {
  const socket = request.raw.socket;
  if ("encrypted" in socket && socket.encrypted) return true;
  if (!env.TRUST_PROXY) return false;
  // express-session used the first forwarded protocol, not Fastify's last entry.
  const forwarded = request.headers["x-forwarded-proto"];
  return typeof forwarded === "string" && forwarded.split(",")[0].toLowerCase().trim() === "https";
}

/** Native hooks preserve the existing cookie/store protocol and middleware order. */
export async function registerSessions(app: FastifyInstance): Promise<void> {
  const store = createMongoSessionStore();
  const signer = new Signer(env.SESSION_SECRET);
  await store.ready();
  app.decorateRequest("triplySession", null);
  app.decorate("triplySessionStore", store);
  app.addHook("preValidation", async (request) => {
    const cookie = request.cookies[SESSION_COOKIE_NAME];
    const unsigned = cookie?.startsWith("s:") ? signer.unsign(cookie.slice(2)) : null;
    const data = unsigned?.valid && unsigned.value ? await store.get(unsigned.value) : null;
    request.triplySession = data && unsigned?.value
      ? { id: unsigned.value, data, savedContents: sessionContents(data) }
      : newSession();
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const session = request.triplySession;
    if (!session) return payload;
    const modified = sessionContents(session.data) !== session.savedContents;
    // Equivalent to saveUninitialized:false, resave:false, rolling:true.
    if (session.savedContents === null && !session.data.userId) return payload;
    const expires = new Date(Date.now() + session.data.cookie.originalMaxAge);
    session.data.cookie.expires = expires.toISOString();
    try {
      if (modified) {
        await store.save(session.id, session.data);
        session.savedContents = sessionContents(session.data);
      } else {
        await store.touch(session.id, expires);
      }
    } catch (error) {
      // The error response also traverses onSend; never retry a failed session write there.
      request.triplySession = null;
      throw error;
    }
    if (!session.data.cookie.secure || isSecure(request)) {
      reply.setCookie(SESSION_COOKIE_NAME, `s:${signer.sign(session.id)}`, {
        ...session.data.cookie, expires, encode: encodeURIComponent,
      });
    }
    return payload;
  });
}
export function getSessionUserId(request: FastifyRequest): string | undefined {
  return request.triplySession?.data.userId;
}
export function setSessionUserId(request: FastifyRequest, userId: string): void {
  if (!request.triplySession) throw new Error("Session is not initialized");
  request.triplySession.data.userId = userId;
}
export async function regenerateSession(request: FastifyRequest): Promise<void> {
  if (request.triplySession) await request.server.triplySessionStore.destroy(request.triplySession.id);
  request.triplySession = newSession();
}
export async function saveSession(request: FastifyRequest): Promise<void> {
  const session = request.triplySession;
  if (!session) throw new Error("Session is not initialized");
  await request.server.triplySessionStore.save(session.id, session.data);
  session.savedContents = sessionContents(session.data);
}
export async function destroySession(request: FastifyRequest): Promise<void> {
  if (request.triplySession) await request.server.triplySessionStore.destroy(request.triplySession.id);
  request.triplySession = null;
}
