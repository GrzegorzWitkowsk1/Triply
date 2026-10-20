import { destinationIdSchema, findCuratedCollection } from "@triply/shared";

/** Shared entry into the existing Home creation wizard. */
export function tripPlanningUrl(destinationId: string, collectionSlug?: string): string {
  const params = new URLSearchParams({ destinationId: destinationIdSchema.parse(destinationId) });
  const collection = findCuratedCollection(collectionSlug);
  if (collection?.destinationIds.includes(destinationId)) params.set("collection", collection.slug);
  return `/home?${params}`;
}
