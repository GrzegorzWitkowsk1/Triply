import i18n from "../i18n";
import {
  AccountBalanceOutlined,
  CloudOutlined,
  LandscapeOutlined,
  NightlifeOutlined,
  PaletteOutlined,
  RestaurantOutlined,
  ShoppingBagOutlined,
  WbSunnyOutlined,
} from "@mui/icons-material";

export interface TripWeather {
  icon: typeof WbSunnyOutlined;
  temp: number;
  label: string;
}

export interface TripActivity {
  image: string;
  hour: string;
  type: string;
  name: string;
  duration: string;
  cost: number | null;
  walkMinutes: number | null;
}

export interface TripDay {
  activities: TripActivity[];
}

export interface BudgetSlice {
  label: string;
  amount: number;
  color: string;
}

export interface TripDetail {
  id: string;
  city: string;
  country: string;
  days: number;
  image: string;
  dateLabel: string;
  stepsKm: number;
  weather: TripWeather;
  center: [number, number];
  dayRoutes: [number, number][][];
  tripDays: TripDay[];
  budget: {
    spent: number;
    whole: number;
    breakdown: BudgetSlice[];
  };
  prefDefaults: {
    tags: string[];
    pace: number;
    walking: number;
  };
}

export const PREF_OPTIONS = [
  { id: "food", get label() { return i18n.t("food", { ns: "trips" }); }, icon: RestaurantOutlined },
  { id: "architecture", get label() { return i18n.t("architecture", { ns: "trips" }); }, icon: AccountBalanceOutlined },
  { id: "culture", get label() { return i18n.t("culture", { ns: "trips" }); }, icon: PaletteOutlined },
  { id: "nature", get label() { return i18n.t("nature", { ns: "trips" }); }, icon: LandscapeOutlined },
  { id: "shopping", get label() { return i18n.t("shopping", { ns: "trips" }); }, icon: ShoppingBagOutlined },
  { id: "nightlife", get label() { return i18n.t("nightlife", { ns: "trips" }); }, icon: NightlifeOutlined },
];

export const PACE_OPTIONS = ["Relaxed", "Balanced", "Packed"];
export const WALKING_OPTIONS = ["Low", "Medium", "High"];

function makeRoutes(
  center: [number, number],
  dayCount: number,
  perDay: number
): [number, number][][] {
  return Array.from({ length: dayCount }, (_, d) =>
    Array.from({ length: perDay }, (_, i) => {
      const angle = d * 2.0 + i * (Math.PI / 1.5);
      return [
        Number((center[0] + 0.0035 * Math.sin(angle)).toFixed(6)),
        Number((center[1] + 0.0045 * Math.cos(angle)).toFixed(6)),
      ] as [number, number];
    })
  );
}

