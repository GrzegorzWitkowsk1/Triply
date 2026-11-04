import { TripModel } from "../models/Trip.js";
const tripId = "507f1f77bcf86cd799439011", userId = "507f1f77bcf86cd799439012";
export function assistantFixture() {
  return new TripModel({ _id: tripId, user: userId, status: "ready", itineraryVersion: 3,
    analysis: { destination: "Madrid", startDate: "2026-10-12", endDate: "2026-10-13", durationDays: 2, interests: ["culture"], budget: { amount: 500, currency: "EUR", type: "total" } },
    attractions: ["Prado Museum", "History Museum", "Retiro Park"].map((name, i) => ({ name, placeId: `node/${i}`, category: "culture", lat: 40 + i * .001, lng: -3, environment: i === 2 ? "outdoor" : "indoor" })),
    itinerary: { timeZone: "Europe/Madrid", routingSource: "approximation", days: [1,2].map(dayIndex => ({ dayIndex, date: `2026-10-${dayIndex + 11}`, timeZone: "Europe/Madrid",
      activities: (dayIndex === 1 ? [0,1] : [2]).map(i => ({ type: "attraction", placeId: `node/${i}`, title: ["Prado Museum", "History Museum", "Retiro Park"][i], startTime: `2026-10-${dayIndex + 11}T09:00:00`, endTime: `2026-10-${dayIndex + 11}T10:00:00`, durationMinutes: 60 })),
      stops: (dayIndex === 1 ? [0,1] : [2]).map(i => ({ placeId: `node/${i}`, name: ["Prado Museum", "History Museum", "Retiro Park"][i], category: "culture", lat: 40 + i * .001, lng: -3, score: null })),
      segments: [], geometry: null, warnings: [], totalDistanceMeters: dayIndex * 1000, totalTravelMinutes: 20, totalVisitMinutes: dayIndex === 1 ? 120 : 60, partiallyEstimated: true,
    })), unscheduled: [] },
  });
}
