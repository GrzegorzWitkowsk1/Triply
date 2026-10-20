import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collectionDestinationsSchema, findCuratedCollection } from "@triply/shared";
import { requestWithTimeout } from "../api/client";

export function useCollectionDestinations(slug: string | undefined) {
  const client = useQueryClient();
  return useQuery({
    queryKey: ["destinations", "collection", slug],
    enabled: Boolean(findCuratedCollection(slug)),
    queryFn: async ({ signal }) => {
      const result = collectionDestinationsSchema.parse(await requestWithTimeout(`/api/destinations/collections/${encodeURIComponent(slug!)}`, { signal }));
      const collection = findCuratedCollection(slug)!;
      if (result.slug !== slug || result.items.some(item => !collection.destinationIds.includes(item.id)) || new Set(result.items.map(item => item.id)).size !== result.items.length) throw new Error("Invalid collection response");
      if (!signal.aborted) result.items.forEach(item => client.setQueryData(["destinations", "detail", item.id], item));
      return result;
    },
    staleTime: 5 * 60_000, networkMode: "always",
  });
}
