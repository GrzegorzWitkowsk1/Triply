import MongoStore from "connect-mongo";
import session, { type CookieOptions, type Session } from "express-session";
import mongoose from "mongoose";
import type { Request } from "express";
import { env } from "./env.js";

export const SESSION_COOKIE_NAME = "triply.sid";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

export function createSessionMiddleware() {
  const store = MongoStore.create({
    client: mongoose.connection.getClient(),
    collectionName: "sessions",
    ttl: SESSION_TTL_SECONDS,
    touchAfter: 24 * 60 * 60,
    autoRemove: "native",
  });

  return session({
    name: SESSION_COOKIE_NAME,
    secret: env.SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy:
      env.TRUST_PROXY === true ||
      (typeof env.TRUST_PROXY === "number" && env.TRUST_PROXY > 0),
    cookie: {
      ...sessionCookieOptions,
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  });
}

export type TriplySession = Session & {
  userId?: string;
};

export function getSessionUserId(req: Request): string | undefined {
  return (req.session as TriplySession).userId;
}

export function setSessionUserId(req: Request, userId: string): void {
  (req.session as TriplySession).userId = userId;
}

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
