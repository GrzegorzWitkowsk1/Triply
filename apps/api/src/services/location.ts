import type { TripLocation } from "@triply/shared";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

export interface GeocodeOptions {
  query: string;
  count?: number;
  language?: string;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  city: string | null;
  country: string | null;
  displayName: string | null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

export async function geocodeLocation(
  query: string,
): Promise<TripLocation | null> {
  const q = normalizeText(query);

  if (!q) {
    return null;
  }

  try {
    const url = new URL(GEOCODING_URL);
    url.searchParams.set("name", q);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");

    const response = await fetch(url.toString());

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          results?: Array<{
            latitude: number;
            longitude: number;
            name?: string;
            city?: string;
            town?: string;
            village?: string;
            admin1?: string;
            country?: string;
            country_code?: string;
          }>;
        }
      | null;

    if (!payload || !Array.isArray(payload.results) || payload.results.length === 0) {
      return null;
    }

    const result = payload.results[0];
    const lat = Number(result.latitude);
    const lng = Number(result.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    const city = normalizeText(
      result.name ?? result.city ?? result.town ?? result.village ?? result.admin1,
    );
    const country = normalizeText(result.country);

    return {
      lat,
      lng,
      city: city ?? null,
      country: country ?? null,
    };
  } catch {
    return null;
  }
}
