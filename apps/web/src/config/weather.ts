import {
  AcUnitOutlined,
  CloudOutlined,
  Foggy,
  GrainOutlined,
  ThunderstormOutlined,
  WbCloudyOutlined,
  WbSunnyOutlined,
  WaterDropOutlined,
} from "@mui/icons-material";
import type { TripDayWeather } from "@triply/shared";
import type { TripWeather } from "./trip";

interface WeatherDisplay {
  icon: typeof WbSunnyOutlined;
  label: string;
}

const WEATHER_DISPLAYS: Record<number, WeatherDisplay> = {
  0: { icon: WbSunnyOutlined, label: "sunny" },
  1: { icon: WbSunnyOutlined, label: "mostly sunny" },
  2: { icon: WbCloudyOutlined, label: "partly cloudy" },
  3: { icon: CloudOutlined, label: "cloudy" },
  45: { icon: Foggy, label: "foggy" },
  48: { icon: Foggy, label: "foggy" },
  51: { icon: GrainOutlined, label: "drizzle" },
  53: { icon: GrainOutlined, label: "drizzle" },
  55: { icon: GrainOutlined, label: "drizzle" },
  56: { icon: GrainOutlined, label: "drizzle" },
  57: { icon: GrainOutlined, label: "drizzle" },
  61: { icon: WaterDropOutlined, label: "rainy" },
  63: { icon: WaterDropOutlined, label: "rainy" },
  65: { icon: WaterDropOutlined, label: "rainy" },
  66: { icon: WaterDropOutlined, label: "rainy" },
  67: { icon: WaterDropOutlined, label: "rainy" },
  71: { icon: AcUnitOutlined, label: "snowy" },
  73: { icon: AcUnitOutlined, label: "snowy" },
  75: { icon: AcUnitOutlined, label: "snowy" },
  77: { icon: AcUnitOutlined, label: "snowy" },
  80: { icon: WaterDropOutlined, label: "rainy" },
  81: { icon: WaterDropOutlined, label: "rainy" },
  82: { icon: WaterDropOutlined, label: "rainy" },
  85: { icon: AcUnitOutlined, label: "snowy" },
  86: { icon: AcUnitOutlined, label: "snowy" },
  95: { icon: ThunderstormOutlined, label: "thunderstorm" },
  96: { icon: ThunderstormOutlined, label: "thunderstorm" },
  99: { icon: ThunderstormOutlined, label: "thunderstorm" },
};

const FALLBACK_DISPLAY: WeatherDisplay = { icon: CloudOutlined, label: "cloudy" };

export function toTripWeather(day: TripDayWeather): TripWeather {
  const display = WEATHER_DISPLAYS[day.weatherCode] ?? FALLBACK_DISPLAY;

  return {
    icon: display.icon,
    temp: Math.round(day.temperatureMax),
    label: display.label,
  };
}
