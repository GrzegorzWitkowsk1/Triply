import { addDays, diffDaysInclusive, isIsoDate, LIMITS, tripDayWeatherSchema, tripLocationSchema,
  type TripAnalysis, type TripDayWeather, type WeatherAvailability } from "@triply/shared";
import tzLookup from "tz-lookup";
import { TZDate } from "@date-fns/tz";
import { retryAfterMilliseconds } from "./providerReliability.js";
import { WEATHER_POLICY } from "./weatherPolicy.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface WeatherOptions {
  signal?: AbortSignal;
  now?: Date;
  timeoutMs?: number;
  totalBudgetMs?: number;
  backoffMs?: number;
  random?: () => number;
}
export interface WeatherResult {
  days: TripDayWeather[];
  availability: WeatherAvailability;
  fetchedAt: Date | null;
}

export function forecastAvailableAt(date: string, timeZone: string): string {
  const [year, month, day] = addDays(date, -(WEATHER_POLICY.forecastDays - 1)).split("-").map(Number);
  return new Date(new TZDate(year, month - 1, day, 12, 0, 0, timeZone).getTime()).toISOString();
}

export function destinationToday(lat: number, lng: number, now = new Date()): { today: string; timeZone: string } {
  const timeZone = tzLookup(lat, lng);
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return { today: `${part("year")}-${part("month")}-${part("day")}`, timeZone };
}

/** Pure classification, also used to describe legacy saved trips without network calls. */
export function describeWeather(
  analysis: Pick<TripAnalysis, "location" | "startDate" | "endDate">,
  days: readonly TripDayWeather[], previous?: WeatherAvailability | null, now = new Date(),
): WeatherAvailability {
  const base: WeatherAvailability = { status: "temporarily_unavailable", reason: null, canRetry: true,
    checkedAt: previous?.checkedAt ?? null, retryAfter: previous?.retryAfter ?? null,
    timeZone: null, forecastStart: null, forecastEnd: null };
  const location = tripLocationSchema.safeParse(analysis.location);
  if (!location.success) return { ...base, status: "invalid_location", reason: "invalid_location" };
  const { today, timeZone } = destinationToday(location.data.lat, location.data.lng, now);
  base.timeZone = timeZone;
  base.forecastStart = today;
  base.forecastEnd = addDays(today, WEATHER_POLICY.forecastDays - 1);
  const { startDate, endDate } = analysis;
  if (!startDate || !endDate || !isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate ||
      diffDaysInclusive(startDate, endDate) > LIMITS.durationDays) {
    return { ...base, status: "invalid_dates", reason: "invalid_dates", canRetry: false };
  }
  const known = new Set(days.filter(day => tripDayWeatherSchema.safeParse(day).success).map(day => day.date));
  const dates = Array.from({ length: diffDaysInclusive(startDate, endDate) }, (_, i) => addDays(startDate, i));
  const complete = dates.every(date => known.has(date));
  if (complete) {
    const failedRefresh = previous?.reason && ["timeout", "network", "http_error", "invalid_response"].includes(previous.reason);
    return { ...base, status: "available", reason: failedRefresh ? previous!.reason : null,
      canRetry: true, retryAfter: base.retryAfter };
  }
  const supported = dates.filter(date => date >= today && date <= base.forecastEnd!);
  if (!supported.length) {
    if (startDate > base.forecastEnd) return { ...base, status: "not_yet_available", reason: "future_dates", canRetry: true, retryAfter: forecastAvailableAt(startDate, timeZone) };
    return { ...base, status: "unsupported_past", reason: "past_dates", canRetry: false, retryAfter: null };
  }
  const missingSupported = supported.some(date => !known.has(date));
  const failure = previous?.reason && ["timeout", "network", "http_error", "invalid_response"].includes(previous.reason);
  if (dates.some(date => known.has(date))) {
    return { ...base, status: "partial", reason: missingSupported ? (failure ? previous!.reason : "missing_days") :
      endDate > base.forecastEnd ? "future_dates" : "past_dates", canRetry: missingSupported && (failure ? previous!.canRetry : true) };
  }
  return { ...base, status: previous?.status === "rate_limited" ? "rate_limited" : "temporarily_unavailable",
    reason: failure ? previous!.reason : "missing_days", canRetry: failure ? previous!.canRetry : true };
}

