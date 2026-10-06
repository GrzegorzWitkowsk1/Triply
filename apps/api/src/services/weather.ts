import { addDays, diffDaysInclusive, isAfter, isIsoDate, type TripDayWeather } from "@triply/shared";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const FORECAST_HORIZON_DAYS = 15;

interface ForecastPayload {
  daily?: {
    time?: unknown;
    weather_code?: unknown;
    temperature_2m_max?: unknown;
  } | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function coversForecastRange(
  days: TripDayWeather[],
  startDate: string,
  endDate: string,
): boolean {
  if (days.length === 0 || days[0].date !== startDate) {
    return false;
  }

  if (days.length === diffDaysInclusive(startDate, endDate)) {
    return true;
  }

  const horizon = addDays(todayIso(), FORECAST_HORIZON_DAYS);
  const cappedEnd = isAfter(endDate, horizon) ? horizon : endDate;

  return days[days.length - 1].date === cappedEnd;
}

export async function fetchDailyWeather(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<TripDayWeather[] | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  if (!isIsoDate(startDate) || !isIsoDate(endDate) || isAfter(startDate, endDate)) {
    return null;
  }

  const horizon = addDays(todayIso(), FORECAST_HORIZON_DAYS);

  if (isAfter(startDate, horizon)) {
    return null;
  }

  const rangeEnd = isAfter(endDate, horizon) ? horizon : endDate;

  try {
    const url = new URL(FORECAST_URL);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("daily", "weather_code,temperature_2m_max");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", rangeEnd);

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as ForecastPayload | null;

    if (!payload || !payload.daily) {
      return null;
    }

    const { time, weather_code, temperature_2m_max } = payload.daily;

    if (!Array.isArray(time) || !Array.isArray(weather_code) || !Array.isArray(temperature_2m_max)) {
      return null;
    }

    if (time.length === 0 || time.length !== weather_code.length || time.length !== temperature_2m_max.length) {
      return null;
    }

    const days: TripDayWeather[] = [];

    for (let index = 0; index < time.length; index += 1) {
      const date = time[index];
      const weatherCode = weather_code[index];
      const temperatureMax = temperature_2m_max[index];

      if (typeof date !== "string" || !isIsoDate(date)) {
        return null;
      }

      if (typeof weatherCode !== "number" || !Number.isInteger(weatherCode)) {
        return null;
      }

      if (typeof temperatureMax !== "number" || !Number.isFinite(temperatureMax)) {
        return null;
      }

      days.push({ date, weatherCode, temperatureMax });
    }

    return days;
  } catch {
    return null;
  }
}
