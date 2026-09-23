import {
  AccountBalanceOutlined,
  PaletteOutlined,
  RestaurantOutlined,
  WavesOutlined,
} from "@mui/icons-material";

export interface TrendingTrip {
  id: string;
  city: string;
  country: string;
  days: number;
  image: string;
  activities: number;
}

export const TRENDING_TRIPS: TrendingTrip[] = [
  {
    id: "barcelona",
    city: "Barcelona",
    country: "Spain",
    days: 4,
    image: "/barcelona.jpg",
    activities: 12,
  },
  {
    id: "rome",
    city: "Rome",
    country: "Italy",
    days: 4,
    image: "/trips/rome.jpg",
    activities: 9,
  },
  {
    id: "prague",
    city: "Prague",
    country: "Czechia",
    days: 4,
    image: "/trips/prague.jpg",
    activities: 8,
  },
  {
    id: "lisbon",
    city: "Lisbon",
    country: "Portugal",
    days: 5,
    image: "/trips/lisbon.jpg",
    activities: 11,
  },
];

export interface Collection {
  id: string;
  title: string;
  description: string;
  icon: typeof RestaurantOutlined;
  color: string;
  tags: string[];
}

export const COLLECTIONS: Collection[] = [
  {
    id: "food",
    title: "Food-first weekends",
    description:
      "Cities where every meal is the highlight — tapas bars, markets, and hidden trattorias.",
    icon: RestaurantOutlined,
    color: "#f2664b",
    tags: ["Barcelona", "San Sebastián", "Bologna"],
  },
  {
    id: "architecture",
    title: "Architecture & icons",
    description:
      "Gaudí, Gothic lanes, and grand boulevards for travelers who look up while they walk.",
    icon: AccountBalanceOutlined,
    color: "#5d7bd5",
    tags: ["Barcelona", "Rome", "Prague"],
  },
  {
    id: "coastal",
    title: "Slow coastal escapes",
    description:
      "Sea air, long lunches, and unhurried evenings by the water.",
    icon: WavesOutlined,
    color: "#3aa6d1",
    tags: ["Lisbon", "Cascais", "Nice"],
  },
  {
    id: "culture",
    title: "Culture deep-dives",
    description:
      "Museums, neighborhoods with stories, and local life beyond the postcards.",
    icon: PaletteOutlined,
    color: "#a05bd5",
    tags: ["Rome", "Prague", "Vienna"],
  },
];