/** Strict coverage: a gap must never be mistaken for a complete forecast. */
export function coversForecastRange(days: TripDayWeather[], startDate: string, endDate: string): boolean {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate || diffDaysInclusive(startDate, endDate) > LIMITS.durationDays) return false;
  const dates = new Set(days.filter(day => tripDayWeatherSchema.safeParse(day).success).map(day => day.date));
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) if (!dates.has(date)) return false;
  return true;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function parseDays(payload: unknown, start: string, end: string): TripDayWeather[] | null {
  if (!payload || typeof payload !== "object" || !("daily" in payload)) return null;
  const daily = payload.daily as { time?: unknown; weather_code?: unknown; temperature_2m_max?: unknown } | null;
  if (!daily || !Array.isArray(daily.time) || !Array.isArray(daily.weather_code) || !Array.isArray(daily.temperature_2m_max) ||
      daily.time.length !== daily.weather_code.length || daily.time.length !== daily.temperature_2m_max.length) return null;
  const days: TripDayWeather[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i];
    if (typeof date !== "string" || !isIsoDate(date) || date < start || date > end || seen.has(date)) return null;
    seen.add(date);
    // Null individual values mean missing data, not fabricated conditions. Keep other usable days.
    if (daily.weather_code[i] === null || daily.temperature_2m_max[i] === null) continue;
    const parsed = tripDayWeatherSchema.safeParse({ date, weatherCode: daily.weather_code[i], temperatureMax: daily.temperature_2m_max[i] });
    if (!parsed.success) return null;
    days.push(parsed.data);
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchWeather(
  analysis: Pick<TripAnalysis, "location" | "startDate" | "endDate">, options: WeatherOptions = {},
): Promise<WeatherResult> {
  options.signal?.throwIfAborted();
  const now = options.now ?? new Date();
  let availability: WeatherAvailability = { ...describeWeather(analysis, [], null, now), checkedAt: now.toISOString() };
  const empty = (): WeatherResult => ({ days: [], availability, fetchedAt: null });
  if (["invalid_location", "invalid_dates", "not_yet_available", "unsupported_past"].includes(availability.status)) {
    console.info({ event: "weather-request", provider: "open-meteo", stage: "forecast-exclusion", code: availability.status });
    return empty();
  }
  const start = analysis.startDate! < availability.forecastStart! ? availability.forecastStart! : analysis.startDate!;
  const end = analysis.endDate! > availability.forecastEnd! ? availability.forecastEnd! : analysis.endDate!;
  if (start !== analysis.startDate || end !== analysis.endDate) {
    console.info({ event: "weather-request", provider: "open-meteo", stage: "forecast-exclusion", code: "PARTIAL_DATE_RANGE" });
  }
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(analysis.location!.lat));
  url.searchParams.set("longitude", String(analysis.location!.lng));
  url.searchParams.set("daily", "weather_code,temperature_2m_max");
  url.searchParams.set("timezone", availability.timeZone!);
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);
  url.searchParams.set("forecast_days", String(WEATHER_POLICY.forecastDays));
  const started = performance.now();
  const budget = Math.min(options.totalBudgetMs ?? WEATHER_POLICY.totalBudgetMs, WEATHER_POLICY.totalBudgetMs);
  for (let attempt = 0; attempt <= WEATHER_POLICY.maxRetries; attempt++) {
    options.signal?.throwIfAborted();
    const remaining = budget - (performance.now() - started);
    if (remaining <= 0) return empty();
    let retryDelay = 0;
    let retryable = false;
    console.info({ event: "weather-request", provider: "open-meteo", stage: "started", retryCount: attempt });
    const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(options.timeoutMs ?? WEATHER_POLICY.timeoutMs, remaining))));
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      const response = await fetch(url.toString(), { signal });
      console.info({ event: "weather-request", provider: "open-meteo", stage: "response", httpStatus: response.status, retryCount: attempt });
      if (response.ok) {
        let payload: unknown;
        try { payload = await response.json(); } catch (error) {
          if (signal.aborted) throw error;
          availability = { ...availability, reason: "invalid_response" };
          return empty();
        }
        const days = parseDays(payload, start, end);
        if (days === null) { availability = { ...availability, reason: "invalid_response" }; return empty(); }
        availability = describeWeather(analysis, days, { ...availability, status: "temporarily_unavailable", reason: "missing_days", retryAfter: null }, now);
        return { days, availability, fetchedAt: days.length ? new Date() : null };
      }
      retryable = RETRYABLE.has(response.status);
      retryDelay = retryAfterMilliseconds(response.headers.get("Retry-After"));
      availability = { ...availability, status: response.status === 429 ? "rate_limited" : "temporarily_unavailable",
        reason: "http_error", canRetry: retryable,
        retryAfter: retryDelay ? new Date(Date.now() + retryDelay).toISOString() : null };
    } catch (error) {
      options.signal?.throwIfAborted();
      const timedOut = timeout.aborted || (error instanceof Error && error.name === "TimeoutError");
      console.info({ event: "weather-request", provider: "open-meteo", stage: "failure", code: timedOut ? "timeout" : "network", retryCount: attempt });
      availability = { ...availability, status: "temporarily_unavailable", reason: timedOut ? "timeout" : "network", canRetry: true };
      retryable = true;
    }
    if (!retryable || attempt === WEATHER_POLICY.maxRetries) return empty();
    const backoff = (options.backoffMs ?? WEATHER_POLICY.backoffMs) * 2 ** attempt;
    const delay = Math.max(retryDelay, backoff * (0.75 + (options.random ?? Math.random)() * 0.5));
    // Retry-After is a minimum; end retries rather than shorten it to fit the budget.
    if (delay >= budget - (performance.now() - started)) return empty();
    console.info({ event: "weather-request", provider: "open-meteo", stage: "retry", retryCount: attempt + 1, delayMs: Math.ceil(delay) });
    await wait(delay, options.signal);
  }
  return empty();
}

