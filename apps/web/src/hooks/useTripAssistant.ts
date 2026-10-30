import { getSelectedLanguage } from "../i18n";
import { useIdentityMutation as useMutation } from "./useIdentityMutation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssistantConversation, AssistantMessageRequest, AssistantMessageResult, ItineraryEditResponse } from "@triply/shared";
import { request } from "../api/client";
import { tripQueryKey, TRIPS_KEY } from "./useTrips";
import { cacheConfirmedTrip } from "../query/confirmedTrip";

export function useTripAssistant(tripId: string, enabled: boolean) {
  const client = useQueryClient();
  const key = ["trip-assistant", tripId];
  const history = useQuery({ queryKey: key, enabled: enabled && Boolean(tripId), queryFn: ({ signal }) => request<AssistantConversation>(`/api/trips/${tripId}/assistant/conversations`, { signal }) });
  const send = useMutation({
    onMutate: async () => { await client.cancelQueries({ queryKey: key, exact: true }); return { key }; },
    mutationFn: (input: AssistantMessageRequest) => request<AssistantMessageResult>(`/api/trips/${tripId}/assistant/messages`, { method: "POST", body: JSON.stringify({ ...input, locale: getSelectedLanguage() }) }),
    onSuccess: (data, _input, context) => client.setQueryData(context.key, data),
  });
  const apply = useMutation({ mutationFn: (previewId: string) => request<ItineraryEditResponse>(`/api/trips/${tripId}/assistant/actions/${previewId}/apply`, { method: "POST" }), onSuccess: async data => {
    await cacheConfirmedTrip(client, data.trip);
    void client.invalidateQueries({ queryKey: TRIPS_KEY });
    void client.invalidateQueries({ queryKey: ["itinerary-candidates", tripId] });
    void client.invalidateQueries({ queryKey: key });
  } });
  const cancel = useMutation({ mutationFn: (previewId: string) => request<void>(`/api/trips/${tripId}/assistant/actions/${previewId}`, { method: "DELETE" }) });
  return { history, send, apply, cancel };
}
