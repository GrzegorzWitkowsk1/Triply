import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TripDetail, TripStatus } from "@triply/shared";
import { deleteTrip, getTrip, listTrips } from "../api/trips";
import { GUEST_USAGE_KEY } from "./useGuestUsage";

export const TRIPS_KEY = ["trips"] as const;

export function useDeleteTrip() {
  const client = useQueryClient();
  return useMutation({ mutationFn: deleteTrip, onSuccess: async (_result, id) => {
    await client.cancelQueries({ queryKey: TRIPS_KEY });
    client.removeQueries({ queryKey: tripQueryKey(id), exact: true });
    void client.invalidateQueries({ queryKey: TRIPS_KEY });
    void client.invalidateQueries({ queryKey: GUEST_USAGE_KEY });
  } });
}

export const tripsQueryKey = (status?: TripStatus) =>
  [...TRIPS_KEY, { status: status ?? null }] as const;

export const tripQueryKey = (id: string) => [...TRIPS_KEY, id] as const;

export function useTrips(status?: TripStatus) {
  return useQuery({
    queryKey: tripsQueryKey(status),
    queryFn: () => listTrips(status ? { status } : {}),
  });
}

const GENERATING_POLL_MS = 4000;

export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: tripQueryKey(id ?? ""),
    queryFn: () => getTrip(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      (query.state.data as TripDetail | undefined)?.status === "generating"
        ? GENERATING_POLL_MS
        : false,
  });
}
