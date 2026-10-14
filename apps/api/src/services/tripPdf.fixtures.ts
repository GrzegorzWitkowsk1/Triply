import type { PublicTrip } from "@triply/shared";
import { addDays } from "@triply/shared";

export function pdfFixture(days = 2, activitiesPerDay = 3, longDescription = false): PublicTrip {
  return { destination: "Łódź", country: "Polska", startDate: "2030-10-27", endDate: addDays("2030-10-27", days - 1), durationDays: days,
    location: null, weather: [{ date: "2030-10-27", weatherCode: 3, temperatureMax: 14 }],
    days: Array.from({ length: days }, (_, d) => ({ dayIndex: d + 1, date: addDays("2030-10-27", d), timeZone: "Europe/Warsaw",
      activities: Array.from({ length: activitiesPerDay }, (_, i) => ({ type: "attraction", title: `Visit ${d + 1}.${i + 1} — Zażółć gęślą jaźń`,
        startTime: "2030-10-27T09:15:00+01:00", endTime: "2030-10-27T10:30:00+01:00", durationMinutes: 75,
        stopIndex: i, distanceMeters: null, openingHoursStatus: "unknown", durationSource: "estimated" })),
      stops: Array.from({ length: activitiesPerDay }, (_, i) => ({ name: `Museum ${i + 1}`, category: "culture", lat: 51.76, lng: 19.46,
        address: "ul. Piotrkowska 32, Łódź", description: longDescription && i === 0
          ? "A long description with Polish characters: żółć, gęślą, jaźń. ".repeat(75)
          : "Explore local history and architecture. Check accessibility and opening hours before visiting." })),
      geometry: null, travelMode: "walking", totalVisitMinutes: activitiesPerDay * 75, totalTravelMinutes: null,
      totalDistanceMeters: null, partiallyEstimated: true, warnings: ["estimated-travel", "opening-hours-unknown"],
    })),
  };
}
