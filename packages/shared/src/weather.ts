import { z } from "zod";
import type { ItineraryIssue } from "./quality.js";
import type { TripDayWeather } from "./trip.js";

export const WEATHER_STATUS_VALUES = ["available", "not_yet_available", "temporarily_unavailable", "rate_limited", "invalid_location", "partial", "unsupported_past", "invalid_dates"] as const;
export const WEATHER_REASON_VALUES = ["timeout", "network", "http_error", "invalid_response", "missing_days", "future_dates", "past_dates", "invalid_dates", "invalid_location"] as const;
export const weatherAvailabilitySchema = z.object({
  status: z.enum(WEATHER_STATUS_VALUES),
  reason: z.enum(WEATHER_REASON_VALUES).nullable(),
  canRetry: z.boolean(),
  checkedAt: z.iso.datetime().nullable(),
  retryAfter: z.iso.datetime().nullable(),
  timeZone: z.string().nullable(),
  forecastStart: z.string().nullable(),
  forecastEnd: z.string().nullable(),
});
export type WeatherAvailability = z.infer<typeof weatherAvailabilitySchema>;

export function weatherAvailabilityMessage(availability: WeatherAvailability): string | null {
  switch (availability.status) {
    case "available": return availability.reason ? "Weather refresh is temporarily unavailable. Saved forecasts are still shown." : null;
    case "not_yet_available": return "Forecast not available yet. Check again closer to your trip.";
    case "unsupported_past": return "Forecasts are unavailable for past dates. Historical weather is not shown.";
    case "invalid_dates": return "Select trip dates to retrieve a weather forecast.";
    case "invalid_location": return "Select a valid destination to retrieve weather.";
    case "rate_limited": return "The weather provider is receiving too many requests. Please try again later.";
    case "partial": return "Weather forecasts are available for some days only.";
    case "temporarily_unavailable":
      if (availability.reason === "invalid_response") return "The weather provider returned incomplete or invalid data. Please try again later.";
      if (!availability.canRetry) return "Weather could not be retrieved. Please check the destination and trip dates.";
      return availability.reason === "timeout" ? "Weather lookup timed out. Please try again." : "Weather information is temporarily unavailable. Try again.";
  }
}

/** Weather-only response; deliberately excludes itinerary and budget mutations. */
export interface TripWeatherRefresh {
  id: string;
  weather: TripDayWeather[];
  weatherAvailability: WeatherAvailability;
  weatherIssues: ItineraryIssue[];
  updatedAt: string;
}
