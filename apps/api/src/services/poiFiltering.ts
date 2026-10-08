import { isPoiCategory, type PoiCategory, type PoiEnvironment } from "@triply/shared";
import { categoryForTags, environmentForTags } from "./poiCategories.js";
import { distanceMeters, isValidCoordinate } from "./geo.js";

const DUPLICATE_RADIUS_M = 50;
const MAX_NAME_LENGTH = 200;
const METADATA_TAGS = [
  "description",
  "website",
  "opening_hours",
  "wikidata",
  "wikipedia",
  "phone",
  "email",
  "image",
] as const;

export interface RawPoiCandidate {
  osmKey: string | null;
  lat: unknown;
  lng: unknown;
  tags: Record<string, unknown>;
}

export interface NormalizedPoi {
  osmKey: string | null;
  name: string;
  category: PoiCategory;
  lat: number;
  lng: number;
  distanceMeters: number;
  environment: PoiEnvironment;
  metadataCount: number;
}

export interface NormalizePoisOptions {
  lat: number;
  lng: number;
  interests: readonly string[];
}

export function normalizeInterests(interests: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const interest of interests) {
    const value = interest.trim().toLowerCase();

    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function countMetadata(tags: Record<string, unknown>): number {
  let count = 0;

  for (const key of METADATA_TAGS) {
    const value = tags[key];

    if (typeof value === "string" && value.trim().length > 0) {
      count += 1;
    }
  }

  return count;
}

interface PreparedPoi extends NormalizedPoi {
  index: number;
}

function prepare(candidates: readonly RawPoiCandidate[], options: NormalizePoisOptions): PreparedPoi[] {
  const interests = normalizeInterests(options.interests);
  const interestSet = new Set(interests);
  const hasCanonicalInterests = interests.some(
    (interest) => interest !== "attraction" && isPoiCategory(interest),
  );
  const prepared: PreparedPoi[] = [];

  candidates.forEach((candidate, index) => {
    const tags = candidate.tags ?? {};
    const name = normalizeName(tags.name);

    if (
      !name ||
      typeof candidate.lat !== "number" ||
      typeof candidate.lng !== "number" ||
      !isValidCoordinate(candidate.lat, candidate.lng)
    ) {
      return;
    }

    const lat = candidate.lat;
    const lng = candidate.lng;
    const category = categoryForTags(tags) ?? "attraction";

    if (
      hasCanonicalInterests &&
      !interestSet.has(category) &&
      category !== "attraction"
    ) {
      return;
    }

    prepared.push({
      index,
      osmKey: candidate.osmKey,
      name,
      category,
      lat,
      lng,
      distanceMeters: distanceMeters(options.lat, options.lng, lat, lng),
      environment: environmentForTags(tags),
      metadataCount: countMetadata(tags),
    });
  });

  return prepared;
}

function compareDuplicatePriority(a: NormalizedPoi, b: NormalizedPoi): number {
  if (a.metadataCount !== b.metadataCount) {
    return b.metadataCount - a.metadataCount;
  }

  if (a.distanceMeters !== b.distanceMeters) {
    return a.distanceMeters - b.distanceMeters;
  }

  const aKey = a.osmKey ?? "";
  const bKey = b.osmKey ?? "";

  if (aKey !== bKey) {
    return aKey < bKey ? -1 : 1;
  }

  return 0;
}

function dedupe(prepared: readonly PreparedPoi[]): PreparedPoi[] {
  const seenOsmKeys = new Set<string>();
  const uniqueByOsm: PreparedPoi[] = [];

  for (const poi of prepared) {
    if (poi.osmKey !== null) {
      if (seenOsmKeys.has(poi.osmKey)) {
        continue;
      }

      seenOsmKeys.add(poi.osmKey);
    }

    uniqueByOsm.push(poi);
  }

  const groups = new Map<string, PreparedPoi[]>();

  for (const poi of uniqueByOsm) {
    const key = `${poi.category}|${normalizeNameKey(poi.name)}`;
    const group = groups.get(key) ?? [];

    group.push(poi);
    groups.set(key, group);
  }

  const survivors: PreparedPoi[] = [];

  for (const group of groups.values()) {
    const ordered = [...group].sort(compareDuplicatePriority);
    const kept: PreparedPoi[] = [];

    for (const candidate of ordered) {
      const isDuplicate = kept.some(
        (existing) =>
          distanceMeters(existing.lat, existing.lng, candidate.lat, candidate.lng) <
          DUPLICATE_RADIUS_M,
      );

      if (!isDuplicate) {
        kept.push(candidate);
      }
    }

    survivors.push(...kept);
  }

  return survivors.sort((a, b) => a.index - b.index);
}

export function normalizePois(
  candidates: readonly RawPoiCandidate[],
  options: NormalizePoisOptions,
): NormalizedPoi[] {
  if (!Number.isFinite(options.lat) || !Number.isFinite(options.lng)) {
    return [];
  }

  return dedupe(prepare(candidates, options));
}
