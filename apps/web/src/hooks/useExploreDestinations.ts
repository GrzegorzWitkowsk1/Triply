import { useQuery } from "@tanstack/react-query";
import { destinationListSchema, destinationFiltersSchema, type DestinationQuery } from "@triply/shared";
import { requestWithTimeout as request } from "../api/client";

export function useExploreDestinations(query: DestinationQuery) {
  return useQuery({
    queryKey: ["destinations", "explore", query],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), sort: query.sort });
      if (query.q) params.set("q", query.q);
      if (query.country) params.set("country", query.country);
      if (query.region) params.set("region", query.region);
      if (query.interests.length) params.set("interests", query.interests.join(","));
      return destinationListSchema.parse(await request(`/api/destinations?${params}`, { signal }));
    },
    staleTime: 5 * 60_000,
    networkMode: "always",
  });
}
export function useDestinationFilters() {
  return useQuery({ queryKey: ["destinations", "filters"],
    queryFn: async ({ signal }) => destinationFiltersSchema.parse(await request("/api/destinations/filters", { signal })),
    staleTime: 15 * 60_000,
    networkMode: "always",
  });
}
