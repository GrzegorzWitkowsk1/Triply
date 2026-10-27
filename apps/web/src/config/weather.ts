import i18n from "../i18n";
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
  0: { icon: WbSunnyOutlined, get label() { return i18n.t("sunny", { ns: "trips/weather" }); } },
  1: { icon: WbSunnyOutlined, get label() { return i18n.t("mostlySunny", { ns: "trips/weather" }); } },
  2: { icon: WbCloudyOutlined, get label() { return i18n.t("partlyCloudy", { ns: "trips/weather" }); } },
  3: { icon: CloudOutlined, get label() { return i18n.t("cloudy", { ns: "trips/weather" }); } },
  45: { icon: Foggy, get label() { return i18n.t("foggy", { ns: "trips/weather" }); } },
  48: { icon: Foggy, get label() { return i18n.t("foggy", { ns: "trips/weather" }); } },
  51: { icon: GrainOutlined, get label() { return i18n.t("drizzle", { ns: "trips/weather" }); } },
  53: { icon: GrainOutlined, get label() { return i18n.t("drizzle", { ns: "trips/weather" }); } },
  55: { icon: GrainOutlined, get label() { return i18n.t("drizzle", { ns: "trips/weather" }); } },
  56: { icon: GrainOutlined, get label() { return i18n.t("drizzle", { ns: "trips/weather" }); } },
  57: { icon: GrainOutlined, get label() { return i18n.t("drizzle", { ns: "trips/weather" }); } },
  61: { icon: WaterDropOutlined, get label() { return i18n.t("rainy", { ns: "trips/weather" }); } },
  63: { icon: WaterDropOutlined, get label() { return i18n.t("rainy", { ns: "trips/weather" }); } },
  65: { icon: WaterDropOutlined, get label() { return i18n.t("rainy", { ns: "trips/weather" }); } },
  66: { icon: WaterDropOutlined, get label() { return i18n.t("rainy", { ns: "trips/weather" }); } },
  67: { icon: WaterDropOutlined, get label() { return i18n.t("rainy", { ns: "trips/weather" }); } },
  71: { icon: AcUnitOutlined, get label() { return i18n.t("snowy", { ns: "trips/weather" }); } },
  73: { icon: AcUnitOutlined, get label() { return i18n.t("snowy", { ns: "trips/weather" }); } },
  75: { icon: AcUnitOutlined, get label() { return i18n.t("snowy", { ns: "trips/weather" }); } },
  77: { icon: AcUnitOutlined, get label() { return i18n.t("snowy", { ns: "trips/weather" }); } },
  80: { icon: WaterDropOutlined, get label() { return i18n.t("rainy", { ns: "trips/weather" }); } },
  81: { icon: WaterDropOutlined, get label() { return i18n.t("rainy", { ns: "trips/weather" }); } },
  82: { icon: WaterDropOutlined, get label() { return i18n.t("rainy", { ns: "trips/weather" }); } },
  85: { icon: AcUnitOutlined, get label() { return i18n.t("snowy", { ns: "trips/weather" }); } },
  86: { icon: AcUnitOutlined, get label() { return i18n.t("snowy", { ns: "trips/weather" }); } },
  95: { icon: ThunderstormOutlined, get label() { return i18n.t("thunderstorm", { ns: "trips/weather" }); } },
  96: { icon: ThunderstormOutlined, get label() { return i18n.t("thunderstorm", { ns: "trips/weather" }); } },
  99: { icon: ThunderstormOutlined, get label() { return i18n.t("thunderstorm", { ns: "trips/weather" }); } },
};

const FALLBACK_DISPLAY: WeatherDisplay = { icon: CloudOutlined, get label() { return i18n.t("cloudy", { ns: "trips/weather" }); } };

export function toTripWeather(day: TripDayWeather): TripWeather {
  const display = WEATHER_DISPLAYS[day.weatherCode] ?? FALLBACK_DISPLAY;

  return {
    icon: display.icon,
    temp: Math.round(day.temperatureMax),
    label: display.label,
  };
}