const TRIP_DETAILS: TripDetail[] = [
  {
    id: "prague",
    city: "Prague",
    country: "Czechia",
    days: 3,
    image: "/trips/prague.jpg",
    dateLabel: "Jan 18-21",
    stepsKm: 15,
    weather: { icon: CloudOutlined, temp: 8, get label() { return i18n.t("cloudy", { ns: "trips" }); } },
    center: [50.0755, 14.4378],
    dayRoutes: makeRoutes([50.0755, 14.4378], 3, 3),
    tripDays: [
      {
        activities: [
          { image: "/trips/prague.jpg", hour: "9:00", type: "Food", name: "Old Town Square food market", duration: "1 hr", cost: 12, walkMinutes: 5 },
          { image: "/trips/prague.jpg", hour: "10:30", type: "Sight", name: "Astronomical Clock & tower", duration: "1.5 hrs", cost: 15, walkMinutes: 8 },
          { image: "/trips/prague.jpg", hour: "13:00", type: "Food", name: "Výtopna Railway Restaurant", duration: "1.5 hrs", cost: 22, walkMinutes: 6 },
        ],
      },
      {
        activities: [
          { image: "/trips/prague.jpg", hour: "9:30", type: "Culture", name: "Prague Castle complex", duration: "3 hrs", cost: 25, walkMinutes: 10 },
          { image: "/trips/prague.jpg", hour: "13:30", type: "Food", name: "Café Slavia", duration: "1 hr", cost: 18, walkMinutes: 8 },
          { image: "/trips/prague.jpg", hour: "15:00", type: "Sight", name: "Charles Bridge & Lesser Town stroll", duration: "2 hrs", cost: 0, walkMinutes: 12 },
        ],
      },
      {
        activities: [
          { image: "/trips/prague.jpg", hour: "10:00", type: "Culture", name: "Jewish Quarter (Josefov)", duration: "2.5 hrs", cost: 20, walkMinutes: 9 },
          { image: "/trips/prague.jpg", hour: "14:00", type: "Nature", name: "Petřín Park & lookout", duration: "2.5 hrs", cost: 8, walkMinutes: 15 },
          { image: "/trips/prague.jpg", hour: "17:00", type: "Food", name: "Lokál pub dinner", duration: "2 hrs", cost: 28, walkMinutes: 20 },
        ],
      },
    ],
    budget: {
      spent: 402,
      whole: 350,
      breakdown: [
        { get label() { return i18n.t("accommodation", { ns: "trips" }); }, amount: 150, color: "#5d7bd5" },
        { get label() { return i18n.t("food", { ns: "trips" }); }, amount: 100, color: "#f2664b" },
        { get label() { return i18n.t("activities", { ns: "trips" }); }, amount: 70, color: "#43b047" },
        { get label() { return i18n.t("transport", { ns: "trips" }); }, amount: 52, color: "#a05bd5" },
        { get label() { return i18n.t("other", { ns: "trips" }); }, amount: 30, color: "#e0a22e" },
      ],
    },
    prefDefaults: { tags: ["food", "architecture"], pace: 1, walking: 1 },
  },
  {
    id: "paris",
    city: "Paris",
    country: "France",
    days: 3,
    image: "/trips/paris.jpg",
    dateLabel: "Feb 10-13",
    stepsKm: 24,
    weather: { icon: WbSunnyOutlined, temp: 18, get label() { return i18n.t("mostlySunny", { ns: "trips" }); } },
    center: [48.8566, 2.3522],
    dayRoutes: makeRoutes([48.8566, 2.3522], 3, 3),
    tripDays: [
      {
        activities: [
          { image: "/trips/paris.jpg", hour: "9:30", type: "Sight", name: "Eiffel Tower & Trocadéro", duration: "2 hrs", cost: 26, walkMinutes: 7 },
          { image: "/trips/paris.jpg", hour: "12:00", type: "Food", name: "Le Marais bistro lunch", duration: "1.5 hrs", cost: 24, walkMinutes: 12 },
          { image: "/trips/paris.jpg", hour: "15:00", type: "Culture", name: "Louvre highlights", duration: "3 hrs", cost: 22, walkMinutes: 9 },
        ],
      },
      {
        activities: [
          { image: "/trips/paris.jpg", hour: "9:00", type: "Culture", name: "Musée d'Orsay", duration: "2.5 hrs", cost: 16, walkMinutes: 10 },
          { image: "/trips/paris.jpg", hour: "13:00", type: "Food", name: "Ladurée & Saint-Germain stroll", duration: "1.5 hrs", cost: 20, walkMinutes: 8 },
          { image: "/trips/paris.jpg", hour: "16:00", type: "Sight", name: "Notre-Dame & Île de la Cité", duration: "2 hrs", cost: 0, walkMinutes: 11 },
        ],
      },
      {
        activities: [
          { image: "/trips/paris.jpg", hour: "10:00", type: "Shopping", name: "Galeries Lafayette rooftop", duration: "2 hrs", cost: 0, walkMinutes: 14 },
          { image: "/trips/paris.jpg", hour: "13:30", type: "Food", name: "Montmartre creperie", duration: "1.5 hrs", cost: 16, walkMinutes: 10 },
          { image: "/trips/paris.jpg", hour: "15:30", type: "Sight", name: "Sacré-Cœur sunset", duration: "1.5 hrs", cost: 0, walkMinutes: 18 },
        ],
      },
    ],
    budget: {
      spent: 427,
      whole: 500,
      breakdown: [
        { get label() { return i18n.t("accommodation", { ns: "trips" }); }, amount: 180, color: "#5d7bd5" },
        { get label() { return i18n.t("food", { ns: "trips" }); }, amount: 120, color: "#f2664b" },
        { get label() { return i18n.t("activities", { ns: "trips" }); }, amount: 72, color: "#43b047" },
        { get label() { return i18n.t("transport", { ns: "trips" }); }, amount: 35, color: "#a05bd5" },
        { get label() { return i18n.t("other", { ns: "trips" }); }, amount: 20, color: "#e0a22e" },
      ],
    },
    prefDefaults: { tags: ["architecture", "shopping"], pace: 1, walking: 1 },
  },
  {
    id: "rome",
    city: "Rome",
    country: "Italy",
    days: 3,
    image: "/trips/rome.jpg",
    dateLabel: "Mar 5-8",
    stepsKm: 18,
    weather: { icon: WbSunnyOutlined, temp: 21, get label() { return i18n.t("sunny", { ns: "trips" }); } },
    center: [41.9028, 12.4964],
    dayRoutes: makeRoutes([41.9028, 12.4964], 3, 3),
    tripDays: [
      {
        activities: [
          { image: "/trips/rome.jpg", hour: "9:00", type: "Sight", name: "Colosseum & Roman Forum", duration: "3 hrs", cost: 18, walkMinutes: 6 },
          { image: "/trips/rome.jpg", hour: "13:00", type: "Food", name: "Trastevere pasta lunch", duration: "1.5 hrs", cost: 22, walkMinutes: 15 },
          { image: "/trips/rome.jpg", hour: "15:30", type: "Culture", name: "Trevi Fountain & Pantheon", duration: "2 hrs", cost: 0, walkMinutes: 8 },
        ],
      },
      {
        activities: [
          { image: "/trips/rome.jpg", hour: "9:30", type: "Culture", name: "Vatican Museums & Sistine Chapel", duration: "4 hrs", cost: 30, walkMinutes: 12 },
          { image: "/trips/rome.jpg", hour: "14:00", type: "Food", name: "Gelato crawl", duration: "1 hr", cost: 10, walkMinutes: 9 },
          { image: "/trips/rome.jpg", hour: "16:00", type: "Sight", name: "Trastevere evening walk", duration: "2 hrs", cost: 0, walkMinutes: 16 },
        ],
      },
      {
        activities: [
          { image: "/trips/rome.jpg", hour: "10:00", type: "Shopping", name: "Via del Corso & boutiques", duration: "2 hrs", cost: 0, walkMinutes: 11 },
          { image: "/trips/rome.jpg", hour: "13:30", type: "Food", name: "Campo de' Fiori market lunch", duration: "1.5 hrs", cost: 18, walkMinutes: 7 },
          { image: "/trips/rome.jpg", hour: "16:00", type: "Culture", name: "Borghese Villa gardens", duration: "2 hrs", cost: 12, walkMinutes: 14 },
        ],
      },
    ],
    budget: {
      spent: 312,
      whole: 300,
      breakdown: [
        { get label() { return i18n.t("accommodation", { ns: "trips" }); }, amount: 140, color: "#5d7bd5" },
        { get label() { return i18n.t("food", { ns: "trips" }); }, amount: 80, color: "#f2664b" },
        { get label() { return i18n.t("activities", { ns: "trips" }); }, amount: 55, color: "#43b047" },
        { get label() { return i18n.t("transport", { ns: "trips" }); }, amount: 22, color: "#a05bd5" },
        { get label() { return i18n.t("other", { ns: "trips" }); }, amount: 15, color: "#e0a22e" },
      ],
    },
    prefDefaults: { tags: ["culture", "food"], pace: 2, walking: 0 },
  },
  {
    id: "lisbon",
    city: "Lisbon",
    country: "Portugal",
    days: 3,
    image: "/trips/lisbon.jpg",
    dateLabel: "Apr 2-5",
    stepsKm: 21,
    weather: { icon: CloudOutlined, temp: 19, get label() { return i18n.t("partlyCloudy", { ns: "trips" }); } },
    center: [38.7223, -9.1393],
    dayRoutes: makeRoutes([38.7223, -9.1393], 3, 3),
    tripDays: [
      {
        activities: [
          { image: "/trips/lisbon.jpg", hour: "9:30", type: "Sight", name: "Alfama & São Jorge Castle", duration: "2.5 hrs", cost: 10, walkMinutes: 9 },
          { image: "/trips/lisbon.jpg", hour: "13:00", type: "Food", name: "Time Out Market lunch", duration: "1.5 hrs", cost: 26, walkMinutes: 12 },
          { image: "/trips/lisbon.jpg", hour: "15:30", type: "Culture", name: "Fado museum", duration: "1.5 hrs", cost: 8, walkMinutes: 7 },
        ],
      },
      {
        activities: [
          { image: "/trips/lisbon.jpg", hour: "10:00", type: "Sight", name: "Belém Tower & Jerónimos", duration: "3 hrs", cost: 14, walkMinutes: 10 },
          { image: "/trips/lisbon.jpg", hour: "14:00", type: "Food", name: "Pastéis de Belém", duration: "1 hr", cost: 9, walkMinutes: 8 },
          { image: "/trips/lisbon.jpg", hour: "16:00", type: "Nature", name: "LX Factory street art", duration: "2 hrs", cost: 0, walkMinutes: 13 },
        ],
      },
      {
        activities: [
          { image: "/trips/lisbon.jpg", hour: "9:00", type: "Food", name: "Bairro Alto tastings", duration: "2 hrs", cost: 20, walkMinutes: 11 },
          { image: "/trips/lisbon.jpg", hour: "12:30", type: "Sight", name: "Miradouro da Senhora do Monte", duration: "1.5 hrs", cost: 0, walkMinutes: 9 },
          { image: "/trips/lisbon.jpg", hour: "15:00", type: "Shopping", name: "Chiado boutiques & bookshop", duration: "2 hrs", cost: 0, walkMinutes: 15 },
        ],
      },
    ],
    budget: {
      spent: 515,
      whole: 560,
      breakdown: [
        { get label() { return i18n.t("accommodation", { ns: "trips" }); }, amount: 200, color: "#5d7bd5" },
        { get label() { return i18n.t("food", { ns: "trips" }); }, amount: 140, color: "#f2664b" },
        { get label() { return i18n.t("activities", { ns: "trips" }); }, amount: 80, color: "#43b047" },
        { get label() { return i18n.t("transport", { ns: "trips" }); }, amount: 60, color: "#a05bd5" },
        { get label() { return i18n.t("other", { ns: "trips" }); }, amount: 35, color: "#e0a22e" },
      ],
    },
    prefDefaults: { tags: ["food", "nature"], pace: 0, walking: 2 },
  },
];

export function getTripDetail(id: string): TripDetail | undefined {
  return TRIP_DETAILS.find((trip) => trip.id === id);
}

export function findTripDetailByKey(fixtureKey: string | null): TripDetail | undefined {
  if (!fixtureKey) {
    return undefined;
  }

  return getTripDetail(fixtureKey);
}

export const EMPTY_BUDGET_BREAKDOWN: BudgetSlice[] = [
  { get label() { return i18n.t("remaining", { ns: "trips" }); }, amount: 0, color: "#5d7bd5" },
];