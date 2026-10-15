import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import { useQueryClient } from "@tanstack/react-query";
import type { TripDetail, TripWeatherRefresh } from "@triply/shared";
import { refreshTripWeather } from "../api/trips";
import { tripQueryKey } from "./useTrips";

const pending = new Map<string, Promise<TripWeatherRefresh>>();
export function refreshWeatherOnce(id: string): Promise<TripWeatherRefresh> {
  const existing = pending.get(id);
  if (existing) return existing;
  const request = refreshTripWeather(id).finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}

export function useRefreshTripWeather() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: refreshWeatherOnce,
    onSuccess: (response) => {
      client.setQueryData<TripDetail>(tripQueryKey(response.id), current => {
        if (!current || Date.parse(current.updatedAt ?? "") > Date.parse(response.updatedAt) ||
            Date.parse(current.weatherAvailability?.checkedAt ?? "") > Date.parse(response.weatherAvailability.checkedAt ?? "")) return current;
        return {
          ...current, weather: response.weather, weatherAvailability: response.weatherAvailability,
          // Only weather diagnostics change; retain all other cached fields and local edit inputs.
          quality: current.quality ? { ...current.quality,
            issues: [...current.quality.issues.filter(issue => !issue.code.startsWith("WEATHER_")), ...response.weatherIssues] } : current.quality,
        };
      });
    },
  });
}
