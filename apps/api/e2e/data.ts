import { addDays, type ItineraryDay, type TripAnalysis, type TripAttraction } from "@triply/shared";

export const NOW = "2030-06-01T10:00:00.000Z";
export const PASSWORD = "Triply-E2E-Password123!";
export const cities = {
  Barcelona: { country: "Spain", code: "ES", lat: 41.38, lng: 2.17, zone: "Europe/Madrid", names: ["Barcelona Cathedral", "Palau de la Musica", "Gothic Quarter", "La Boqueria", "SITAKE YA", "Roman Walls", "Sant Pau", "Casa Batllo", "Casa Mila"] },
  Prague: { country: "Czech Republic", code: "CZ", lat: 50.08, lng: 14.43, zone: "Europe/Prague", names: ["Prague Castle", "Charles Bridge", "Old Town Square", "Prague Cafe", "Jewish Quarter", "Powder Tower", "National Museum", "Municipal House", "Vysehrad"] },
  Rome: { country: "Italy", code: "IT", lat: 41.9, lng: 12.5, zone: "Europe/Rome", names: ["Colosseum", "Roman Forum", "Pantheon", "Rome Trattoria", "Trevi Fountain", "Capitoline Hill", "Castel Sant Angelo", "Piazza Navona", "Palatine Hill"] },
  Paris: { country: "France", code: "FR", lat: 48.85, lng: 2.35, zone: "Europe/Paris", names: ["Louvre", "Eiffel Tower", "Notre Dame", "Paris Cafe", "Paris Market", "Pantheon", "Arc de Triomphe", "Sainte Chapelle", "Musee d'Orsay"] },
} as const;
export type City = keyof typeof cities;
export type Scenario = "empty" | "prague" | "weather" | "future" | "editing" | "conflict";

export function analysis(city: City = "Barcelona", startDate = "2030-06-02"): TripAnalysis {
  const c = cities[city];
  return { destination: city, country: c.country, startDate, endDate: addDays(startDate, 2), durationDays: 3,
    travelers: 1, budget: { amount: 500, currency: "EUR", type: "total" }, interests: ["food", "architecture", "history"],
    pace: "balanced", maxWalkingDistanceKm: 5, notes: null, location: { lat: c.lat, lng: c.lng, city, country: c.country } };
}

export function attractions(city: City): TripAttraction[] {
  const c = cities[city];
  return c.names.map((name, i) => ({ placeId: `node/${1000 + i}`, name, category: i === 3 || i === 4 ? "food" : "architecture",
    lat: c.lat + i * .001, lng: c.lng + (i % 3) * .001, score: 80, visitDurationMinutes: 30,
    openingHours: name === "SITAKE YA" ? undefined : { raw: "Mo-Su 08:00-22:00", source: "osm", checkedAt: "2030-06-01" },
    admission: { status: "free", price: null, source: "osm", checkedAt: "2030-06-01", retrievedAt: NOW,
      sourceUrl: null, rawFee: "no", rawCharge: null, rawFeeConditional: null, rawChargeConditional: null, rawCurrency: null, menuUrl: null, notes: null } }));
}

export function makeDay(pool: TripAttraction[], dayIndex: number, startDate: string, indices: number[]): ItineraryDay {
  const date = addDays(startDate, dayIndex - 1);
  const places = indices.map(i => pool[i]!);
  return { dayIndex, date, timeZone: "Europe/Madrid", routingSource: "provider", travelMode: "walking",
    activities: places.map((p, i) => ({ type: "attraction", placeId: p.placeId!, title: p.name,
      startTime: `${date}T${String(9 + i).padStart(2, "0")}:00:00+02:00`,
      endTime: `${date}T${String(9 + i).padStart(2, "0")}:30:00+02:00`, durationMinutes: 30 })),
    stops: places.map(p => ({ placeId: p.placeId!, name: p.name, category: p.category, lat: p.lat, lng: p.lng, score: p.score ?? null })),
    geometry: null, segments: [], totalVisitMinutes: places.length * 30, totalTravelMinutes: 0,
    totalDistanceMeters: 0, partiallyEstimated: false, warnings: [] };
}
