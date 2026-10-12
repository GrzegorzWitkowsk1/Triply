import type { Coordinates, GeoLineString, TravelMode } from "@triply/shared";
import { retryAfterMilliseconds, classifyExternalFailure } from "../../services/providerReliability.js";
import {
  routingConnectionError,
  routingErrorFromHttpStatus,
  routingInvalidResponseError,
  routingUnsupportedModeError,
} from "../errors.js";
import type { RouteLegValue, RouteResult, RoutingProvider, TravelMatrix } from "../types.js";

const USER_AGENT = "Triply/0.1 (trip planning)";
const DEFAULT_BACKOFF_MS = [1_000, 2_000];
const DEFAULT_TOTAL_BUDGET_MS = 20_000;
// Public FOSSGIS endpoints permit at most one request per second. Share the
// reservation across provider instances, days and simultaneous edit requests.
const publicRequestSlots = new Map<string, number>();

async function waitForPublicRequestSlot(url: string, remainingMs: number, mode: TravelMode): Promise<void> {
  const host = new URL(url).hostname;
  if (host !== "routing.openstreetmap.de") return;
  const now = Date.now();
  const slot = Math.max(now, publicRequestSlots.get(host) ?? 0);
  if (slot - now >= remainingMs) throw routingErrorFromHttpStatus(429, "osrm", mode);
  publicRequestSlots.set(host, slot + 1_000);
  if (slot > now) await sleep(slot - now);
}

export interface OsrmConfig {
  baseUrl: string;
  /** OSRM URL profile, independent of Triply's travel mode and the endpoint's graph. */
  profile?: string;
  supportedModes: readonly TravelMode[];
  timeoutMs: number;
  backoffMs?: readonly number[];
  totalBudgetMs?: number;
}

interface OsrmTablePayload {
  code?: unknown;
  durations?: unknown;
  distances?: unknown;
}

interface OsrmRoutePayload {
  code?: unknown;
  routes?: unknown;
}

type AttemptOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; retryable: boolean; reason: string; status?: number; error?: unknown; retryAfterMs?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMatrix(value: unknown, size: number): (number | null)[][] | null {
  if (!Array.isArray(value) || value.length !== size) {
    return null;
  }

  const matrix: (number | null)[][] = [];

  for (const row of value) {
    if (!Array.isArray(row) || row.length !== size) {
      return null;
    }

    matrix.push(row.map((cell) => readNumberOrNull(cell)));
  }

  return matrix;
}

function parseGeometry(value: unknown): GeoLineString | null {
  if (!isRecord(value) || value.type !== "LineString" || !Array.isArray(value.coordinates)) {
    return null;
  }

  const coordinates: [number, number][] = [];

  for (const pair of value.coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) {
      return null;
    }

    const [lng, lat] = pair;

    if (
      typeof lng !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat)
    ) {
      return null;
    }

    coordinates.push([lng, lat]);
  }

  if (coordinates.length === 0) {
    return null;
  }

  return { type: "LineString", coordinates };
}

