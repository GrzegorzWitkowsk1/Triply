import argon2 from "argon2";
import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type { HttpRoute } from "../http/types.js";
import { z } from "zod";
import {
  destroySession,
  regenerateSession,
  saveSession,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  setSessionUserId,
} from "../config/session.js";
import { requireAuth } from "../middleware/auth.js";
import { UserModel, toPublicUser } from "../models/User.js";

const emailSchema = z.string().trim().email().max(254);
const registerSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number")
    .regex(/[^A-Za-z0-9]/, "Password must contain a special character"),
});
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const dummyPasswordHashPromise = argon2.hash("triply-invalid-password", {
  type: argon2.argon2id,
});

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function parseCredentials(
  schema: typeof registerSchema | typeof loginSchema,
  body: unknown,
): { email: string; password: string } | null {
  const result = schema.safeParse(body);

  if (!result.success) {
    return null;
  }

  return {
    email: result.data.email.toLowerCase(),
    password: result.data.password,
  };
}

export function registerAuthRoutes(app: FastifyInstance, authLimiter: preHandlerAsyncHookHandler): void {

  app.post<HttpRoute>(
    "/api/auth/register",
    { preHandler: authLimiter },
    async (req, res) => {
      const credentials = parseCredentials(registerSchema, req.body);

      if (!credentials) {
        return res.code(400).send({
          error: "Use a valid email and a password with at least 12 characters, including an uppercase letter, a number, and a special character.",
        });
      }

      if (await UserModel.exists({ email: credentials.email })) {
        return res.code(409).send({ error: "An account with this email already exists." });
      }

      const passwordHash = await argon2.hash(credentials.password, {
        type: argon2.argon2id,
      });

      let user;
      try {
        user = await UserModel.create({
          email: credentials.email,
          passwordHash,
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.code(409).send({ error: "An account with this email already exists." });
        }
        throw error;
      }

      await regenerateSession(req);
      setSessionUserId(req, user._id.toString());
      await saveSession(req);

      return res.code(201).send({ user: toPublicUser(user) });
    },
  );

  app.post<HttpRoute>(
    "/api/auth/login",
    { preHandler: authLimiter },
    async (req, res) => {
      const credentials = parseCredentials(loginSchema, req.body);

      if (!credentials) {
        return res.code(400).send({ error: "Enter a valid email and password." });
      }

      const user = await UserModel.findOne({ email: credentials.email })
        .select("+passwordHash")
        .exec();
      const passwordHash = user?.passwordHash ?? (await dummyPasswordHashPromise);
      const passwordMatches = await argon2.verify(passwordHash, credentials.password);

      if (!user || !passwordMatches) {
        return res.code(401).send({ error: "Invalid email or password." });
      }

      await regenerateSession(req);
      setSessionUserId(req, user._id.toString());
      await saveSession(req);

      return res.send({ user: toPublicUser(user) });
    },
  );

  app.post<HttpRoute>(
    "/api/auth/logout",
    async (req, res) => {
      await destroySession(req);
      res.setCookie(SESSION_COOKIE_NAME, "", {
        httpOnly: sessionCookieOptions.httpOnly,
        secure: sessionCookieOptions.secure === true,
        sameSite: "lax",
        path: sessionCookieOptions.path,
        expires: new Date(0),
      });
      return res.code(204).send();
    },
  );

  app.get<HttpRoute>("/api/auth/session", { preHandler: requireAuth }, (req, res) => {
    res.header("Cache-Control", "no-store");
    return res.send({ user: req.user });
  });
}
