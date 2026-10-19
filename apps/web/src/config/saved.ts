import type { SavedAttraction, SavedDestination } from "@triply/shared";

export const SAVED_TYPES = ["all", "destinations", "attractions"] as const;
export type SavedType = typeof SAVED_TYPES[number];
export const SAVED_SORTS = ["recent", "oldest", "name-asc", "name-desc"] as const;
export type SavedSort = typeof SAVED_SORTS[number];
export type SavedItem = { type: "destinations"; key: string; row: SavedDestination }
  | { type: "attractions"; key: string; row: SavedAttraction };

export function savedName(item: SavedItem): string {
  return item.type === "destinations" ? item.row.destination?.city || "Unavailable destination"
    : item.row.snapshot?.name || "Unavailable attraction";
}
export function destinationRegion(place: SavedDestination["destination"]): string {
  return place && "region" in place && typeof place.region === "string" ? place.region : "";
}
export function savedLocale(item: SavedItem): string {
  return item.type === "destinations" ? [destinationRegion(item.row.destination), item.row.destination?.country].filter(Boolean).join(", ")
    : [item.row.snapshot?.destinationName, item.row.snapshot?.country].filter(Boolean).join(", ");
}
export function normalizeSavedSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
}
export function savedCollection(destinations: readonly SavedDestination[], attractions: readonly SavedAttraction[]): SavedItem[] {
  // Counts and results reflect unique backend identities, even during cache updates.
  return [...new Map<string, SavedItem>([
    ...destinations.map(row => [`destination:${row.destinationId}`, { type: "destinations", key: `destination:${row.destinationId}`, row }] as const),
    ...attractions.map(row => [`attraction:${row.attractionKey}`, { type: "attractions", key: `attraction:${row.attractionKey}`, row }] as const),
  ]).values()];
}
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const savedTime = (item: SavedItem) => Date.parse(item.row.createdAt) || 0;
export function filterSaved(items: readonly SavedItem[], type: SavedType, query: string, sort: SavedSort): SavedItem[] {
  const words = normalizeSavedSearch(query).split(" ").filter(Boolean);
  return items.filter(item => {
    if (type !== "all" && item.type !== type) return false;
    const text = normalizeSavedSearch([savedName(item), savedLocale(item), item.type === "attractions" ? item.row.snapshot?.category : ""].filter(Boolean).join(" "));
    return words.every(word => text.includes(word));
  }).sort((a, b) => {
    const compared = sort === "recent" ? savedTime(b) - savedTime(a) : sort === "oldest" ? savedTime(a) - savedTime(b)
      : collator.compare(savedName(a), savedName(b)) * (sort === "name-desc" ? -1 : 1);
    return compared || a.key.localeCompare(b.key);
  });
}
export function savedMapUrl(item: SavedItem): string | null {
  if (item.type === "destinations") {
    const place = item.row.destination;
    return place ? `https://www.openstreetmap.org/search?query=${encodeURIComponent([place.city, place.country].filter(Boolean).join(", "))}` : null;
  }
  const coordinates = item.row.snapshot?.coordinates;
  if (!coordinates || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng) || Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lng) > 180) return null;
  return /^osm:(node|way|relation):\d+$/.test(item.row.attractionKey) ? `https://www.openstreetmap.org/${item.row.attractionKey.slice(4).replace(":", "/")}`
    : `https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lng}#map=18/${coordinates.lat}/${coordinates.lng}`;
}
