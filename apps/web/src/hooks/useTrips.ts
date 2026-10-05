import { useQuery } from "@tanstack/react-query";
import type { TripStatus } from "@triply/shared";
import { getTrip, listTrips } from "../api/trips";

export const TRIPS_KEY = ["trips"] as const;

export const tripsQueryKey = (status?: TripStatus) =>
  [...TRIPS_KEY, { status: status ?? null }] as const;

export const tripQueryKey = (id: string) => [...TRIPS_KEY, id] as const;

export function useTrips(status?: TripStatus) {
  return useQuery({
    queryKey: tripsQueryKey(status),
    queryFn: () => listTrips(status ? { status } : {}),
  });
}

export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: tripQueryKey(id ?? ""),
    queryFn: () => getTrip(id as string),
    enabled: Boolean(id),
  });
}