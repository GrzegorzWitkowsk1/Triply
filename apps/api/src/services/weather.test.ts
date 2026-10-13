import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, type TripDayWeather } from "@triply/shared";
import { coversForecastRange, describeWeather, destinationToday, ensureWeatherData, fetchDailyWeather, fetchWeather } from "./weather.js";
import { WEATHER_POLICY } from "./weatherPolicy.js";

const NOW = new Date("2026-10-12T12:00:00Z");
const DAY = "2026-10-12";
const analysis = { location: { lat: 41.9, lng: 12.5 }, startDate: DAY, endDate: DAY };
const options = { now: NOW, backoffMs: 0 };
const day = (date = DAY): TripDayWeather => ({ date, weatherCode: 0, temperatureMax: 22 });
function response(dates = [DAY], codes: unknown[] = dates.map(() => 0), temperatures: unknown[] = dates.map(() => 22)) {
  return new Response(JSON.stringify({ daily: { time: dates, weather_code: codes, temperature_2m_max: temperatures } }));
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Open-Meteo forecast reliability", () => {
  it("schedules distant trips at destination noon when the 16-day horizon reaches their start", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await ensureWeatherData({ ...analysis, startDate: "2026-11-20", endDate: "2026-11-20" }, [], null, null, options);
    expect(result.availability.retryAfter).toBe("2026-11-05T11:00:00.000Z");
    expect(fetch).not.toHaveBeenCalled();
    const beforeNoon = await ensureWeatherData({ ...analysis, startDate: "2026-11-20", endDate: "2026-11-20" }, [], null, result.availability,
      { ...options, force: true, now: new Date("2026-11-05T10:59:00Z") });
    expect(beforeNoon.availability.retryAfter).toBe(result.availability.retryAfter);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requests valid Rome weather once with explicit destination timezone and documented horizon", async () => {
    const fetch = vi.fn(async (_url: string) => response()); vi.stubGlobal("fetch", fetch);
    const result = await fetchWeather(analysis, options);
    expect(result.days).toEqual([day()]);
    expect(result.availability.status).toBe("available");
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get("timezone")).toBe("Europe/Rome");
    expect(url.searchParams.get("forecast_days")).toBe("16");
    expect(url.searchParams.get("start_date")).toBe(DAY);
    expect(url.searchParams.get("end_date")).toBe(DAY);
  });

  it.each([500, 502, 503, 504])("retries HTTP %s and recovers", async status => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status })).mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetch);
    expect((await fetchWeather(analysis, options)).availability.status).toBe("available");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honors 429 Retry-After before retrying", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "1" } })).mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetch);
    const pending = fetchWeather(analysis, options);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).availability.status).toBe("available");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not shorten Retry-After to fit the time budget", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetch);
    const result = await fetchWeather(analysis, { ...options, totalBudgetMs: 100 });
    expect(result.availability.status).toBe("rate_limited");
    expect(result.availability.retryAfter).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries timeouts and network failures", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"))
      .mockRejectedValueOnce(new TypeError("Connection reset")).mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetch);
    expect((await fetchWeather(analysis, options)).availability.status).toBe("available");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("bounds retries and retains timeout failure state", async () => {
    const fetch = vi.fn(async () => { throw new DOMException("Timed out", "TimeoutError"); });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchWeather(analysis, options);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.availability).toMatchObject({ status: "temporarily_unavailable", reason: "timeout" });
  });

  it("uses exponential backoff and bounded jitter", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const fetch = vi.fn(async () => new Response("", { status: 503 })); vi.stubGlobal("fetch", fetch);
    const pending = fetchWeather(analysis, { ...options, backoffMs: 100, random: () => 0.5 });
    await vi.advanceTimersByTimeAsync(99); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); await pending; expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403])("does not retry permanent HTTP %s", async status => {
    const fetch = vi.fn(async () => new Response("", { status })); vi.stubGlobal("fetch", fetch);
    expect((await fetchWeather(analysis, options)).availability.canRetry).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: NaN, lng: 0 }, { lat: Infinity, lng: 0 }, null])(
    "rejects invalid coordinates without a request (%j)", async location => {
      const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
      expect((await fetchWeather({ ...analysis, location }, options)).availability.status).toBe("invalid_location");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("accepts zero coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    expect((await fetchWeather({ ...analysis, location: { lat: 0, lng: 0 } }, options)).availability.status).toBe("available");
  });

  it("excludes unsupported future dates without requests or retries", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const future = addDays(DAY, WEATHER_POLICY.forecastDays);
    const result = await fetchWeather({ ...analysis, startDate: future, endDate: addDays(future, 2) }, options);
    expect(result.availability).toMatchObject({ status: "not_yet_available", canRetry: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("classifies past dates separately and does not silently request history", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const past = addDays(DAY, -1);
    expect((await fetchWeather({ ...analysis, startDate: past, endDate: past }, options)).availability.status).toBe("unsupported_past");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clips partial trip ranges to supported calendar dates", async () => {
    const end = addDays(DAY, WEATHER_POLICY.forecastDays - 1);
    const dates = Array.from({ length: WEATHER_POLICY.forecastDays }, (_, i) => addDays(DAY, i));
    const fetch = vi.fn(async (_url: string) => response(dates)); vi.stubGlobal("fetch", fetch);
    const result = await fetchWeather({ ...analysis, startDate: addDays(DAY, -2), endDate: addDays(end, 2) }, options);
    expect(result.availability).toMatchObject({ status: "partial", canRetry: false });
    expect(result.days).toHaveLength(16);
    const params = new URL(String(fetch.mock.calls[0]![0])).searchParams;
    expect(params.get("start_date")).toBe(DAY); expect(params.get("end_date")).toBe(end);
  });

  it("uses destination calendar dates across UTC midnight and DST", () => {
    expect(destinationToday(35.68, 139.69, new Date("2026-10-12T23:30:00Z"))).toEqual({ today: "2026-10-13", timeZone: "Asia/Tokyo" });
    expect(destinationToday(34.05, -118.24, new Date("2026-10-12T00:30:00Z"))).toEqual({ today: "2026-10-11", timeZone: "America/Los_Angeles" });
    expect(destinationToday(41.9, 12.5, new Date("2026-10-25T23:30:00Z"))).toEqual({ today: "2026-10-26", timeZone: "Europe/Rome" });
  });

  it("retains usable days when individual provider days are null", async () => {
    const next = addDays(DAY, 1);
    vi.stubGlobal("fetch", vi.fn(async () => response([DAY, next], [0, null], [22, null])));
    const result = await fetchWeather({ ...analysis, endDate: next }, options);
    expect(result.days).toEqual([day()]);
    expect(result.availability).toMatchObject({ status: "partial", reason: "missing_days", canRetry: true });
  });

  it.each([{}, { daily: null }, { daily: { time: [DAY], weather_code: [0], temperature_2m_max: [22, 23] } },
    { daily: { time: [DAY], weather_code: ["sunny"], temperature_2m_max: [22] } }])("does not retry malformed provider responses (%j)", async payload => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(payload))); vi.stubGlobal("fetch", fetch);
    expect((await fetchWeather(analysis, options)).availability.reason).toBe("invalid_response");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels retries during backoff", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => { setTimeout(() => controller.abort(), 1); return new Response("", { status: 503 }); });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchWeather(analysis, { ...options, signal: controller.signal, backoffMs: 100 })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels an active request without retrying", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      controller.abort();
    })); vi.stubGlobal("fetch", fetch);
    await expect(fetchWeather(analysis, { ...options, signal: controller.signal })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains existing partial data on failure and applies a retry cooldown", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 503 })); vi.stubGlobal("fetch", fetch);
    const input = { ...analysis, endDate: addDays(DAY, 1) };
    const result = await ensureWeatherData(input, [day()], NOW, null, { ...options, force: true });
    expect(result.days).toEqual([day()]);
    expect(result.availability).toMatchObject({ status: "partial", reason: "http_error" });
    expect(result.availability.retryAfter).toBe(new Date(NOW.getTime() + 600_000).toISOString());
    await ensureWeatherData(input, result.days, result.fetchedAt, result.availability, { ...options, force: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("uses complete fresh cached data without another lookup", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await ensureWeatherData(analysis, [day()], NOW, null, options)).availability.status).toBe("available");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves a complete saved forecast and the reason a manual refresh failed", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 503 })); vi.stubGlobal("fetch", fetch);
    const result = await ensureWeatherData(analysis, [day()], NOW, null, { ...options, force: true });
    expect(result.days).toEqual([day()]);
    expect(result.availability).toMatchObject({ status: "available", reason: "http_error", canRetry: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not repeatedly request a saved permanent provider failure", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 403 })); vi.stubGlobal("fetch", fetch);
    const failed = await ensureWeatherData(analysis, [], null, null, options);
    await ensureWeatherData(analysis, [], null, failed.availability, { ...options, now: new Date(NOW.getTime() + 60_000) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("recognizes newly supported days as the horizon advances", () => {
    const input = { ...analysis, endDate: addDays(DAY, 16) };
    const days = Array.from({ length: 16 }, (_, i) => day(addDays(DAY, i)));
    const previous = describeWeather(input, days, null, NOW);
    expect(previous.canRetry).toBe(false);
    expect(describeWeather(input, days, previous, new Date(NOW.getTime() + 86_400_000)).canRetry).toBe(true);
  });

  it("maintains the daily-array compatibility API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    expect(await fetchDailyWeather(41.9, 12.5, DAY, DAY, options)).toEqual([day()]);
  });

  it("requires every date for forecast coverage", () => {
    const end = addDays(DAY, 2);
    expect(coversForecastRange([day(), day(end)], DAY, end)).toBe(false);
    expect(coversForecastRange([day(), day(addDays(DAY, 1)), day(end)], DAY, end)).toBe(true);
  });
});