export function createOsrmProvider(config: OsrmConfig): RoutingProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const supportedModes = [...config.supportedModes];
  const backoffMs = config.backoffMs ?? DEFAULT_BACKOFF_MS;
  const totalBudgetMs = config.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const maxAttempts = 1 + backoffMs.length;

  function supportsMode(mode: TravelMode): boolean {
    return supportedModes.includes(mode);
  }

  function buildUrl(
    service: "table" | "route",
    coordinates: readonly Coordinates[],
    mode: TravelMode,
  ): string {
    const path = coordinates.map((point) => `${point.lng},${point.lat}`).join(";");
    const profile = config.profile ?? mode;
    const url = new URL(`${baseUrl}/${service}/v1/${encodeURIComponent(profile)}/${path}`);

    if (service === "table") {
      url.searchParams.set("annotations", "duration,distance");
    } else {
      url.searchParams.set("overview", "full");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("steps", "false");
    }

    return url.toString();
  }

  async function attemptRequest(url: string, timeoutMs: number): Promise<AttemptOutcome> {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return {
          ok: false,
          retryable: response.status === 429 || response.status >= 500,
          reason: `HTTP ${response.status}`,
          status: response.status,
          retryAfterMs: retryAfterMilliseconds(response.headers?.get("Retry-After")),
        };
      }

      const payload = (await response.json().catch(() => null)) as unknown;

      if (!payload) {
        return { ok: false, retryable: true, reason: "response was not valid JSON" };
      }

      return { ok: true, payload };
    } catch (error) {
      const name = error instanceof Error ? error.name : String(error);

      return { ok: false, retryable: classifyExternalFailure(undefined, error) !== "cancelled", reason: `request failed (${name})`, error };
    }
  }

  async function request(url: string, mode: TravelMode): Promise<unknown> {
    const startedAt = Date.now();
    let lastReason = "not attempted";
    let lastError: unknown;
    let retryAfterMs = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        const delay = Math.max(backoffMs[attempt - 1] ?? 0, retryAfterMs);
        if (Date.now() - startedAt + delay >= totalBudgetMs) break;
        await sleep(delay);
      }

      const remaining = totalBudgetMs - (Date.now() - startedAt);

      if (remaining <= 0) {
        console.error(`[routing] gave up after ${Date.now() - startedAt}ms: ${lastReason}`);
        throw routingConnectionError(lastError ?? new Error(lastReason), "osrm", mode);
      }

      await waitForPublicRequestSlot(url, remaining, mode);
      const requestBudget = totalBudgetMs - (Date.now() - startedAt);
      if (requestBudget <= 0) throw routingConnectionError(new Error("Request budget exhausted"), "osrm", mode);
      const outcome = await attemptRequest(url, Math.min(config.timeoutMs, requestBudget));

      if (outcome.ok) {
        return outcome.payload;
      }

      lastReason = outcome.reason;
      lastError = outcome.error;
      retryAfterMs = outcome.retryAfterMs ?? 0;
      console.info({ event: "external-request", provider: "osrm", status: "failure", category: classifyExternalFailure(outcome.status, outcome.error), retryCount: attempt });
      console.error(
        `[routing] attempt ${attempt + 1}/${maxAttempts} failed (${lastReason}) after ${Date.now() - startedAt}ms`,
      );

      if (!outcome.retryable) {
        throw routingErrorFromHttpStatus(outcome.status ?? 502, "osrm", mode);
      }
    }

    throw routingConnectionError(lastError ?? new Error(lastReason), "osrm", mode);
  }

  return {
    name: "osrm",
    supportedModes,
    supportsMode,

    async getTravelMatrix(
      coordinates: readonly Coordinates[],
      mode: TravelMode,
    ): Promise<TravelMatrix> {
      if (!supportsMode(mode)) {
        throw routingUnsupportedModeError(mode, "osrm");
      }

      if (coordinates.length === 0) {
        return { distancesMeters: [], durationsSeconds: [] };
      }

      const payload = (await request(buildUrl("table", coordinates, mode), mode)) as OsrmTablePayload;

      if (!isRecord(payload) || payload.code !== "Ok") {
        throw routingInvalidResponseError("osrm", mode);
      }

      const durations = parseMatrix(payload.durations, coordinates.length);
      const distances = parseMatrix(payload.distances, coordinates.length);

      if (!durations) {
        throw routingInvalidResponseError("osrm", mode);
      }

      return {
        durationsSeconds: durations,
        distancesMeters: distances ?? durations.map((row) => row.map(() => null)),
      };
    },

    async getRoute(coordinates: readonly Coordinates[], mode: TravelMode): Promise<RouteResult> {
      if (!supportsMode(mode)) {
        throw routingUnsupportedModeError(mode, "osrm");
      }

      if (coordinates.length < 2) {
        return { distanceMeters: 0, durationSeconds: 0, geometry: null, legs: [] };
      }

      const payload = (await request(buildUrl("route", coordinates, mode), mode)) as OsrmRoutePayload;

      if (!isRecord(payload) || payload.code !== "Ok" || !Array.isArray(payload.routes)) {
        throw routingInvalidResponseError("osrm", mode);
      }

      const route = payload.routes[0];

      if (!isRecord(route)) {
        throw routingInvalidResponseError("osrm", mode);
      }

      const legs: RouteLegValue[] = [];

      if (Array.isArray(route.legs)) {
        route.legs.forEach((leg, index) => {
          if (!isRecord(leg)) {
            return;
          }

          legs.push({
            fromIndex: index,
            toIndex: index + 1,
            distanceMeters: readNumberOrNull(leg.distance),
            durationSeconds: readNumberOrNull(leg.duration),
          });
        });
      }

      return {
        distanceMeters: readNumberOrNull(route.distance),
        durationSeconds: readNumberOrNull(route.duration),
        geometry: parseGeometry(route.geometry),
        legs,
      };
    },
  };
}
