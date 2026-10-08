export const POI_CATEGORY_VALUES = [
  "food",
  "architecture",
  "beach",
  "nature",
  "culture",
  "shopping",
  "nightlife",
  "attraction",
] as const;

export type PoiCategory = (typeof POI_CATEGORY_VALUES)[number];

export function isPoiCategory(value: string): value is PoiCategory {
  return (POI_CATEGORY_VALUES as readonly string[]).includes(value);
}

export const POI_ENVIRONMENT_VALUES = ["indoor", "outdoor", "unknown"] as const;

export type PoiEnvironment = (typeof POI_ENVIRONMENT_VALUES)[number];

