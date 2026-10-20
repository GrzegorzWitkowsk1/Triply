import { z } from "zod";
import { catalogDestinationSchema } from "./destinationCatalog.js";
import type { Pace } from "./trip.js";

export interface CuratedCollection {
  slug: string;
  title: string;
  description: string;
  icon: "food" | "architecture" | "coastal" | "culture";
  color: string;
  destinationIds: readonly string[];
  suggestedInterests: readonly string[];
  suggestedPace: Pace;
  displayOrder: number;
}

/** Existing editorial associations, not destination rankings or inferred tags. */
export const CURATED_COLLECTIONS: readonly CuratedCollection[] = [
  { slug: "food-first-weekends", title: "Food-first weekends",
    description: "Cities where every meal is the highlight — tapas bars, markets, and hidden trattorias.",
    icon: "food", color: "#f2664b", destinationIds: ["city-003", "city-140"],
    suggestedInterests: ["food", "culture"], suggestedPace: "relaxed", displayOrder: 1 },
  { slug: "architecture-and-icons", title: "Architecture & icons",
    description: "Gaudí, Gothic lanes, and grand boulevards for travelers who look up while they walk.",
    icon: "architecture", color: "#5d7bd5", destinationIds: ["city-003", "city-005", "city-025"],
    suggestedInterests: ["architecture", "culture"], suggestedPace: "balanced", displayOrder: 2 },
  { slug: "slow-coastal-escapes", title: "Slow coastal escapes",
    description: "Sea air, long lunches, and unhurried evenings by the water.",
    icon: "coastal", color: "#3aa6d1", destinationIds: ["city-011", "city-002"],
    suggestedInterests: ["nature"], suggestedPace: "relaxed", displayOrder: 3 },
  { slug: "culture-deep-dives", title: "Culture deep-dives",
    description: "Museums, neighborhoods with stories, and local life beyond the postcards.",
    icon: "culture", color: "#a05bd5", destinationIds: ["city-005", "city-025", "city-017"],
    suggestedInterests: ["culture"], suggestedPace: "balanced", displayOrder: 4 },
];

export function findCuratedCollection(slug: unknown): CuratedCollection | undefined {
  return typeof slug === "string" && slug.length <= 80
    ? CURATED_COLLECTIONS.find(collection => collection.slug === slug) : undefined;
}

/** URL suggestions are trusted only after resolving both references and membership. */
export function collectionForDestination(values: readonly string[], destinationId: string | undefined) {
  if (values.length !== 1 || !destinationId) return undefined;
  const collection = findCuratedCollection(values[0]);
  return collection?.destinationIds.includes(destinationId) ? collection : undefined;
}

export const collectionDestinationsSchema = z.object({
  slug: z.string().refine(value => Boolean(findCuratedCollection(value))),
  items: z.array(catalogDestinationSchema).max(12),
});
