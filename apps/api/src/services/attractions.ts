import type { TripAttraction, TripDayWeather } from "@triply/shared";
import { INTEREST_FILTERS, type TagValuesFilter } from "./poiCategories.js";
import { normalizeInterests, normalizePois, type RawPoiCandidate } from "./poiFiltering.js";
import { scorePois } from "./poiScoring.js";

const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_BACKOFF_MS = [1_000, 2_000];
const DEFAULT_TOTAL_BUDGET_MS = 60_000;
const ATTRACTIONS_RADIUS_M = 5000;
const ATTRACTIONS_RESULT_CAP = 60;
const SERVER_TIMEOUT_S = 15;
const USER_AGENT = "Triply/0.1 (trip planning)";

const FALLBACK_FILTERS: TagValuesFilter[] = [{ key: "tourism", values: ["attraction"] }];

const ELEMENT_TYPES = ["node", "way", "relation"] as const;

export interface FetchAttractionsOptions {
  endpoints?: readonly string[];
  timeoutMs?: number;
  backoffMs?: readonly number[];
  totalBudgetMs?: number;
  weather?: readonly TripDayWeather[] | null;
}

interface OverpassPayload {
  elements?: unknown;
}

interface OverpassElement {
  id?: unknown;
  type: "node" | "way" | "relation";
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown } | null;
  tags?: Record<string, unknown> | null;
}

type AttemptOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; retryable: boolean; reason: string };

export function selectFilters(interests: readonly string[]): TagValuesFilter[] {
  const byKey = new Map<string, string[]>();

  for (const interest of normalizeInterests(interests)) {
    for (const filter of INTEREST_FILTERS[interest] ?? []) {
      const values = byKey.get(filter.key) ?? [];

      for (const value of filter.values) {
        if (!values.includes(value)) {
          values.push(value);
        }
      }

      byKey.set(filter.key, values);
    }
  }

  if (byKey.size === 0) {
    return FALLBACK_FILTERS;
  }

  return [...byKey].map(([key, values]) => ({ key, values }));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filterPattern(filter: TagValuesFilter): string {
  return `^(${filter.values.map(escapeRegex).join("|")})$`;
}

export function buildOverpassQuery(lat: number, lng: number, interests: readonly string[]): string {
  const filters = selectFilters(interests);
  const around = `(around:${ATTRACTIONS_RADIUS_M},${lat},${lng})`;
  const clauses: string[] = [];

  for (const filter of filters) {
    for (const type of ELEMENT_TYPES) {
      clauses.push(`  ${type}["${filter.key}"~"${filterPattern(filter)}"]${around};`);
    }
  }

  return [
    `[out:json][timeout:${SERVER_TIMEOUT_S}];`,
    "(",
    ...clauses,
    ");",
    "out center tags;",
  ].join("\n");
}

function parseCandidates(payload: OverpassPayload): RawPoiCandidate[] {
  if (!Array.isArray(payload.elements)) {
    return [];
  }

  const candidates: RawPoiCandidate[] = [];

  for (const raw of payload.elements) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const element = raw as OverpassElement;

    if (element.type !== "node" && element.type !== "way" && element.type !== "relation") {
      continue;
    }

    const elLat =
      element.type === "node"
        ? element.lat
        : element.center
          ? element.center.lat
          : undefined;
    const elLng =
      element.type === "node"
        ? element.lon
        : element.center
          ? element.center.lon
          : undefined;
    const tags =
      element.tags && typeof element.tags === "object" ? element.tags : {};
    const osmKey =
      typeof element.id === "number" && Number.isFinite(element.id)
        ? `${element.type}/${element.id}`
        : null;

    candidates.push({ osmKey, lat: elLat, lng: elLng, tags });
  }

  return candidates;
}

