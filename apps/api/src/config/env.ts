import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isTravelMode, type TravelMode } from "@triply/shared";

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalSecret = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

function parseEnabledModes(value: string): TravelMode[] {
  const modes: TravelMode[] = [];

  for (const part of value.split(",")) {
    const mode = part.trim().toLowerCase();
    if (isTravelMode(mode) && !modes.includes(mode)) {
      modes.push(mode);
    }
  }

  return modes;
}

const parsed = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27018/triply"),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    TRUST_PROXY: z.string().regex(/^(true|false|\d+)$/).default("false"),
    AI_PROVIDER: z.preprocess(emptyToUndefined, z.string().trim().min(1).default("gemini")),
    AI_MODEL: optionalSecret,
    AI_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().default(45_000),
    ),
    GEMINI_API_KEY: optionalSecret,
    OPENROUTER_API_KEY: optionalSecret,
    ROUTING_PROVIDER: z.preprocess(emptyToUndefined, z.string().trim().min(1).default("osrm")),
    ROUTING_OSRM_URL: z
      .preprocess(emptyToUndefined, z.string().url().default("https://router.project-osrm.org")),
    ROUTING_ENABLED_MODES: z.preprocess(emptyToUndefined, z.string().default("driving")),
    ROUTING_MODE: z.preprocess(emptyToUndefined, z.string().trim().min(1).default("walking")),
    ROUTING_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().default(8_000),
    ),
    ROUTING_RETURN_TO_START: z.string().regex(/^(true|false)$/).default("false"),
  })
  .safeParse({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    MONGODB_URI: process.env.MONGODB_URI,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    TRUST_PROXY: process.env.TRUST_PROXY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    ROUTING_PROVIDER: process.env.ROUTING_PROVIDER,
    ROUTING_OSRM_URL: process.env.ROUTING_OSRM_URL,
    ROUTING_ENABLED_MODES: process.env.ROUTING_ENABLED_MODES,
    ROUTING_MODE: process.env.ROUTING_MODE,
    ROUTING_TIMEOUT_MS: process.env.ROUTING_TIMEOUT_MS,
    ROUTING_RETURN_TO_START: process.env.ROUTING_RETURN_TO_START,
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
  AI_PROVIDER: parsed.data.AI_PROVIDER,
  AI_MODEL: parsed.data.AI_MODEL ?? null,
  AI_TIMEOUT_MS: parsed.data.AI_TIMEOUT_MS,
  GEMINI_API_KEY: parsed.data.GEMINI_API_KEY ?? null,
  OPENROUTER_API_KEY: parsed.data.OPENROUTER_API_KEY ?? null,
  ROUTING_PROVIDER: parsed.data.ROUTING_PROVIDER,
  ROUTING_OSRM_URL: parsed.data.ROUTING_OSRM_URL,
  ROUTING_ENABLED_MODES: parseEnabledModes(parsed.data.ROUTING_ENABLED_MODES),
  ROUTING_MODE: isTravelMode(parsed.data.ROUTING_MODE)
    ? parsed.data.ROUTING_MODE
    : ("walking" as TravelMode),
  ROUTING_TIMEOUT_MS: parsed.data.ROUTING_TIMEOUT_MS,
  ROUTING_RETURN_TO_START: parsed.data.ROUTING_RETURN_TO_START === "true",
};
