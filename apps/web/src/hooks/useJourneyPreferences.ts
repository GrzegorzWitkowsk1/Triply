import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IdentitySession, JourneyPreferencesResponse } from "@triply/shared";
import { request } from "../api/client";
import { getSession } from "../api/auth";
import { useIdentityMutation } from "./useIdentityMutation";

export function useJourneyPreferences() {
  const client = useQueryClient();
  const session = useQuery<IdentitySession>({ queryKey: ["auth", "session"], queryFn: getSession, enabled: false });
  const userId = session.data?.status === "authenticated" ? session.data.user.id : undefined;
  const key = ["journey-preferences", userId ?? ""];
  const query = useQuery({ queryKey: key, enabled: Boolean(userId), retry: false, refetchInterval: userId ? 60_000 : false,
    queryFn: ({ signal }) => request<JourneyPreferencesResponse>("/api/profile/preferences/journey", { signal }),
    structuralSharing: (old, incoming) => old && (old as JourneyPreferencesResponse).revision > (incoming as JourneyPreferencesResponse).revision ? old : incoming,
  });
  const mutation = useIdentityMutation({
    mutationFn: (promptForExpenseAfterVisit: boolean) => request<JourneyPreferencesResponse>("/api/profile/preferences/journey", {
      method: "PATCH", body: JSON.stringify({ promptForExpenseAfterVisit, expectedRevision: query.data?.revision ?? 0 }),
    }),
    onMutate: async () => { await client.cancelQueries({ queryKey: key }); },
    onSuccess: data => { client.setQueryData<JourneyPreferencesResponse>(key, current => current && current.revision > data.revision ? current : data); },
    onSettled: () => { void client.invalidateQueries({ queryKey: key }); },
  });
  return { query, mutation, isAccount: Boolean(userId) };
}
