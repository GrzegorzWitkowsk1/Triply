import type { PoiCategory } from "@triply/shared";

// Category identifiers verified against https://apidocs.geoapify.com/docs/places/.
export const GEOAPIFY_INTEREST_CATEGORIES: Record<string, readonly string[]> = {
  history: ["tourism.sights"], architecture: ["tourism.sights"],
  museums: ["entertainment.museum"], art: ["entertainment.culture.gallery", "tourism.attraction.artwork"],
  culture: ["entertainment.museum", "entertainment.culture", "tourism.attraction.artwork"],
  nature: ["natural", "leisure.park", "national_park"], parks: ["leisure.park"],
  entertainment: ["entertainment"], food: ["catering.restaurant", "catering.cafe"],
  beach: ["beach"], shopping: ["commercial.shopping_mall", "commercial.marketplace"],
  nightlife: ["catering.bar", "catering.pub", "adult.nightclub"],
};

export function geoapifyCategories(interests: readonly string[]): string[] {
  const categories = [...new Set(interests.flatMap(interest => GEOAPIFY_INTEREST_CATEGORIES[interest.trim().toLowerCase()] ?? []))];
  return categories.length ? categories : ["tourism.attraction"];
}

/** Classification tags feed the existing normalizer; they are not claimed as upstream OSM tags. */
export function geoapifyClassification(categories: readonly string[]): { category: PoiCategory; tags: Record<string, string> } {
  const has = (prefix: string) => categories.some(c => c === prefix || c.startsWith(`${prefix}.`));
  if (has("catering.bar") || has("catering.pub") || has("adult.nightclub")) return { category: "nightlife", tags: { amenity: "bar" } };
  if (has("catering")) return { category: "food", tags: { amenity: "restaurant" } };
  if (has("tourism.sights")) return { category: "architecture", tags: { historic: "monument" } };
  if (has("beach")) return { category: "beach", tags: { natural: "beach" } };
  if (has("natural") || has("leisure.park") || has("national_park")) return { category: "nature", tags: { leisure: "park" } };
  if (has("entertainment.museum")) return { category: "culture", tags: { tourism: "museum" } };
  if (has("entertainment.culture") || has("tourism.attraction.artwork")) return { category: "culture", tags: { tourism: "gallery" } };
  if (has("commercial")) return { category: "shopping", tags: { shop: "mall" } };
  return { category: "attraction", tags: { tourism: "attraction" } };
}
