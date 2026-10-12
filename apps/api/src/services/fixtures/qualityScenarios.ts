import { addDays, type Pace, type TripAttraction } from "@triply/shared";
import { TripModel } from "../../models/Trip.js";
import { normalizeAdmission } from "../admissionPricingService.js";
import type { RoutingProvider } from "../../routing/types.js";
import { distanceMeters } from "../geo.js";

/** Synthetic fixtures representing destination characteristics, not live city data. */
export const DESTINATIONS = [
  { name: "large European city", lat: 48.85, lng: 2.35, spacing: .006, count: 12, hours: true },
  { name: "compact walkable city", lat: 50.08, lng: 14.42, spacing: .001, count: 8, hours: true },
  { name: "spread-out destination", lat: 34.05, lng: -118.24, spacing: .02, count: 12, hours: true },
  { name: "limited POI coverage", lat: 59.91, lng: 10.75, spacing: .002, count: 2, hours: true },
  { name: "sparse opening hours", lat: 38.72, lng: -9.14, spacing: .003, count: 8, hours: false },
] as const;
export function qualityScenario(destination: typeof DESTINATIONS[number] = DESTINATIONS[0], days = 1, pace: Pace = "balanced", amount = 1000, startDate = "2026-10-12") {
  const attractions: TripAttraction[] = Array.from({ length: destination.count }, (_, i) => ({
    placeId: `fixture/${i}`, name: `Fixture attraction ${i}`, category: "culture", lat: destination.lat + i * destination.spacing, lng: destination.lng,
    score: 80, visitDurationMinutes: 30, admission: normalizeAdmission({ tourism: "museum", fee: "no" }),
    ...(destination.hours ? { openingHours: { raw: "Mo-Su 08:00-22:00", source: "osm" as const, checkedAt: null } } : {}),
  }));
  return new TripModel({ attractions, analysis: { destination: destination.name, location: { lat: destination.lat, lng: destination.lng }, durationDays: days,
    startDate, endDate: addDays(startDate, days - 1), travelers: 2, pace, interests: ["culture"], maxWalkingDistanceKm: 10, budget: { amount, currency: "EUR", type: "total" } } }).toObject();
}
export const fixtureRouter: RoutingProvider = {
  name: "fixture", supportedModes: ["walking"], supportsMode: mode => mode === "walking",
  async getTravelMatrix(points) {
    return { distancesMeters: points.map(a => points.map(b => distanceMeters(a.lat, a.lng, b.lat, b.lng))), durationsSeconds: points.map(a => points.map(b => Math.round(distanceMeters(a.lat, a.lng, b.lat, b.lng) / 1.4))) };
  },
  async getRoute(points) {
    const legs = points.slice(1).map((b, i) => ({ fromIndex: i, toIndex: i + 1, distanceMeters: distanceMeters(points[i].lat, points[i].lng, b.lat, b.lng), durationSeconds: Math.round(distanceMeters(points[i].lat, points[i].lng, b.lat, b.lng) / 1.4) }));
    return { legs, geometry: null, distanceMeters: legs.reduce((n, l) => n + l.distanceMeters, 0), durationSeconds: legs.reduce((n, l) => n + l.durationSeconds, 0) };
  },
};
