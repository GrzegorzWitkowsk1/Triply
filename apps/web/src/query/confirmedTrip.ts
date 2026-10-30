import type { QueryClient } from "@tanstack/react-query";
import type { IdentitySession, TripDetail } from "@triply/shared";
import { tripQueryKey } from "../hooks/useTrips";

/** A late response must not replace a newer confirmed schedule or diagnostics. */
export async function cacheConfirmedTrip(client: QueryClient, trip: TripDetail) {
  const owner = () => {
    const session = client.getQueryData<IdentitySession>(["auth", "session"]);
    return session?.status === "authenticated" ? `user:${session.user.id}` : session?.status === "guest" ? `guest:${session.guest.id}` : "anonymous";
  };
  const startedAs = owner();
  const key = tripQueryKey(trip.id);
  await client.cancelQueries({ queryKey: key });
  if (owner() !== startedAs) return;
  client.setQueryData<TripDetail>(key, current => (current?.itineraryVersion ?? -1) > (trip.itineraryVersion ?? 0) ? current : trip);
}
