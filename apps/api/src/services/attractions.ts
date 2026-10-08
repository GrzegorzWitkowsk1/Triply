import type { TripAttraction } from "@triply/shared";

const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_BACKOFF_MS = [1_000, 2_000];
const DEFAULT_TOTAL_BUDGET_MS = 60_000;
const ATTRACTIONS_RADIUS_M = 5000;
const ATTRACTIONS_RESULT_CAP = 60;
const SERVER_TIMEOUT_S = 20;
const USER_AGENT = "Triply/0.1 (trip planning)";

interface TagValuesFilter {
  key: string;
  values: string[];
}

const INTEREST_FILTERS: Record<string, TagValuesFilter[]> = {
  food: [{ key: "amenity", values: ["restaurant", "cafe", "fast_food", "food_court", "ice_cream"] }],
  architecture: [
    {
      key: "historic",
      values: ["castle", "palace", "ruins", "monument", "memorial", "archaeological_site", "manor"],
    },
    { key: "building", values: ["cathedral", "church", "mosque", "synagogue", "temple"] },
  ],
  beach: [
    { key: "natural", values: ["beach"] },
    { key: "leisure", values: ["beach_resort"] },
  ],
  nature: [
    { key: "leisure", values: ["park", "garden", "nature_reserve"] },
    { key: "natural", values: ["peak", "waterfall", "volcano", "spring"] },
  ],
  culture: [
    { key: "tourism", values: ["museum", "gallery", "artwork"] },
    { key: "amenity", values: ["theatre", "arts_centre", "library"] },
  ],
  shopping: [
    { key: "amenity", values: ["marketplace"] },
    { key: "shop", values: ["mall", "department_store", "gift", "souvenir", "clothes", "books"] },
  ],
  nightlife: [{ key: "amenity", values: ["bar", "pub", "nightclub", "biergarten", "casino"] }],
};

const FALLBACK_CATEGORY = "attraction";
const FALLBACK_FILTERS: TagValuesFilter[] = [{ key: "tourism", values: ["attraction"] }];

const ELEMENT_TYPES = ["node", "way", "relation"] as const;

export interface FetchAttractionsOptions {
  endpoints?: readonly string[];
  timeoutMs?: number;
  backoffMs?: readonly number[];
  totalBudgetMs?: number;
}

interface OverpassPayload {
  elements?: unknown;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown } | null;
  tags?: Record<string, unknown> | null;
}

type AttemptOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; retryable: boolean; reason: string };

function normalizeInterests(interests: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const interest of interests) {
    const value = interest.trim().toLowerCase();

    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

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

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;

  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

function matchCategory(
  tags: Record<string, unknown>,
  interests: readonly string[],
): string | null {
  for (const interest of interests) {
    for (const filter of INTEREST_FILTERS[interest] ?? []) {
      const value = tags[filter.key];

      if (typeof value === "string" && filter.values.includes(value)) {
        return interest;
      }
    }
  }

  return null;
}

function toAttraction(
  element: OverpassElement,
  lat: number,
  lng: number,
  interests: readonly string[],
  isFallback: boolean,
): TripAttraction | null {
  const tags = element.tags ?? {};
  const name = typeof tags.name === "string" ? tags.name.trim() : "";

  if (!name) {
    return null;
  }

  const category = isFallback ? FALLBACK_CATEGORY : matchCategory(tags, interests);

  if (category === null) {
    return null;
  }

  return { name: name.slice(0, 200), category, lat, lng };
}

function parseElements(
  payload: OverpassPayload,
  lat: number,
  lng: number,
  interests: readonly string[],
  isFallback: boolean,
): TripAttraction[] {
  if (!Array.isArray(payload.elements)) {
    return [];
  }

  const attractions: (TripAttraction & { distance: number })[] = [];

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

    if (typeof elLat !== "number" || typeof elLng !== "number") {
      continue;
    }

    if (!Number.isFinite(elLat) || !Number.isFinite(elLng)) {
      continue;
    }

    const attraction = toAttraction(element, elLat, elLng, interests, isFallback);

    if (!attraction) {
      continue;
    }

    attractions.push({
      ...attraction,
      distance: distanceMeters(lat, lng, elLat, elLng),
    });
  }

  attractions.sort((a, b) => a.distance - b.distance);

  return attractions.slice(0, ATTRACTIONS_RESULT_CAP).map(({ distance: _distance, ...rest }) => rest);
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

    if (!payload) {
      return { ok: false, retryable: true, reason: "response was not valid JSON" };
    }

    return { ok: true, payload };
  } catch (error) {
    const name = error instanceof Error ? error.name : String(error);

    return { ok: false, retryable: true, reason: `request failed (${name})` };
  }
}

export async function fetchAttractions(
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

  const normalized = normalizeInterests(interests);
  const isFallback = selectFilters(normalized) === FALLBACK_FILTERS;
  const query = buildOverpassQuery(lat, lng, normalized);
  const startedAt = Date.now();
  let lastReason = "not attempted";

  for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex += 1) {
    const endpoint = endpoints[endpointIndex];
    const maxAttempts = endpointIndex === 0 ? 1 + backoffMs.length : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(backoffMs[attempt - 1] ?? 0);
      }

      const remaining = totalBudgetMs - (Date.now() - startedAt);

      if (remaining <= 0) {
        console.error(
          `[attractions] gave up after ${Date.now() - startedAt}ms: ${lastReason}`,
        );
        return null;
      }

      const outcome = await attemptRequest(endpoint, query, Math.min(timeoutMs, remaining));

      if (outcome.ok) {
        if (endpointIndex > 0 || attempt > 0) {
          console.error(
            `[attractions] succeeded via ${endpoint} after ${attempt + 1} attempt(s) in ${Date.now() - startedAt}ms`,
          );
        }

        return parseElements(outcome.payload as OverpassPayload, lat, lng, normalized, isFallback);
      }

      lastReason = `${new URL(endpoint).host}: ${outcome.reason}`;
      console.error(
        `[attractions] attempt ${attempt + 1}/${maxAttempts} failed (${lastReason}) after ${Date.now() - startedAt}ms`,
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