/** Compatibility for callers expecting only daily data. */
export async function fetchDailyWeather(lat: number, lng: number, startDate: string, endDate: string, options: WeatherOptions = {}): Promise<TripDayWeather[] | null> {
  const result = await fetchWeather({ location: { lat, lng }, startDate, endDate }, options);
  return result.days.length ? result.days : null;
}

/** Preserve usable saved days on failures and respect failure cooldowns, including manual retries. */
export async function ensureWeatherData(
  analysis: Pick<TripAnalysis, "location" | "startDate" | "endDate">, current: TripDayWeather[], fetchedAt: Date | null,
  previous?: WeatherAvailability | null, options: WeatherOptions & { force?: boolean } = {},
): Promise<WeatherResult> {
  const now = options.now ?? new Date();
  const retained = current.filter(day => tripDayWeatherSchema.safeParse(day).success &&
    analysis.startDate && analysis.endDate && day.date >= analysis.startDate && day.date <= analysis.endDate);
  const availability = describeWeather(analysis, retained, previous, now);
  const fresh = fetchedAt !== null && now.getTime() - fetchedAt.getTime() < WEATHER_POLICY.cacheTtlMs;
  const cooling = previous?.checkedAt && now.getTime() - Date.parse(previous.checkedAt) < WEATHER_POLICY.failureCooldownMs;
  const rateCooling = previous?.retryAfter && Date.parse(previous.retryAfter) > now.getTime();
  const supportedComplete = retained.length > 0 && ["available", "partial"].includes(availability.status) && !["missing_days", "timeout", "network", "http_error", "invalid_response"].includes(availability.reason ?? "");
  if (["invalid_location", "invalid_dates", "not_yet_available", "unsupported_past"].includes(availability.status) ||
      (!options.force && fresh && supportedComplete) || rateCooling ||
      (cooling && previous?.reason && ["timeout", "network", "http_error", "invalid_response", "missing_days"].includes(previous.reason))) {
    if (["not_yet_available", "unsupported_past"].includes(availability.status)) {
      console.info({ event: "weather-request", provider: "open-meteo", stage: "forecast-exclusion", code: availability.status });
    }
    return { days: retained, fetchedAt, availability };
  }
  const result = await fetchWeather(analysis, options);
  const merged = new Map(retained.map(day => [day.date, day]));
  for (const day of result.days) merged.set(day.date, day);
  const days = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  const classified = describeWeather(analysis, days, result.availability, now);
  if (!["invalid_dates", "unsupported_past"].includes(classified.status)) {
    classified.canRetry = true;
    classified.retryAfter = new Date(Math.max(now.getTime() + WEATHER_POLICY.failureCooldownMs,
      Date.parse(classified.retryAfter ?? "") || 0)).toISOString();
  }
  return { days, fetchedAt: result.fetchedAt ?? fetchedAt, availability: classified };
}
