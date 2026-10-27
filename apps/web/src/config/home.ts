import i18n from "../i18n";
import {
  AccountBalanceOutlined,
  AccountBalanceWalletOutlined,
  LandscapeOutlined,
  PaletteOutlined,
  RestaurantOutlined,
  WavesOutlined,
  NightlifeOutlined,
  ShoppingBagOutlined,
} from "@mui/icons-material";

export interface HomeBadge {
  id: string;
  label: string;
  icon: typeof RestaurantOutlined;
  color: string;
}

export const HOME_BADGES: HomeBadge[] = [
  { id: "food", get label() { return i18n.t("foodTrip", { ns: "tripCreator/home" }); }, icon: RestaurantOutlined, color: "#f2664b" },
  { id: "architecture", get label() { return i18n.t("architectureWeekend", { ns: "tripCreator/home" }); }, icon: AccountBalanceOutlined, color: "#5d7bd5" },
  { id: "beach", get label() { return i18n.t("beachGetaway", { ns: "tripCreator/home" }); }, icon: WavesOutlined, color: "#3aa6d1" },
  { id: "nature", get label() { return i18n.t("natureEscape", { ns: "tripCreator/home" }); }, icon: LandscapeOutlined, color: "#43b047" },
  { id: "culture", get label() { return i18n.t("cultureMuseums", { ns: "tripCreator/home" }); }, icon: PaletteOutlined, color: "#a05bd5" },
  { id: "shopping", get label() { return i18n.t("shopping", { ns: "tripCreator/home" }); }, icon: ShoppingBagOutlined, color: "#e0a22e" },
  { id: "nightlife", get label() { return i18n.t("nightlife", { ns: "tripCreator/home" }); }, icon: NightlifeOutlined, color: "#a05bd5" },
];

export type PlanStageStatus = "queue" | "active" | "done";

export interface PlanStage {
  id: string;
  label: string;
}

export const PLAN_STAGES: PlanStage[] = [
  { id: "places", get label() { return i18n.t("findingPlacesYouLlLove", { ns: "tripCreator/home" }); } },
  { id: "route", get label() { return i18n.t("optimizingYourRoute", { ns: "tripCreator/home" }); } },
  { id: "budget", get label() { return i18n.t("balancingYourBudget", { ns: "tripCreator/home" }); } },
  { id: "itinerary", get label() { return i18n.t("buildingYourItinerary", { ns: "tripCreator/home" }); } },
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
