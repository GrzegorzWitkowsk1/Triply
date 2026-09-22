import {
  AccountBalanceOutlined,
  AccountBalanceWalletOutlined,
  LandscapeOutlined,
  PaletteOutlined,
  RestaurantOutlined,
  WavesOutlined,
} from "@mui/icons-material";

export interface HomeBadge {
  id: string;
  label: string;
  icon: typeof RestaurantOutlined;
  color: string;
}

export const HOME_BADGES: HomeBadge[] = [
  { id: "food", label: "Food trip", icon: RestaurantOutlined, color: "#f2664b" },
  { id: "architecture", label: "Architecture weekend", icon: AccountBalanceOutlined, color: "#5d7bd5" },
  { id: "beach", label: "Beach getaway", icon: WavesOutlined, color: "#3aa6d1" },
  { id: "nature", label: "Nature escape", icon: LandscapeOutlined, color: "#43b047" },
  { id: "culture", label: "Culture & museums", icon: PaletteOutlined, color: "#a05bd5" },
];

export interface Trip {
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
}

export const TRIPS: Trip[] = [
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
  },
];

export function isOverBudget(trip: Trip): boolean {
  return trip.budgetUsed > trip.budgetExpected;
}