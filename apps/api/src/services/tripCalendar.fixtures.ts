import { createHash } from "node:crypto";
import { addDays, type PublicTrip } from "@triply/shared";

export function calendarFixture(timeZone = "Europe/Madrid", startDate = "2030-06-02", days = 2): PublicTrip {
  return { destination: "Barcelona", country: "Spain", startDate, endDate: addDays(startDate, days - 1), durationDays: days, location: null, weather: [],
    days: Array.from({ length: days }, (_, i) => { const date = addDays(startDate, i); return {
      dayIndex: i + 1, date, timeZone, travelMode: "walking", warnings: [], geometry: null, totalVisitMinutes: 60, totalTravelMinutes: 10, totalDistanceMeters: 100, partiallyEstimated: false,
      stops: [{ name: "Sagrada Família", category: "culture", lat: 41.4036, lng: 2.1744, address: "Carrer de Mallorca, 401", description: "Architecture; art, culture and history." }],
      activities: [
        { type: "attraction", title: "Sagrada Família", startTime: `${date}T09:00:00`, endTime: `${date}T10:00:00`, durationMinutes: 60, stopIndex: 0, distanceMeters: null, openingHoursStatus: "unknown", calendarUid: `${createHash("sha256").update(`fixture-attraction-${timeZone}-${startDate}-${i}`).digest("hex")}@calendar.triply.invalid` },
        { type: "travel", title: "To lunch", startTime: `${date}T10:00:00`, endTime: `${date}T10:10:00`, durationMinutes: 10, stopIndex: null, distanceMeters: 100 },
        { type: "break", title: "Lunch", startTime: `${date}T12:00:00`, endTime: `${date}T12:45:00`, durationMinutes: 45, stopIndex: null, distanceMeters: null, calendarUid: `${createHash("sha256").update(`fixture-break-${timeZone}-${startDate}-${i}`).digest("hex")}@calendar.triply.invalid` },
      ],
    }; }),
  };
}
