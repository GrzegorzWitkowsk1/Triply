import { z } from "zod";
import cities from "./destinations.json" with { type: "json" };

/** The existing photo seed is the canonical city catalog; IDs never derive from names. */
export const DESTINATIONS = cities;
export type Destination = (typeof cities)[number];
const byId = new Map(cities.map(city => [city.id, city]));
export const findDestination = (id: string): Destination | null => byId.get(id) ?? null;
export function findDestinationByCity(city: string, country: string): Destination | null {
  const matches = cities.filter(row => row.city.toLowerCase() === city.trim().toLowerCase() && row.country.toLowerCase() === country.trim().toLowerCase());
  return matches.length === 1 ? matches[0]! : null;
}
export const destinationIdSchema = z.string().regex(/^city-\d{3}$/);
export const saveDestinationSchema = z.object({ destinationId: destinationIdSchema }).strict();
export interface SavedDestination {
  destinationId: string;
  createdAt: string;
  destination: Destination | null;
}
export interface SavedDestinationsResponse { destinations: SavedDestination[] }
export interface SavedDestinationIdsResponse { destinationIds: string[] }
