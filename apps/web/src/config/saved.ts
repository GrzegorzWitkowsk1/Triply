import {
  AttractionsOutlined,
  BakeryDiningOutlined,
  CardGiftcardOutlined,
  LandscapeOutlined,
  LightbulbOutlined,
  RestaurantOutlined,
  StorefrontOutlined,
} from "@mui/icons-material";

export interface SavedPlace {
  id: string;
  badge: string;
  image: string;
  name: string;
  city: string;
  description: string;
  icon: typeof RestaurantOutlined;
}

export const SAVED_PLACES: SavedPlace[] = [
  {
    id: "bar-canete",
    badge: "Restaurant",
    image: "/barcelona.jpg",
    name: "Bar Cañete",
    city: "Barcelona",
    description: "Book the counter seats for dinner",
    icon: RestaurantOutlined,
  },
  {
    id: "casa-batllo",
    badge: "Sight",
    image: "/barcelona.jpg",
    name: "Casa Batlló",
    city: "Barcelona",
    description: "Golden hour photos from the rooftop",
    icon: AttractionsOutlined,
  },
  {
    id: "time-out-market",
    badge: "Food hall",
    image: "/trips/lisbon.jpg",
    name: "Time Out Market",
    city: "Lisbon",
    description: "Great first-night dinner option",
    icon: StorefrontOutlined,
  },
  {
    id: "trastevere-walk",
    badge: "Idea",
    image: "/trips/rome.jpg",
    name: "Trastevere evening walk",
    city: "Rome",
    description: "Save for the last night",
    icon: LightbulbOutlined,
  },
];

export interface TripIdea {
  id: string;
  title: string;
  description: string;
  icon: typeof RestaurantOutlined;
}

export const TRIP_IDEAS: TripIdea[] = [
  {
    id: "lisbon-bakery",
    title: "A bakery tour of Lisbon",
    description: "From your Lisbon trip chat",
    icon: BakeryDiningOutlined,
  },
  {
    id: "montserrat",
    title: "Day trip to Montserrat",
    description: "Suggested by Triply",
    icon: LandscapeOutlined,
  },
  {
    id: "prague-markets",
    title: "Prague Christmas markets",
    description: "From Explore · Culture deep-dives",
    icon: CardGiftcardOutlined,
  },
];