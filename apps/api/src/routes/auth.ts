import { rateLimit } from "express-rate-limit";
import argon2 from "argon2";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many authentication attempts. Try again later." });
  },
});

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

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

export const authRouter = Router();

authRouter.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const credentials = parseCredentials(registerSchema, req.body);

    if (!credentials) {
      res.status(400).json({
        error: "Use a valid email and a password with at least 12 characters, including an uppercase letter, a number, and a special character.",
      });
      return;
    }

    if (await UserModel.exists({ email: credentials.email })) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
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
        res.status(409).json({ error: "An account with this email already exists." });
        return;
      }
      throw error;
    }

    await regenerateSession(req);
    setSessionUserId(req, user._id.toString());
    await saveSession(req);

    res.status(201).json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const credentials = parseCredentials(loginSchema, req.body);

    if (!credentials) {
      res.status(400).json({ error: "Enter a valid email and password." });
      return;
    }

    const user = await UserModel.findOne({ email: credentials.email })
      .select("+passwordHash")
      .exec();
    const passwordHash = user?.passwordHash ?? (await dummyPasswordHashPromise);
    const passwordMatches = await argon2.verify(passwordHash, credentials.password);

    if (!user || !passwordMatches) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    await regenerateSession(req);
    setSessionUserId(req, user._id.toString());
    await saveSession(req);

    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: sessionCookieOptions.httpOnly,
      secure: sessionCookieOptions.secure === true,
      sameSite: "lax",
      path: sessionCookieOptions.path,
    });
    res.status(204).send();
  }),
);

authRouter.get("/session", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ user: res.locals.user });
});
