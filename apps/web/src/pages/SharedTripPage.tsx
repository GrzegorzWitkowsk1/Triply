import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { TimelineEntry } from "../config/itineraryAdapters";
import { formatClock } from "../config/itineraryAdapters";
import { getPublicTrip } from "../api/sharing";
import TripTimeline from "../components/trip/TripTimeline";
import TripMap from "../components/trip/TripMap";
import TripExportActions from "../components/trip/TripExportActions";
import { toTripWeather } from "../config/weather";
import ChevronLeftOutlined from "@mui/icons-material/ChevronLeftOutlined";
import { ChevronRightOutlined } from "@mui/icons-material";

export default function SharedTripPage() {
  const { shareToken = "" } = useParams();
  const [activeDay, setActiveDay] = useState(0);
  const [activeStop, setActiveStop] = useState(0);
  const trip = useQuery({
    queryKey: ["publicTrip", shareToken],
    queryFn: ({ signal }) => getPublicTrip(shareToken, signal),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
  });
  if (trip.isPending)
    return (
      <main className="trip-page shared-trip-page" role="status">
        Loading shared itinerary…
      </main>
    );
  // Hide cached data on a failed revalidation, including revocation.
  if (trip.isError || !trip.data)
    return (
      <main className="trip-page shared-trip-page">
        <p role="alert">
          This shared trip is unavailable. The link may have been disabled or
          replaced.
        </p>
      </main>
    );
  const data = trip.data;
  const day = data.days[activeDay];
  const entries: TimelineEntry[] = (day?.activities ?? []).map((a, i) => {
    const key = `${activeDay}-${i}`;
    if (a.type === "travel")
      return {
        kind: "travel",
        key,
        minutes: a.durationMinutes,
        toName: a.title,
      };
    if (a.type === "break")
      return {
        kind: "break",
        key,
        minutes: a.durationMinutes,
        name: a.title,
        time: formatClock(a.startTime),
        icon: /coffee/i.test(a.title) ? "coffee" : "meal",
      };
    return {
      kind: "attraction",
      key,
      stopIndex: a.stopIndex ?? -1,
      name: a.title,
      category: day?.stops[a.stopIndex ?? -1]?.category ?? "Sight",
      time:
        a.schedulingStatus === "unresolved"
          ? "Unresolved"
          : formatClock(a.startTime),
      durationMinutes: a.durationMinutes,
    };
  });
  const forecast = data.weather.find((w) => w.date === day?.date);
  const weather = forecast ? toTripWeather(forecast) : null;
  const center: [number, number] | null = data.location
    ? [data.location.lat, data.location.lng]
    : day?.stops[0]
      ? [day.stops[0].lat, day.stops[0].lng]
      : null;
  return (
    <main className="trip-page shared-trip-page">
      <div className="trip-inner">
        <section className="trip-hero">
          <div className="trip-hero-locale">
            <p className="trip-eyebrow">Shared itinerary · Read only</p>
            <h1>
              {data.destination}
              {data.country ? `, ${data.country}` : ""}
            </h1>
            <p>
              {data.startDate} {data.endDate ? `– ${data.endDate}` : ""}
              {data.durationDays ? ` · ${data.durationDays} days` : ""}
            </p>
          </div>
          <div className="trip-hero-actions"><TripExportActions key={shareToken} target={{ shareToken }} /></div>
        </section>
        {day ? (
          <div className="trip-content">
            <div className="trip-left">
              <div className="trip-day-header">
                <span>
                  Day {activeDay + 1} of {data.days.length} · {day.date}
                </span>
                <div className="trip-day-nav">
                  <button
                    aria-label="Previous day"
                    disabled={activeDay === 0}
                    onClick={() => {
                      setActiveDay(activeDay - 1);
                      setActiveStop(0);
                    }}
                  >
                    <ChevronLeftOutlined />
                  </button>
                  <button
                    aria-label="Next day"
                    disabled={activeDay >= data.days.length - 1}
                    onClick={() => {
                      setActiveDay(activeDay + 1);
                      setActiveStop(0);
                    }}
                  >
                    <ChevronRightOutlined />
                  </button>
                </div>
              </div>
              {weather && (
                <p>
                  {weather.temp}° · {weather.label}
                </p>
              )}
              {day.travelMode && <p>Travel mode: {day.travelMode}</p>}
              <TripTimeline
                entries={entries}
                activeStop={activeStop}
                onSelectStop={setActiveStop}
              />
              {day.stops.map(
                (stop, i) =>
                  (stop.address || stop.description) && (
                    <section key={i}>
                      <h3>{stop.name}</h3>
                      <p>{stop.address}</p>
                      <p>{stop.description}</p>
                    </section>
                  ),
              )}
              {!entries.length && <p>No activities scheduled for this day.</p>}
            </div>
            <div className="trip-right">
              {center && (
                <TripMap
                  center={center}
                  stops={day.stops.map((s) => [s.lat, s.lng])}
                  geometry={
                    day.geometry?.coordinates.map(([lng, lat]) => [lat, lng]) ??
                    null
                  }
                  active={activeStop}
                  onSelect={setActiveStop}
                />
              )}
            </div>
          </div>
        ) : (
          <p>No itinerary is available yet.</p>
        )}
      </div>
    </main>
  );
}
