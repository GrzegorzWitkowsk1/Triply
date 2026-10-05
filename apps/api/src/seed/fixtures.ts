import { deriveTripSchedule, tripAnalysisSchema, type TripAnalysis, type TripStatus } from "@triply/shared";

export interface SeedEquipmentItem {
  name: string;
  count: number;
}

export interface SeedFixture {
  fixtureKey: string;
  prompt: string;
  badges: string[];
  status: TripStatus;
  analysis: TripAnalysis;
  equipment: SeedEquipmentItem[];
}

export const SEED_FIXTURES: SeedFixture[] = [
  {
    fixtureKey: "paris",
    prompt: "Five days in Paris with a focus on architecture and shopping.",
    badges: ["architecture", "shopping"],
    status: "confirmed",
    analysis: deriveTripSchedule({
      destination: "Paris",
      country: "France",
      startDate: "2026-10-12",
      endDate: "2026-10-16",
      durationDays: 5,
      travelers: 2,
      budget: { amount: 1000, currency: "EUR", type: "total" },
      interests: ["architecture", "shopping", "food"],
      pace: "balanced",
      maxWalkingDistanceKm: 12,
      notes: null,
      location: { lat: 48.8566, lng: 2.3522, city: "Paris", country: "France" },
    }),
    equipment: [
      { name: "Passport & ID", count: 1 },
      { name: "Toiletries", count: 1 },
      { name: "Power bank", count: 1 },
      { name: "Comfortable walking shoes", count: 1 },
      { name: "Umbrella", count: 1 },
    ],
  },
  {
    fixtureKey: "rome",
    prompt: "Four days in Rome, packed with ruins and food.",
    badges: ["culture", "food"],
    status: "confirmed",
    analysis: deriveTripSchedule({
      destination: "Rome",
      country: "Italy",
      startDate: "2026-11-03",
      endDate: "2026-11-06",
      durationDays: 4,
      travelers: 2,
      budget: { amount: 600, currency: "EUR", type: "total" },
      interests: ["culture", "food"],
      pace: "packed",
      maxWalkingDistanceKm: 14,
      notes: null,
      location: { lat: 41.9028, lng: 12.4964, city: "Rome", country: "Italy" },
    }),
    equipment: [
      { name: "Passport & ID", count: 1 },
      { name: "Sunscreen", count: 1 },
      { name: "Reusable water bottle", count: 1 },
      { name: "Museum tickets booked", count: 2 },
    ],
  },
  {
    fixtureKey: "lisbon",
    prompt: "Five relaxed days in Lisbon mixing food and nature.",
    badges: ["food", "nature"],
    status: "draft",
    analysis: deriveTripSchedule({
      destination: "Lisbon",
      country: "Portugal",
      startDate: "2026-09-18",
      endDate: "2026-09-22",
      durationDays: 5,
      travelers: 2,
      budget: { amount: 620, currency: "EUR", type: "total" },
      interests: ["food", "nature"],
      pace: "relaxed",
      maxWalkingDistanceKm: 8,
      notes: null,
      location: { lat: 38.7223, lng: -9.1393, city: "Lisbon", country: "Portugal" },
    }),
    equipment: [
      { name: "Passport & ID", count: 1 },
      { name: "Day backpack", count: 1 },
      { name: "Train ticket", count: 2 },
      { name: "Light rain jacket", count: 1 },
    ],
  },
  {
    fixtureKey: "prague",
    prompt: "Four days in Prague over the holidays.",
    badges: ["culture", "architecture"],
    status: "draft",
    analysis: deriveTripSchedule({
      destination: "Prague",
      country: "Czechia",
      startDate: "2026-12-05",
      endDate: "2026-12-08",
      durationDays: 4,
      travelers: 2,
      budget: { amount: 350, currency: "EUR", type: "total" },
      interests: ["culture", "architecture"],
      pace: "balanced",
      maxWalkingDistanceKm: 10,
      notes: null,
      location: { lat: 50.0755, lng: 14.4378, city: "Prague", country: "Czechia" },
    }),
    equipment: [
      { name: "Passport & ID", count: 1 },
      { name: "Gloves & beanie", count: 1 },
      { name: "Plug adapter", count: 1 },
      { name: "Toiletries", count: 2 },
      { name: "Camera", count: 1 },
    ],
  },
];

for (const fixture of SEED_FIXTURES) {
  fixture.analysis = tripAnalysisSchema.parse(fixture.analysis);
}