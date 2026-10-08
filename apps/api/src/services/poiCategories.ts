import type { PoiCategory, PoiEnvironment } from "@triply/shared";

export interface TagValuesFilter {
  key: string;
  values: string[];
}

export interface CategoryRule {
  category: PoiCategory;
  filters: TagValuesFilter[];
}

export const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    category: "food",
    filters: [
      { key: "amenity", values: ["restaurant", "cafe", "fast_food", "food_court", "ice_cream"] },
    ],
  },
  {
    category: "architecture",
    filters: [
      {
        key: "historic",
        values: ["castle", "palace", "ruins", "monument", "memorial", "archaeological_site", "manor"],
      },
      { key: "building", values: ["cathedral", "church", "mosque", "synagogue", "temple"] },
    ],
  },
  {
    category: "beach",
    filters: [
      { key: "natural", values: ["beach"] },
      { key: "leisure", values: ["beach_resort"] },
    ],
  },
  {
    category: "nature",
    filters: [
      { key: "leisure", values: ["park", "garden", "nature_reserve"] },
      { key: "natural", values: ["peak", "waterfall", "volcano", "spring"] },
    ],
  },
  {
    category: "culture",
    filters: [
      { key: "tourism", values: ["museum", "gallery", "artwork"] },
      { key: "amenity", values: ["theatre", "arts_centre", "library"] },
    ],
  },
  {
    category: "shopping",
    filters: [
      { key: "amenity", values: ["marketplace"] },
      { key: "shop", values: ["mall", "department_store", "gift", "souvenir", "clothes", "books"] },
    ],
  },
  {
    category: "nightlife",
    filters: [
      { key: "amenity", values: ["bar", "pub", "nightclub", "biergarten", "casino"] },
    ],
  },
  { category: "attraction", filters: [{ key: "tourism", values: ["attraction"] }] },
];

function buildInterestFilters(): Record<string, TagValuesFilter[]> {
  const record: Record<string, TagValuesFilter[]> = {};

  for (const rule of CATEGORY_RULES) {
    if (rule.category === "attraction") {
      continue;
    }

    record[rule.category] = rule.filters;
  }

  return record;
}

export const INTEREST_FILTERS: Record<string, TagValuesFilter[]> = buildInterestFilters();

function matchesFilter(tags: Record<string, unknown>, filter: TagValuesFilter): boolean {
  const value = tags[filter.key];

  return typeof value === "string" && filter.values.includes(value);
}

export function categoryForTags(tags: Record<string, unknown>): PoiCategory | null {
  for (const rule of CATEGORY_RULES) {
    for (const filter of rule.filters) {
      if (matchesFilter(tags, filter)) {
        return rule.category;
      }
    }
  }

  return null;
}

const INDOOR_RULES: TagValuesFilter[] = [
  { key: "tourism", values: ["museum", "gallery"] },
  {
    key: "amenity",
    values: [
      "theatre",
      "arts_centre",
      "library",
      "cinema",
      "restaurant",
      "cafe",
      "fast_food",
      "food_court",
      "ice_cream",
      "bar",
      "pub",
      "nightclub",
      "casino",
    ],
  },
  { key: "building", values: ["cathedral", "church", "mosque", "synagogue", "temple"] },
  { key: "leisure", values: ["fitness_centre"] },
];

const OUTDOOR_RULES: TagValuesFilter[] = [
  {
    key: "natural",
    values: ["beach", "peak", "waterfall", "volcano", "spring", "bay", "cliff", "ridge"],
  },
  {
    key: "leisure",
    values: ["park", "garden", "nature_reserve", "beach_resort", "playground", "golf_course", "pitch", "water_park", "dog_park"],
  },
  { key: "tourism", values: ["viewpoint", "artwork", "camp_site", "picnic_site", "zoo", "theme_park"] },
  { key: "historic", values: ["monument", "memorial", "ruins", "archaeological_site"] },
];

export function environmentForTags(tags: Record<string, unknown>): PoiEnvironment {
  const shop = tags.shop;

  if (typeof shop === "string" && shop.trim().length > 0) {
    return "indoor";
  }

  for (const filter of INDOOR_RULES) {
    if (matchesFilter(tags, filter)) {
      return "indoor";
    }
  }

  for (const filter of OUTDOOR_RULES) {
    if (matchesFilter(tags, filter)) {
      return "outdoor";
    }
  }

  return "unknown";
}
