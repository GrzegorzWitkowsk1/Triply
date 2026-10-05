import { randomBytes } from "node:crypto";
import { z } from "zod";

const parsed = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27018/triply"),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    TRUST_PROXY: z.string().regex(/^(true|false|\d+)$/).default("false"),
    GEMINI_API_KEY: z.string().trim().min(1).optional(),
    GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.8-flash"),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  })
  .safeParse({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    MONGODB_URI: process.env.MONGODB_URI,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    TRUST_PROXY: process.env.TRUST_PROXY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS,
  });

if (!parsed.success) {
  console.error("[env] invalid configuration", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

const sessionSecret = process.env.SESSION_SECRET;

if (sessionSecret && sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters");
}

if (parsed.data.NODE_ENV === "production" && !sessionSecret) {
  throw new Error("SESSION_SECRET must be configured in production");
}

if (!sessionSecret) {
  console.warn("[env] SESSION_SECRET is not set; using an ephemeral development secret");
}

const trustProxy =
  parsed.data.TRUST_PROXY === "true"
    ? 1
    : parsed.data.TRUST_PROXY === "false"
      ? false
      : Number(parsed.data.TRUST_PROXY);

export const env = {
  NODE_ENV: parsed.data.NODE_ENV,
  PORT: parsed.data.PORT,
  MONGODB_URI: parsed.data.MONGODB_URI,
  WEB_ORIGIN: new URL(parsed.data.WEB_ORIGIN).origin,
  TRUST_PROXY: trustProxy,
  SESSION_SECRET: sessionSecret ?? randomBytes(32).toString("hex"),
  GEMINI_API_KEY: parsed.data.GEMINI_API_KEY ?? null,
  GEMINI_MODEL: parsed.data.GEMINI_MODEL,
  GEMINI_TIMEOUT_MS: parsed.data.GEMINI_TIMEOUT_MS,
};
