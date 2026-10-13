import { IconButton, Tooltip, CircularProgress } from "@mui/material";
import { RefreshOutlined, CloudOutlined } from "@mui/icons-material";
import { useEffect, useState, type ReactNode } from "react";
import { addDays, weatherAvailabilityMessage, type WeatherAvailability } from "@triply/shared";
import { useRefreshTripWeather } from "../../hooks/useTripWeather";

export default function TripWeatherRetry({ tripId, availability, date, forecast }: { tripId: string; availability?: WeatherAvailability; date?: string; forecast?: ReactNode }) {
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
  const retryDate = availability?.retryAfter ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: availability.timeZone ?? undefined }).format(new Date(availability.retryAfter)) : null;
  const selectedAvailableDate = selectedFuture && date && availability?.forecastStart && availability.forecastEnd
    ? addDays(date, -Math.round((Date.parse(availability.forecastEnd) - Date.parse(availability.forecastStart)) / 86_400_000)) : null;
  const message = (selectedFuture || availability?.status === "not_yet_available") && availability?.status !== "available"
    ? availability?.status === "not_yet_available" && retryDate && cooling
      ? `Forecast will be available from ${retryDate} (${availability?.timeZone}).`
      : selectedAvailableDate ? `Forecast will be available from ${selectedAvailableDate} at 12:00 (${availability?.timeZone}).`
      : "Forecast not available yet. Check again closer to your trip."
    : selectedPast && availability?.status !== "available" ? "Forecasts are unavailable for past dates. Historical weather is not shown."
    : availability ? weatherAvailabilityMessage(availability) : "Weather status unavailable.";
  const permanent = availability?.status === "unsupported_past" || availability?.status === "invalid_dates";
  const tooltip = cooling ? `Weather can be refreshed on ${retryDate} (${availability?.timeZone ?? "local time"}).` : permanent ? message ?? "Weather unavailable." : "Refresh weather";
  return (
    <span className="trip-badge">
      {forecast ?? <CloudOutlined />}
      {message && <span role="status">{message}</span>}
      {!message && !forecast && <span role="status">Weather available</span>}
      <Tooltip title={tooltip}><span style={{ display: "inline-flex" }}><IconButton size="small" disabled={refresh.isPending || cooling || permanent}
        aria-label={refresh.isPending ? "Retrying weather…" : "Retry weather"}
        onClick={() => refresh.mutate(tripId)}>{refresh.isPending ? <CircularProgress size={12} /> : <RefreshOutlined fontSize="small" />}</IconButton></span></Tooltip>
      {refresh.error && <span role="alert">Weather could not be refreshed. Please try again later.</span>}
    </span>
  );
}
