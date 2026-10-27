import { contentLocale, type SupportedLocale } from "@triply/shared";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { TripAttraction, TripDayWeather } from "@triply/shared";
import { env } from "../config/env.js";
import { geoapifyCategories, geoapifyClassification } from "./geoapifyCategories.js";
import { normalizePois } from "./poiFiltering.js";
import { scorePois } from "./poiScoring.js";
import { retryAfterMilliseconds } from "./providerReliability.js";
import { estimateGeoapifyCredits, reserveGeoapifyCredits, settleGeoapifyCredits, utcUsageDate } from "./geoapifyUsage.js";

const featureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }),
  properties: z.object({
    place_id: z.string().min(1).max(2000), name: z.string().optional(),
    categories: z.array(z.string()), formatted: z.string().optional(), description: z.string().optional(),
    datasource: z.object({ raw: z.record(z.string(), z.unknown()).optional() }).optional(),
  }).passthrough(),
});
const responseSchema = z.object({ type: z.literal("FeatureCollection"), features: z.array(featureSchema) });
type PlacesResponse = z.infer<typeof responseSchema>;

export interface GeoapifyOptions {
  locale?: SupportedLocale;
  signal?: AbortSignal;
  timeoutMs?: number;
  limit?: number;
  radiusMeters?: number;
  weather?: readonly TripDayWeather[] | null;
}

export function normalizeGeoapifyPlaces(payload: PlacesResponse, lat: number, lng: number, interests: readonly string[], options: GeoapifyOptions = {}): TripAttraction[] {
  const metadata = new Map<string, { sourceId: string; address?: string; description?: string }>();
  const candidates = payload.features.map(feature => {
    const p = feature.properties;
    const id = `geoapify/${createHash("sha256").update(p.place_id).digest("hex")}`;
    const raw = p.datasource?.raw ?? {};
    const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
    metadata.set(id, { sourceId: p.place_id, address: text(p.formatted, 2000), description: text(raw[`description:${contentLocale(options.locale)}`], 10000) ?? text(p.description, 10000) ?? text(raw.description, 10000) });
    return { osmKey: id, lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0],
      tags: { ...geoapifyClassification(p.categories).tags, ...raw, name: p.name ?? raw.name } };
  });
  const pois = normalizePois(candidates, { lat, lng, interests });
  return scorePois(pois, { interests, weather: options.weather ?? null, radiusMeters: options.radiusMeters ?? 5000 }).map(poi => ({
    name: poi.name, category: poi.category, lat: poi.lat, lng: poi.lng, score: poi.score,
    placeId: poi.osmKey, environment: poi.environment, openingHours: poi.openingHours, admission: poi.admission,
    source: "geoapify" as const, ...metadata.get(poi.osmKey!),
  }));
}

export async function fetchGeoapifyPlaces(lat: number, lng: number, interests: readonly string[], options: GeoapifyOptions = {}): Promise<TripAttraction[] | null> {
  if (!env.GEOAPIFY_ENABLED || !env.GEOAPIFY_API_KEY || options.signal?.aborted) return null;
  const limit = options.limit ?? 60;
  const radius = options.radiusMeters ?? 5000;
  const timeout = options.timeoutMs ?? env.GEOAPIFY_TIMEOUT_MS;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(radius) || radius <= 0 ||
      !Number.isSafeInteger(timeout) || timeout <= 0) return null;
  const credits = estimateGeoapifyCredits(limit);
  const url = new URL("https://api.geoapify.com/v2/places");
  url.search = new URLSearchParams({ apiKey: env.GEOAPIFY_API_KEY, categories: geoapifyCategories(interests).join(","),
    filter: `circle:${lng},${lat},${radius}`, bias: `proximity:${lng},${lat}`, limit: String(limit) }).toString();
  console.info({ event: "geoapify-fallback", date: new Date().toISOString().slice(0, 10), dailyLimit: env.GEOAPIFY_DAILY_CREDIT_LIMIT });
  // At most two attempts; no quota/auth retries, redirects, pagination, or unmetered attempts.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.signal?.aborted) return null;
    const reservation = await reserveGeoapifyCredits(credits, env.GEOAPIFY_DAILY_CREDIT_LIMIT);
    if (!reservation) return null;
    if (reservation.date !== utcUsageDate()) {
      await settleGeoapifyCredits(reservation, 0);
      continue; // A slow reservation crossed midnight; acquire today's capacity first.
    }
    if (options.signal?.aborted) {
      await settleGeoapifyCredits(reservation, 0); // Fetch definitely has not started.
      return null;
    }
    let retryDelay: number | null = null;
    let payload: PlacesResponse | null = null;
    try {
      const timeoutSignal = AbortSignal.timeout(timeout);
      const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(url, { signal, redirect: "error" });
      if (response.ok) {
        const parsed = responseSchema.safeParse(await response.json());
        if (parsed.success && parsed.data.features.length <= limit) payload = parsed.data;
      } else if ([502, 503, 504].includes(response.status)) {
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter ? retryAfterMilliseconds(retryAfter) : 250;
        if (delay <= 2000) retryDelay = delay;
      }
      console.info({ event: "external-request", provider: "geoapify", status: payload ? "success" : "failure", httpStatus: response.status, retryCount: attempt });
    } catch {
      // Never log provider errors: their message may contain the authenticated URL.
      console.info({ event: "external-request", provider: "geoapify", status: "failure", retryCount: attempt });
    }
    await settleGeoapifyCredits(reservation, payload ? estimateGeoapifyCredits(Math.max(1, payload.features.length)) : credits);
    if (payload) return normalizeGeoapifyPlaces(payload, lat, lng, interests, options);
    if (retryDelay === null || attempt === 1 || options.signal?.aborted) return null;
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }
  return null;
}
