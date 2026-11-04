import { getSelectedLanguage } from "../i18n";
import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssistantActionProposal, AssistantActionResult, AssistantConversation, AssistantMessageRequest, AssistantMessageResult } from "@triply/shared";
import { request } from "../api/client";
import { useEffect, useMemo, useRef } from "react";
import { tripQueryKey } from "./useTrips";
import { equipmentQueryKey } from "./useTripEquipment";
import { packingContextQueryKey } from "./usePackingGeneration";

export function useTripAssistant(tripId: string, enabled: boolean) {
  const client = useQueryClient();
  const key = ["trip-assistant", tripId];
  const active = useRef<AbortController | null>(null);
  const scope = useMemo(() => ({ disposed: false }), [tripId]);
  useEffect(() => {
    scope.disposed = false;
    return () => { scope.disposed = true; active.current?.abort(); active.current = null; };
  }, [scope]);
  const history = useQuery({ queryKey: key, enabled: enabled && Boolean(tripId), staleTime: 30000, queryFn: ({ signal }) => request<AssistantConversation>(`/api/trips/${tripId}/assistant/conversations`, { signal }) });
  const send = useMutation({
    onMutate: async () => { await client.cancelQueries({ queryKey: key, exact: true }); return { key }; },
    retry: false,
    networkMode: "always",
    mutationFn: async (input: AssistantMessageRequest) => {
      if (scope.disposed) throw new DOMException("Assistant closed", "AbortError");
      if (active.current) throw new Error("Another message is being processed");
      const controller = new AbortController(); active.current = controller;
      const timer = setTimeout(() => controller.abort(), 45000);
      try {
        const result = await request<AssistantMessageResult>(`/api/trips/${tripId}/assistant/messages`, {
          method: "POST", body: JSON.stringify({ ...input, locale: input.locale ?? getSelectedLanguage() }), signal: controller.signal });
        controller.signal.throwIfAborted();
        if (result.tripId !== tripId || (input.requestId && result.requestId !== input.requestId) || (input.conversationId && result.conversationId !== input.conversationId)) {
          throw new Error("Assistant response does not match the active request");
        }
        return result;
      }
      finally { clearTimeout(timer); if (active.current === controller) active.current = null; }
    },
    onSuccess: (data, _input, context) => client.setQueryData(context.key, data),
  });
  const updateProposal = (proposal: AssistantActionProposal) => client.setQueryData<AssistantConversation>(key, current => current ? {
    ...current, proposals: [...(current.proposals ?? []).filter(p => p.proposalId !== proposal.proposalId), proposal],
  } : current);
  const refreshActionQueries = async (proposal?: AssistantActionProposal) => {
    // A transport error may follow a committed write. Refresh every domain when
    // no receipt is available, without treating the error as proof of success.
    const domains = new Set(proposal?.actions.map(a => a.domain) ?? ["itinerary", "expense"]);
    await Promise.all([
      client.invalidateQueries({ queryKey: tripQueryKey(tripId), exact: true }),
      client.invalidateQueries({ queryKey: key, exact: true }),
      ...(domains.has("itinerary") ? [client.invalidateQueries({ queryKey: ["itinerary-candidates", tripId] })] : []),
      ...(domains.has("itinerary") || domains.has("expense") ? [
        client.invalidateQueries({ predicate: q => q.queryKey[0] === "trips" && (q.queryKey.length === 1 || typeof q.queryKey[1] === "object") }),
        client.invalidateQueries({ queryKey: ["trips", tripId, "budget"], exact: true }),
      ] : []),
      ...(domains.has("itinerary") ? [client.invalidateQueries({ queryKey: equipmentQueryKey(tripId), exact: true }), client.invalidateQueries({ queryKey: packingContextQueryKey(tripId), exact: true })] : []),
    ]);
  };
  const apply = useMutation({
    retry: false, networkMode: "always",
    mutationFn: (proposalId: string) => request<AssistantActionResult>(`/api/trips/${tripId}/assistant/actions/${proposalId}/apply`, { method: "POST", body: JSON.stringify({ locale: getSelectedLanguage() }), signal: AbortSignal.timeout(45000) }),
    onSuccess: async data => {
      updateProposal(data.proposal);
      await refreshActionQueries(data.proposal);
    },
    onError: () => refreshActionQueries(),
  });
  const cancel = useMutation({ retry: false, networkMode: "always",
    mutationFn: (proposalId: string) => request<{ proposal: AssistantActionProposal }>(`/api/trips/${tripId}/assistant/actions/${proposalId}`, { method: "DELETE", signal: AbortSignal.timeout(15000) }),
    onSuccess: data => updateProposal(data.proposal), onError: () => { void client.invalidateQueries({ queryKey: key, exact: true }); },
  });
  return { history, send, apply, cancel };
}
