import { weatherAvailabilityMessage, type ItineraryIssue } from "@triply/shared";
import type { TripRecord } from "../models/Trip.js";
import { describeWeather } from "./weather.js";

/** Weather diagnostics are informational and never change itinerary feasibility. */
export function weatherIssues(trip: TripRecord): ItineraryIssue[] {
  const availability = describeWeather(trip.analysis, trip.weather, trip.weatherAvailability);
  if (availability.status === "available") return [];
  const message = weatherAvailabilityMessage(availability);
  if (!message) return [];
  return (trip.itinerary?.days ?? []).filter(day => !trip.weather.some(forecast => forecast.date === day.date)).map(day => ({
    code: `WEATHER_${availability.status.toUpperCase()}`, severity: "info", dimension: "dataCompleteness",
    message, dayId: String(day.dayIndex), details: { reason: availability.reason },
  }));
}
