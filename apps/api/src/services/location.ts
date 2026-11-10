import { tripLocationSchema, type TripLocation } from "@triply/shared";
import { checkOperation, generationContext, operationSignal } from "./generationContext.js";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

export class DestinationResolutionError extends Error {
  readonly expose = true;
  constructor(message: string, readonly status = 400) { super(message); }
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

function countryName(value: string): string {
  const normalized = normalize(value);
  // Open-Meteo uses the current English short name; stored trips may use either.
  return normalized === "czech republic" ? "czechia" : normalized;
}

const pending = new Map<string, { request: Promise<TripLocation>; controller: AbortController; users: number }>();

/** Search city names, then verify country and uniqueness rather than taking the first hit. */
export async function resolveDestination(city: string, country?: string | null): Promise<TripLocation> {
  checkOperation();
  const key = JSON.stringify([normalize(city), countryName(country ?? "")]);
  let entry = pending.get(key);
  if (!entry) {
    const controller = new AbortController();
    const request = generationContext.exit(() => lookup(city.trim(), country?.trim() || null, controller.signal));
    entry = { request, controller, users: 0 };
    pending.set(key, entry);
  }
  const shared = entry;
  shared.users++;
  const signal = generationContext.getStore()?.signal;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<TripLocation>((resolve, reject) => {
      abort = () => reject(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      shared.request.then(resolve, reject);
      if (signal?.aborted) abort();
    });
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    if (--shared.users === 0) {
      shared.controller.abort();
      if (pending.get(key) === shared) pending.delete(key);
    }
    checkOperation();
  }
}

async function lookup(city: string, country: string | null, signal?: AbortSignal): Promise<TripLocation> {
  if (!city) throw new DestinationResolutionError("Please select a destination before generating your trip.");
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", city);
  url.searchParams.set("count", "100");
  url.searchParams.set("language", "en");
  let results: unknown[];
  try {
    const response = await fetch(url.toString(), { signal: operationSignal(5_000, signal) });
    if (!response.ok) throw new Error("Provider unavailable");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") throw new Error("Invalid response");
    const raw = (payload as { results?: unknown }).results;
    if (raw !== undefined && !Array.isArray(raw)) throw new Error("Invalid response");
    results = raw ?? [];
  } catch {
    checkOperation();
    throw new DestinationResolutionError("Destination lookup is temporarily unavailable. Please try again.", 503);
  }
  const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
  checkOperation();
  const matches = results.filter((candidate): candidate is Record<string, unknown> => {
    if (!candidate || typeof candidate !== "object") return false;
    const row = candidate as Record<string, unknown>;
    if (typeof row.name !== "string" || normalize(row.name) !== normalize(city)) return false;
    if (!country) return true;
    const code = typeof row.country_code === "string" ? row.country_code.toUpperCase() : "";
    const english = /^[A-Z]{2}$/.test(code) ? countryNames.of(code) : undefined;
    return (typeof row.country === "string" && countryName(row.country) === countryName(country)) ||
      (code !== "" && normalize(code) === normalize(country)) ||
      (english !== undefined && countryName(english) === countryName(country));
  });
  if (matches.length === 0) {
    throw new DestinationResolutionError("We couldn't determine the coordinates for this destination. Please select the city again.");
  }
  if (matches.length > 1 || results.length >= 100) {
    throw new DestinationResolutionError("This destination matches more than one city. Please select a more specific destination.");
  }
  const match = matches[0]!;
  const parsed = tripLocationSchema.safeParse({
    lat: match.latitude, lng: match.longitude, city: match.name, country: match.country,
  });
  if (!parsed.success) {
    throw new DestinationResolutionError("Destination lookup returned invalid coordinates. Please select the city again.");
  }
  return parsed.data;
}

/** Compatibility for optional draft enrichment and the existing location search endpoint. */
export async function geocodeLocation(query: string): Promise<TripLocation | null> {
  const [city, ...country] = query.split(",");
  try { return await resolveDestination(city ?? "", country.join(",").trim() || null); }
  catch (error) {
    if (error instanceof DestinationResolutionError) return null;
    throw error;
  }
}
