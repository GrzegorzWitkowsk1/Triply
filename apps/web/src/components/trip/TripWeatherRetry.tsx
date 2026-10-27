import { localizedWeather } from "../../i18n/labels";
import { formatDate } from "../../i18n/format";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { IconButton, Tooltip, CircularProgress } from "@mui/material";
import { RefreshOutlined, CloudOutlined } from "@mui/icons-material";
import { useEffect, useState, type ReactNode } from "react";
import { addDays, weatherAvailabilityMessage, type WeatherAvailability } from "@triply/shared";
import { useRefreshTripWeather } from "../../hooks/useTripWeather";

export default function TripWeatherRetry({ tripId, availability, date, forecast }: { tripId: string; availability?: WeatherAvailability; date?: string; forecast?: ReactNode }) {
  useTranslation();
  const refresh = useRefreshTripWeather();
  const [, tick] = useState(0);
  useEffect(() => {
    const until = Date.parse(availability?.retryAfter ?? "");
    if (!Number.isFinite(until) || until <= Date.now()) return;
    const timer = setTimeout(() => tick(value => value + 1), Math.min(until - Date.now() + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  });
  const selectedFuture = date && availability?.forecastEnd && date > availability.forecastEnd;
  const selectedPast = date && availability?.forecastStart && date < availability.forecastStart;
  const cooling = Boolean(availability?.retryAfter && Date.parse(availability.retryAfter) > Date.now());
  const retryDate = availability?.retryAfter ? formatDate(availability.retryAfter, { dateStyle: "medium", timeStyle: "short", timeZone: availability.timeZone ?? undefined }) : null;
  const selectedAvailableDate = selectedFuture && date && availability?.forecastStart && availability.forecastEnd
    ? addDays(date, -Math.round((Date.parse(availability.forecastEnd) - Date.parse(availability.forecastStart)) / 86_400_000)) : null;
  const message = (selectedFuture || availability?.status === "not_yet_available") && availability?.status !== "available"
    ? availability?.status === "not_yet_available" && retryDate && cooling
      ? i18n.t("forecastWillBeAvailableFrom", { ns: "trips/weather", value0: retryDate, value1: availability?.timeZone })
      : selectedAvailableDate ? i18n.t("forecastWillBeAvailableFromAt1200", { ns: "trips/weather", value0: formatDate(selectedAvailableDate), value1: availability?.timeZone })
      : i18n.t("not_yet_available", { ns: "trips/weather" })
    : selectedPast && availability?.status !== "available" ? i18n.t("unsupported_past", { ns: "trips/weather" })
    : availability ? localizedWeather(availability) : i18n.t("weatherStatusUnavailable", { ns: "trips/weather" });
  const permanent = availability?.status === "unsupported_past" || availability?.status === "invalid_dates";
  const tooltip = cooling ? i18n.t("weatherCanBeRefreshedOn", { ns: "trips/weather", value0: retryDate, value1: availability?.timeZone ?? i18n.t("localTime", { ns: "trips/weather" }) }) : permanent ? message ?? i18n.t("weatherStatusUnavailable", { ns: "trips/weather" }) : i18n.t("refreshWeather", { ns: "trips/weather" });
  return (
    <span className="trip-badge">
      {forecast ?? <CloudOutlined />}
      {message && <span role="status">{message}</span>}
      {!message && !forecast && <span role="status">{i18n.t("weatherAvailable", { ns: "trips/weather" })}</span>}
      <Tooltip title={tooltip}><span style={{ display: "inline-flex" }}><IconButton size="small" disabled={refresh.isPending || cooling || permanent}
        aria-label={refresh.isPending ? i18n.t("retryingWeather", { ns: "trips/weather" }) : i18n.t("retryWeather", { ns: "trips/weather" })}
        onClick={() => refresh.mutate(tripId)}>{refresh.isPending ? <CircularProgress size={12} /> : <RefreshOutlined fontSize="small" />}</IconButton></span></Tooltip>
      {refresh.error && <span role="alert">{i18n.t("weatherCouldNotBeRefreshedPleaseTryAgain", { ns: "trips/weather" })}</span>}
    </span>
  );
}
