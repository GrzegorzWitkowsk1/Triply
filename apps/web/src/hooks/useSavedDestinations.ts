import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SavedDestinationIdsResponse, SavedDestinationsResponse } from "@triply/shared";
import { useAuth } from "../auth/AuthProvider";
import { getSavedDestinationIds, listSavedDestinations, saveDestination, unsaveDestination } from "../api/saved";
import { useIdentityMutation } from "./useIdentityMutation";

export function useSavedIdentity() {
  const { user, guest, status } = useAuth();
  return { id: user ? `user:${user.id}` : guest ? `guest:${guest.id}` : "anonymous", enabled: status === "guest" || status === "authenticated" };
}
export function useSavedDestinations() {
  const identity = useSavedIdentity();
  return useQuery({ queryKey: ["saved", identity.id, "list"], queryFn: ({ signal }) => listSavedDestinations(signal), enabled: identity.enabled });
}
export function useSavedDestinationIds() {
  const identity = useSavedIdentity();
  return useQuery({ queryKey: ["saved", identity.id, "ids"], queryFn: ({ signal }) => getSavedDestinationIds(signal), enabled: identity.enabled, staleTime: 60_000 });
}
export function useIsDestinationSaved(id: string) {
  return useSavedDestinationIds().data?.destinationIds.includes(id) ?? false;
}
function useDestinationMutation(save: boolean) {
  const client = useQueryClient();
  const identity = useSavedIdentity();
  return useIdentityMutation({
    mutationKey: ["saved", identity.id],
    mutationFn: save ? saveDestination : unsaveDestination,
    onSuccess: (_data, id) => {
      void client.cancelQueries({ queryKey: ["saved", identity.id], predicate: query => query.queryKey[2] !== "attractions" });
      client.setQueryData<SavedDestinationIdsResponse>(["saved", identity.id, "ids"], old => old ? ({ destinationIds: save ? [...new Set([...old.destinationIds, id])] : old.destinationIds.filter(value => value !== id) }) : undefined);
      if (!save) client.setQueryData<SavedDestinationsResponse>(["saved", identity.id, "list"], old => old ? ({ destinations: old.destinations.filter(row => row.destinationId !== id) }) : undefined);
      void client.invalidateQueries({ queryKey: ["saved", identity.id], predicate: query => query.queryKey[2] !== "attractions" });
    },
  });
}
export const useSaveDestination = () => useDestinationMutation(true);
export const useUnsaveDestination = () => useDestinationMutation(false);
export function useDestinationPending(id: string) {
  const identity = useSavedIdentity();
  return useIsMutating({ mutationKey: ["saved", identity.id], predicate: mutation => mutation.state.variables === id }) > 0;
}
