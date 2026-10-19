import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SavedAttractionKeysResponse, SavedAttractionsResponse } from "@triply/shared";
import { getSavedAttractionKeys, listSavedAttractions, saveAttraction, unsaveAttraction } from "../api/saved";
import { useSavedIdentity } from "./useSavedDestinations";
import { useIdentityMutation } from "./useIdentityMutation";

export function useSavedAttractions() {
  const identity = useSavedIdentity();
  return useQuery({ queryKey: ["saved", identity.id, "attractions", "list"], queryFn: ({ signal }) => listSavedAttractions(signal), enabled: identity.enabled });
}
export function useSavedAttractionKeys() {
  const identity = useSavedIdentity();
  return useQuery({ queryKey: ["saved", identity.id, "attractions", "keys"], queryFn: ({ signal }) => getSavedAttractionKeys(signal), enabled: identity.enabled, staleTime: 60_000 });
}
export function useIsAttractionSaved(key: string) {
  return useSavedAttractionKeys().data?.attractionKeys.includes(key) ?? false;
}
function useAttractionMutation(save: boolean) {
  const client = useQueryClient();
  const identity = useSavedIdentity();
  const prefix = ["saved", identity.id, "attractions"];
  return useIdentityMutation({
    mutationKey: prefix,
    mutationFn: (input: { attractionKey: string; tripId?: string }) => {
      if (!save) return unsaveAttraction(input.attractionKey);
      if (!input.tripId) throw new Error("Open a trip to save this attraction.");
      return saveAttraction({ tripId: input.tripId, attractionKey: input.attractionKey });
    },
    onSuccess: (_data, { attractionKey }) => {
      void client.cancelQueries({ queryKey: prefix });
      client.setQueryData<SavedAttractionKeysResponse>([...prefix, "keys"], old => old ? ({ attractionKeys: save ? [...new Set([...old.attractionKeys, attractionKey])] : old.attractionKeys.filter(key => key !== attractionKey) }) : undefined);
      if (!save) client.setQueryData<SavedAttractionsResponse>([...prefix, "list"], old => old ? ({ attractions: old.attractions.filter(row => row.attractionKey !== attractionKey) }) : undefined);
      void client.invalidateQueries({ queryKey: prefix });
    },
  });
}
export const useSaveAttraction = () => useAttractionMutation(true);
export const useUnsaveAttraction = () => useAttractionMutation(false);
export function useAttractionPending(key: string) {
  const identity = useSavedIdentity();
  return useIsMutating({ mutationKey: ["saved", identity.id, "attractions"], predicate: mutation => (mutation.state.variables as { attractionKey?: string } | undefined)?.attractionKey === key }) > 0;
}