function toAttractions(
  payload: OverpassPayload,
  lat: number,
  lng: number,
  interests: readonly string[],
  weather: readonly TripDayWeather[] | null,
): TripAttraction[] {
  const pois = normalizePois(parseCandidates(payload), { lat, lng, interests });
  const scored = scorePois(pois, {
    interests,
    weather,
    radiusMeters: ATTRACTIONS_RADIUS_M,
  });

  return scored.slice(0, ATTRACTIONS_RESULT_CAP).map((poi) => ({
    name: poi.name,
    category: poi.category,
    lat: poi.lat,
    lng: poi.lng,
    score: poi.score,
    placeId: poi.osmKey ?? null,
    environment: poi.environment,
    ...(poi.openingHours ? { openingHours: poi.openingHours } : {}),
    ...(poi.admission ? { admission: poi.admission } : {}),
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptRequest(
  endpoint: string,
  query: string,
  timeoutMs: number,
): Promise<AttemptOutcome> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return {
        ok: false,
        retryable: response.status === 429 || response.status >= 500,
        reason: `HTTP ${response.status}`,
      };
    }

    const payload = (await response.json().catch(() => null)) as unknown;

    if (!payload || typeof payload !== "object") {
      return { ok: false, retryable: true, reason: "response was not valid JSON" };
    }

    if ("remark" in payload && typeof payload.remark === "string" && payload.remark.trim()) {
      return { ok: false, retryable: true, reason: `Overpass: ${payload.remark.slice(0, 300)}` };
    }

    if (!Array.isArray((payload as OverpassPayload).elements)) {
      return { ok: false, retryable: true, reason: "response is missing the elements array" };
    }

    return { ok: true, payload };
  } catch (error) {
    const name = error instanceof Error ? error.name : String(error);

    return { ok: false, retryable: true, reason: `request failed (${name})` };
  }
}

async function fetchAttractionsFromProviders(
  lat: number,
  lng: number,
  interests: readonly string[],
  options: FetchAttractionsOptions = {},
): Promise<TripAttraction[] | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const endpoints = options.endpoints ?? DEFAULT_ENDPOINTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const weather = options.weather ?? null;

  const normalized = normalizeInterests(interests);
  const query = buildOverpassQuery(lat, lng, normalized);
  const startedAt = Date.now();
  let lastReason = "not attempted";

  // Give every provider a chance before retrying any of them.
  for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
    if (attempt > 0) {
      const delay = backoffMs[attempt - 1] ?? 0;
      if (Date.now() - startedAt + delay >= totalBudgetMs) break;
      await sleep(delay);
    }
    for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex += 1) {
      const endpoint = endpoints[endpointIndex];

      const remaining = totalBudgetMs - (Date.now() - startedAt);

      if (remaining <= 0) {
        console.error(
          `[attractions] gave up after ${Date.now() - startedAt}ms: ${lastReason}`,
        );
        return null;
      }

      const providerBudget = Math.max(1, Math.floor(remaining / (endpoints.length - endpointIndex)));
      const outcome = await attemptRequest(endpoint, query, Math.min(timeoutMs, providerBudget));

      if (outcome.ok) {
        if (endpointIndex > 0 || attempt > 0) {
          console.error(
            `[attractions] succeeded via ${endpoint} after ${attempt + 1} attempt(s) in ${Date.now() - startedAt}ms`,
          );
        }

        return toAttractions(
          outcome.payload as OverpassPayload,
          lat,
          lng,
          normalized,
          weather,
        );
      }

      lastReason = `${new URL(endpoint).host}: ${outcome.reason}`;
      console.error(
        `[attractions] round ${attempt + 1}/${backoffMs.length + 1} failed (${lastReason}) after ${Date.now() - startedAt}ms`,
      );

      if (!outcome.retryable) {
        console.error(`[attractions] non-retryable failure, stopping: ${lastReason}`);
        return null;
      }
    }
  }

  console.error(`[attractions] all endpoints failed: ${lastReason}`);
  return null;
}

interface CachedAttractions {
  request: Promise<TripAttraction[] | null>;
  expiresAt: number;
}

const recentRequests = new Map<string, CachedAttractions>();
const FAILURE_COOLDOWN_MS = 15_000;
const SUCCESS_CACHE_MS = 30_000;

export function fetchAttractions(
  lat: number,
  lng: number,
  interests: readonly string[],
  options: FetchAttractionsOptions = {},
): Promise<TripAttraction[] | null> {
  // Explicit transport options are used by isolated provider tests and callers.
  if (options.endpoints || options.timeoutMs !== undefined || options.backoffMs || options.totalBudgetMs !== undefined) {
    return fetchAttractionsFromProviders(lat, lng, interests, options);
  }
  const key = JSON.stringify([lat, lng, [...normalizeInterests(interests)].sort(), options.weather ?? null]);
  const cached = recentRequests.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  if (recentRequests.size >= 200) {
    const oldestKey = recentRequests.keys().next().value;
    if (oldestKey !== undefined) recentRequests.delete(oldestKey);
  }
  const entry: CachedAttractions = {
    request: Promise.resolve(null),
    expiresAt: Infinity,
  };
  entry.request = fetchAttractionsFromProviders(lat, lng, interests, options).then(
    (result) => {
      entry.expiresAt = Date.now() + (result?.length ? SUCCESS_CACHE_MS : FAILURE_COOLDOWN_MS);
      return result;
    },
    (error: unknown) => {
      recentRequests.delete(key);
      throw error;
    },
  );
  recentRequests.set(key, entry);
  return entry.request;
}
