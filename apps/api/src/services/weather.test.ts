import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, type TripDayWeather } from "@triply/shared";
import { coversForecastRange, fetchDailyWeather } from "./weather.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function forecastResponse(
  time: unknown[],
  weatherCode: unknown[],
  temperatureMax: unknown[],
): Response {
  return jsonResponse({
    daily: {
      time,
      weather_code: weatherCode,
      temperature_2m_max: temperatureMax,
    },
  });
}

function stubFetch(response: Response) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function stubFetchError(error: unknown) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => {
    throw error;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestedParams(mock: ReturnType<typeof vi.fn>): URLSearchParams {
  const [url] = mock.mock.calls[0] as [string];
  return new URL(url).searchParams;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDailyWeather", () => {
  it("requests the forecast and zips daily arrays", async () => {
    const today = todayIso();
    const fetchMock = stubFetch(
      forecastResponse(
        [today, addDays(today, 1)],
        [3, 61],
        [24.2, 18.7],
      ),
    );

    const result = await fetchDailyWeather(48.85, 2.35, today, addDays(today, 1));

    expect(result).toEqual([
      { date: today, weatherCode: 3, temperatureMax: 24.2 },
      { date: addDays(today, 1), weatherCode: 61, temperatureMax: 18.7 },
    ]);

    const params = requestedParams(fetchMock);
    expect(params.get("latitude")).toBe("48.85");
    expect(params.get("longitude")).toBe("2.35");
    expect(params.get("daily")).toBe("weather_code,temperature_2m_max");
    expect(params.get("timezone")).toBe("auto");
    expect(params.get("start_date")).toBe(today);
    expect(params.get("end_date")).toBe(addDays(today, 1));
  });

  it("clamps the end date to the forecast horizon", async () => {
    const today = todayIso();
    const fetchMock = stubFetch(forecastResponse([today], [0], [20]));

    const result = await fetchDailyWeather(48.85, 2.35, today, addDays(today, 60));

    expect(result).toEqual([{ date: today, weatherCode: 0, temperatureMax: 20 }]);
    expect(requestedParams(fetchMock).get("end_date")).toBe(addDays(today, 15));
  });

  it("returns null without calling the network when the start date is beyond the horizon", async () => {
    const today = todayIso();
    const fetchMock = stubFetch(forecastResponse([], [], []));

    const result = await fetchDailyWeather(
      48.85,
      2.35,
      addDays(today, 16),
      addDays(today, 20),
    );

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid coordinates and dates without calling the network", async () => {
    const today = todayIso();
    const fetchMock = stubFetch(forecastResponse([], [], []));

    expect(await fetchDailyWeather(Number.NaN, 2.35, today, today)).toBeNull();
    expect(await fetchDailyWeather(48.85, 2.35, "not-a-date", today)).toBeNull();
    expect(await fetchDailyWeather(48.85, 2.35, addDays(today, 1), today)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on non-2xx responses", async () => {
    stubFetch(jsonResponse({ reason: "out of range" }, 400));

    expect(await fetchDailyWeather(48.85, 2.35, "2026-07-01", "2026-07-05")).toBeNull();
  });

  it("returns null when the request fails", async () => {
    stubFetchError(new TypeError("fetch failed"));

    const today = todayIso();
    expect(await fetchDailyWeather(48.85, 2.35, today, today)).toBeNull();
  });

  it("returns null when daily arrays are missing or mismatched", async () => {
    const today = todayIso();

    stubFetch(jsonResponse({ daily: null }));
    expect(await fetchDailyWeather(48.85, 2.35, today, today)).toBeNull();

    stubFetch(forecastResponse([today], [0], [20, 21]));
    expect(await fetchDailyWeather(48.85, 2.35, today, today)).toBeNull();
  });

  it("returns null when entries are malformed", async () => {
    const today = todayIso();

    stubFetch(forecastResponse(["oops"], [0], [20]));
    expect(await fetchDailyWeather(48.85, 2.35, today, today)).toBeNull();

    stubFetch(forecastResponse([today], ["sunny"], [20]));
    expect(await fetchDailyWeather(48.85, 2.35, today, today)).toBeNull();

    stubFetch(forecastResponse([today], [0], [null]));
    expect(await fetchDailyWeather(48.85, 2.35, today, today)).toBeNull();
  });
});

describe("coversForecastRange", () => {
  const start = todayIso();
  const end = addDays(start, 2);

  function day(date: string): TripDayWeather {
    return { date, weatherCode: 0, temperatureMax: 20 };
  }

  it("rejects an empty forecast", () => {
    expect(coversForecastRange([], start, end)).toBe(false);
  });

  it("rejects a forecast that starts on the wrong day", () => {
    expect(coversForecastRange([day(addDays(start, 1))], start, end)).toBe(false);
  });

  it("accepts a forecast covering the full range", () => {
    const days = [day(start), day(addDays(start, 1)), day(end)];

    expect(coversForecastRange(days, start, end)).toBe(true);
  });

  it("accepts a partial forecast that reaches the current horizon", () => {
    const horizon = addDays(todayIso(), 15);
    const days = [day(start), day(horizon)];

    expect(coversForecastRange(days, start, horizon)).toBe(true);
  });

  it("rejects a partial forecast that stops before the horizon", () => {
    const horizon = addDays(todayIso(), 15);
    const days = [day(start), day(addDays(start, 1))];

    expect(coversForecastRange(days, start, addDays(start, 30))).toBe(false);
  });
});
