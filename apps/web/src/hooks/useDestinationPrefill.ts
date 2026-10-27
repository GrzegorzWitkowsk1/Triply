import i18n from "../i18n";
import { useQuery } from "@tanstack/react-query";
import { catalogDestinationSchema, destinationIdSchema } from "@triply/shared";
import { requestWithTimeout as request } from "../api/client";

export function destinationReference(search: string, legacyState?: unknown): { id?: string; error?: string } {
  const values = new URLSearchParams(search).getAll("destinationId");
  const legacy = legacyState && typeof legacyState === "object" && "destinationId" in legacyState ? legacyState.destinationId : undefined;
  if (!values.length && legacy === undefined) return {};
  const parsed = destinationIdSchema.safeParse(values.length ? values[0] : legacy);
  if (values.length > 1 || !parsed.success) return { error: i18n.t("invalidDestinationLink", { ns: "tripCreator/home" }) };
  return { id: parsed.data };
}
export function useDestinationPrefill(search: string, legacyState?: unknown) {
  const reference = destinationReference(search, legacyState);
  const query = useQuery({
    queryKey: ["destinations", "detail", reference.id],
    queryFn: async ({ signal }) => {
      const destination = catalogDestinationSchema.parse(await request(`/api/destinations/${encodeURIComponent(reference.id!)}`, { signal }));
      if (destination.id !== reference.id) throw new Error("Destination reference mismatch");
      return destination;
    },
    enabled: Boolean(reference.id), staleTime: 5 * 60_000, retry: false,
    networkMode: "always",
  });
  return { reference, query };
}
