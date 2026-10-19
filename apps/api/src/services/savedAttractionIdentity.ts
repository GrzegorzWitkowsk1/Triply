import { createHash } from "node:crypto";
import type { ItineraryStop, TripAttraction } from "@triply/shared";

type Place = Pick<ItineraryStop, "name" | "category" | "lat" | "lng"> & Partial<Pick<TripAttraction, "placeId" | "source" | "sourceId" | "address" | "description">>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function savedAttractionIdentity(place: Place): { attractionKey: string; provider: "overpass" | "geoapify" | "unknown"; providerPlaceId?: string } {
  if (/^(node|way|relation)\/\d+$/.test(place.placeId ?? "")) {
    return { attractionKey: `osm:${place.placeId!.replace("/", ":")}`, provider: "overpass", providerPlaceId: place.placeId! };
  }
  if (/^geoapify\/[a-f0-9]{64}$/.test(place.placeId ?? "")) {
    return { attractionKey: place.placeId!.replace("/", ":"), provider: "geoapify", providerPlaceId: place.sourceId || place.placeId! };
  }
  if (place.source === "geoapify" && place.sourceId) {
    return { attractionKey: `geoapify:${hash(place.sourceId)}`, provider: "geoapify", providerPlaceId: place.sourceId };
  }
  const provider = place.source ?? "unknown";
  // Centimetre-scale rounding only. No proximity or name-only matching.
  const material = JSON.stringify([provider, place.lat.toFixed(7), place.lng.toFixed(7), normalize(place.name), normalize(place.category)]);
  return { attractionKey: `fallback:${hash(material)}`, provider };
}

/** Stop data defines the visible place; attach provider metadata only from a matching stored POI. */
export function savedAttractionPlace(stop: ItineraryStop, pool: readonly TripAttraction[]): Place {
  const source = pool.find(place => place.placeId && place.placeId === stop.placeId && place.lat === stop.lat && place.lng === stop.lng);
  return { placeId: stop.placeId, name: stop.name, category: stop.category, lat: stop.lat, lng: stop.lng,
    source: source?.source, sourceId: source?.sourceId, address: source?.address, description: source?.description };
}
