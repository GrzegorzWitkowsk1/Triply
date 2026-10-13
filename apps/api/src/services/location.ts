import { tripLocationSchema, type TripLocation } from "@triply/shared";

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

const pending = new Map<string, Promise<TripLocation>>();

/** Search city names, then verify country and uniqueness rather than taking the first hit. */
export function resolveDestination(city: string, country?: string | null): Promise<TripLocation> {
  const key = JSON.stringify([normalize(city), countryName(country ?? "")]);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = lookup(city.trim(), country?.trim() || null).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

async function lookup(city: string, country: string | null): Promise<TripLocation> {
  if (!city) throw new DestinationResolutionError("Please select a destination before generating your trip.");
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", city);
  url.searchParams.set("count", "100");
  url.searchParams.set("language", "en");
  let results: unknown[];
  try {
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error("Provider unavailable");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") throw new Error("Invalid response");
    const raw = (payload as { results?: unknown }).results;
    if (raw !== undefined && !Array.isArray(raw)) throw new Error("Invalid response");
    results = raw ?? [];
  } catch {
    throw new DestinationResolutionError("Destination lookup is temporarily unavailable. Please try again.", 503);
  }
  const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
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
