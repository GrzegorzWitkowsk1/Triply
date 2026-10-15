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
    GUEST_MAX_TRIPS: z.coerce.number().int().positive().max(1000).default(6),
    GUEST_AI_GENERATIONS_PER_24H: z.coerce.number().int().positive().max(1000).default(2),
    GUEST_DAY_REGENERATIONS_PER_24H: z.coerce.number().int().positive().max(1000).default(2),
    GUEST_MAX_TRIP_DAYS: z.coerce.number().int().positive().max(1000).default(7),
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
    GEOAPIFY_API_KEY: optionalSecret,
    GEOAPIFY_ENABLED: z.string().regex(/^(true|false)$/).default("true"),
    GEOAPIFY_DAILY_CREDIT_LIMIT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(2500)),
    GEOAPIFY_TIMEOUT_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(8_000)),
    ROUTING_PROVIDER: z.preprocess(emptyToUndefined, z.string().trim().min(1).default("osrm")),
    ROUTING_OSRM_URL: z
      .preprocess(emptyToUndefined, z.string().url().default("https://routing.openstreetmap.de/routed-foot")),
    // The endpoint selects the actual foot graph. OSRM still uses "driving" in its URL.
    ROUTING_OSRM_PROFILE: z.preprocess(emptyToUndefined, z.string().trim().regex(/^[a-zA-Z0-9_-]+$/).default("driving")),
    ROUTING_ENABLED_MODES: z.preprocess(emptyToUndefined, z.string().default("walking")),
    ROUTING_MODE: z.preprocess(emptyToUndefined, z.string().trim().min(1).default("walking")),
    ROUTING_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().default(8_000),
    ),
    ROUTING_RETURN_TO_START: z.string().regex(/^(true|false)$/).default("false"),
  })
  .safeParse({
    GUEST_MAX_TRIPS: process.env.GUEST_MAX_TRIPS,
    GUEST_AI_GENERATIONS_PER_24H: process.env.GUEST_AI_GENERATIONS_PER_24H,
    GUEST_DAY_REGENERATIONS_PER_24H: process.env.GUEST_DAY_REGENERATIONS_PER_24H,
    GUEST_MAX_TRIP_DAYS: process.env.GUEST_MAX_TRIP_DAYS,
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
    GEOAPIFY_API_KEY: process.env.GEOAPIFY_API_KEY,
    GEOAPIFY_ENABLED: process.env.GEOAPIFY_ENABLED,
    GEOAPIFY_DAILY_CREDIT_LIMIT: process.env.GEOAPIFY_DAILY_CREDIT_LIMIT,
    GEOAPIFY_TIMEOUT_MS: process.env.GEOAPIFY_TIMEOUT_MS,
    ROUTING_PROVIDER: process.env.ROUTING_PROVIDER,
    ROUTING_OSRM_URL: process.env.ROUTING_OSRM_URL,
    ROUTING_OSRM_PROFILE: process.env.ROUTING_OSRM_PROFILE,
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
  GUEST_MAX_TRIPS: parsed.data.GUEST_MAX_TRIPS,
  GUEST_AI_GENERATIONS_PER_24H: parsed.data.GUEST_AI_GENERATIONS_PER_24H,
  GUEST_DAY_REGENERATIONS_PER_24H: parsed.data.GUEST_DAY_REGENERATIONS_PER_24H,
  GUEST_MAX_TRIP_DAYS: parsed.data.GUEST_MAX_TRIP_DAYS,
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
  GEOAPIFY_API_KEY: parsed.data.GEOAPIFY_API_KEY ?? null,
  GEOAPIFY_ENABLED: parsed.data.GEOAPIFY_ENABLED === "true",
  GEOAPIFY_DAILY_CREDIT_LIMIT: parsed.data.GEOAPIFY_DAILY_CREDIT_LIMIT,
  GEOAPIFY_TIMEOUT_MS: parsed.data.GEOAPIFY_TIMEOUT_MS,
  ROUTING_PROVIDER: parsed.data.ROUTING_PROVIDER,
  ROUTING_OSRM_URL: parsed.data.ROUTING_OSRM_URL,
  ROUTING_OSRM_PROFILE: parsed.data.ROUTING_OSRM_PROFILE,
  ROUTING_ENABLED_MODES: parseEnabledModes(parsed.data.ROUTING_ENABLED_MODES),
  ROUTING_MODE: isTravelMode(parsed.data.ROUTING_MODE)
    ? parsed.data.ROUTING_MODE
    : ("walking" as TravelMode),
  ROUTING_TIMEOUT_MS: parsed.data.ROUTING_TIMEOUT_MS,
  ROUTING_RETURN_TO_START: parsed.data.ROUTING_RETURN_TO_START === "true",
};
