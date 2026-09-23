export type TripStatus = "Ready" | "Planning";

export interface TripsPageTrip {
  id: string;
  city: string;
  country: string;
  days: number;
  image: string;
  dateLabel: string;
  activities: number;
  completed: number;
  budgetUsed: number;
  budgetExpected: number;
  distanceKm: number;
  status: TripStatus;
  dayLabel: string;
  planActivities: string[];
}

export const TRIPS_LIST: TripsPageTrip[] = [
  {
    id: "paris",
    city: "Paris",
    country: "France",
    days: 5,
    image: "/trips/paris.jpg",
    dateLabel: "Oct 12-16",
    activities: 14,
    completed: 11,
    budgetUsed: 427,
    budgetExpected: 500,
    distanceKm: 24,
    status: "Ready",
    dayLabel: "Day 1",
    planActivities: ["Eiffel Tower", "Seine river cruise", "Louvre", "Montmartre"],
  },
  {
    id: "rome",
    city: "Rome",
    country: "Italy",
    days: 4,
    image: "/trips/rome.jpg",
    dateLabel: "Nov 3-7",
    activities: 9,
    completed: 9,
    budgetUsed: 312,
    budgetExpected: 300,
    distanceKm: 18,
    status: "Ready",
    dayLabel: "Day 1",
    planActivities: ["Colosseum", "Roman Forum", "Trevi Fountain"],
  },
  {
    id: "lisbon",
    city: "Lisbon",
    country: "Portugal",
    days: 5,
    image: "/trips/lisbon.jpg",
    dateLabel: "Sep 18-23",
    activities: 11,
    completed: 6,
    budgetUsed: 515,
    budgetExpected: 620,
    distanceKm: 21,
    status: "Planning",
    dayLabel: "Day 1",
    planActivities: ["Alfama stroll", "Time Out Market"],
  },
  {
    id: "prague",
    city: "Prague",
    country: "Czechia",
    days: 4,
    image: "/trips/prague.jpg",
    dateLabel: "Dec 5-9",
    activities: 8,
    completed: 3,
    budgetUsed: 402,
    budgetExpected: 350,
    distanceKm: 15,
    status: "Planning",
    dayLabel: "Day 1",
    planActivities: ["Old Town Square", "Charles Bridge"],
  },
];

export type TripFilter = "All trips" | "Ready" | "Planning";

export const TRIP_FILTERS: TripFilter[] = ["All trips", "Ready", "Planning"];

export const TRIP_SUMMARY = {
  spent: TRIPS_LIST.reduce((sum, trip) => sum + trip.budgetUsed, 0),
  whole: TRIPS_LIST.reduce((sum, trip) => sum + trip.budgetExpected, 0),
  upcoming: TRIPS_LIST.length,
};