import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AccountBalanceWalletOutlined,
  AutoFixHighOutlined,
  BackpackOutlined,
  ChevronLeftOutlined,
  ChevronRightOutlined,
  DirectionsWalkOutlined,
  EditOutlined,
  PlaceOutlined,
  ShareOutlined,
} from "@mui/icons-material";
import { PACE_VALUES, type Pace } from "@triply/shared";
import TripAssistant from "../components/trip/TripAssistant";
import TripBudgetCard from "../components/trip/TripBudgetCard";
import TripMap from "../components/trip/TripMap";
import TripPreferencesCard from "../components/trip/TripPreferencesCard";
import TripTimeline from "../components/trip/TripTimeline";
import {
  buildDayTimeline,
  dayGeometry,
  dayStops,
  totalItineraryActivities,
  totalWalkingKm,
} from "../config/itineraryAdapters";
import { toTripWeather } from "../config/weather";
import { useGenerateTrip } from "../hooks/useTripGeneration";
import { useTrip } from "../hooks/useTrips";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const STALE_GENERATION_MS = 2 * 60 * 1000;

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  PLN: "zł",
  CHF: "CHF ",
};

function formatRange(startDate: string | null, endDate: string | null): string {
  if (!startDate) {
    return "Dates to be decided";
  }

  const start = new Date(`${startDate}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime())) {
    return "Dates to be decided";
  }

  const startLabel = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;

  if (!endDate) {
    return startLabel;
  }

  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(end.getTime()) || endDate === startDate) {
    return startLabel;
  }

  const endLabel =
    start.getUTCMonth() === end.getUTCMonth()
      ? String(end.getUTCDate())
      : `${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`;

  return `${startLabel}-${endLabel}`;
}

function formatBudget(amount: number | null, currency: string | null): string | null {
  if (amount === null) {
    return null;
  }

  const symbol = currency ? CURRENCY_SYMBOLS[currency] ?? `${currency} ` : "";

  return `${symbol}${Math.round(amount)}`;
}

function paceIndex(pace: Pace | null): number {
  const index = PACE_VALUES.indexOf(pace ?? "balanced");

  return index >= 0 ? index : 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const trip = useTrip(id);
  const generate = useGenerateTrip();

  const [activeDay, setActiveDay] = useState(0);
  const [activeStop, setActiveStop] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [pace, setPace] = useState(1);
  const [walking, setWalking] = useState(1);
  const autoStartRef = useRef(false);

  const analysis = trip.data?.analysis ?? null;
  const itinerary = trip.data?.itinerary ?? null;
  const status = trip.data?.status ?? "draft";

  const isGenerating = (status === "generating" || generate.isPending) && !generate.isError;
  const isFailed = status === "failed" || generate.isError;

  useEffect(() => {
    setTags(analysis?.interests ?? []);
    setPace(paceIndex(analysis?.pace ?? null));
  }, [analysis?.interests, analysis?.pace]);

  const dayCount = itinerary?.days.length ?? analysis?.durationDays ?? 0;

  useEffect(() => {
    setActiveDay((current) => Math.min(current, Math.max(dayCount - 1, 0)));
  }, [dayCount, id]);

  useEffect(() => {
    setActiveStop(0);
    autoStartRef.current = false;
  }, [id]);

  const autoStart =
    (location.state as { autoStart?: boolean } | null)?.autoStart ?? false;

  useEffect(() => {
    if (!id || !autoStart || autoStartRef.current || status !== "draft" || generate.isPending) {
      return;
    }

    autoStartRef.current = true;
    navigate(location.pathname, { replace: true });
    generate.mutate(id);
  }, [autoStart, id, status, location.pathname, navigate, generate.mutate]);

  if (trip.isPending) {
    return (
      <div className="trip-page">
        <div className="trip-inner">
          <p className="trip-eyebrow">Loading trip…</p>
        </div>
      </div>
    );
  }

  if (trip.isError || !trip.data || !analysis) {
    return <Navigate to="/trips" replace />;
  }

  const city = analysis.destination ?? "Untitled trip";
  const country = analysis.country ?? "";
  const days = itinerary?.days.length ?? analysis.durationDays ?? 0;
  const dateLabel = formatRange(analysis.startDate, analysis.endDate);
  const day = itinerary?.days[activeDay];
  const dayWeather = trip.data.weather[activeDay];
  const weather = dayWeather ? toTripWeather(dayWeather) : null;
  const WeatherIcon = weather?.icon ?? null;

  const center = analysis.location
    ? ([analysis.location.lat, analysis.location.lng] as [number, number])
    : null;
  const entries = day ? buildDayTimeline(day) : [];
  const stops = dayStops(day);
  const geometry = dayGeometry(day);

  const totalActivities = itinerary ? totalItineraryActivities(itinerary) : 0;
  const walkingKm = itinerary ? totalWalkingKm(itinerary) : null;
  const budgetLabel = formatBudget(analysis.budget.amount, analysis.budget.currency);
  const budgetAmount = analysis.budget.amount;
  const budgetSymbol = analysis.budget.currency
    ? CURRENCY_SYMBOLS[analysis.budget.currency] ?? `${analysis.budget.currency} `
    : "€";

  const generationStartedAt = trip.data.generation.startedAt;
  const isGenerationStale =
    status === "generating" &&
    generationStartedAt !== null &&
    Date.now() - Date.parse(generationStartedAt) > STALE_GENERATION_MS;

  const toggleTag = (tagId: string) => {
    setTags((current) =>
      current.includes(tagId)
        ? current.filter((tag) => tag !== tagId)
        : [...current, tagId]
    );
  };

  const handleGenerate = () => {
    if (!id) {
      return;
    }

    generate.reset();
    generate.mutate(id);
  };

  return (
    <div className="trip-page">
      <div className="trip-inner">
        <section className="trip-hero">
          <div className="trip-hero-locale">
            <p className="trip-eyebrow">Your itinerary</p>
            <h1>
              {city}
              {country ? `, ${country}` : ""}
            </h1>
            <p className="trip-hero-sub">
              {dateLabel}
              {days > 0 ? ` · ${days} days` : ""}
            </p>
            <div className="trip-hero-badges">
              {status === "ready" && WeatherIcon && weather && (
                <span className="trip-badge">
                  <WeatherIcon /> {weather.temp}° {weather.label}
                </span>
              )}
              {budgetLabel && (
                <span className="trip-badge is-budget is-ok">
                  <AccountBalanceWalletOutlined /> {budgetLabel} budget
                </span>
              )}
              {status === "ready" && totalActivities > 0 && (
                <span className="trip-badge">
                  <PlaceOutlined /> {totalActivities} activities
                </span>
              )}
              {status === "ready" && walkingKm !== null && (
                <span className="trip-badge">
                  <DirectionsWalkOutlined /> {walkingKm} km walking
                </span>
              )}
            </div>
          </div>
          <div className="trip-hero-actions">
            <button
              type="button"
              className="trip-action"
              onClick={() => navigate(`/trips/${id}/equipment`)}
            >
              <BackpackOutlined />
            </button>
            <button
              type="button"
              className="trip-action"
              onClick={() => navigate("/", { state: { focusPrompt: true } })}
            >
              <EditOutlined /> Edit
            </button>
            <button type="button" className="trip-action">
              <ShareOutlined /> Share
            </button>
            {status === "ready" && (
              <button
                type="button"
                className="trip-action is-primary"
                onClick={handleGenerate}
                disabled={generate.isPending}
              >
                <AutoFixHighOutlined /> Regenerate Day
              </button>
            )}
          </div>
        </section>

        {status === "ready" && itinerary ? (
          <div className="trip-content">
            <div className="trip-left">
              <div className="trip-day-header">
                <span className="trip-day-label">
                  Day {activeDay + 1} of {dayCount}
                </span>
                <div className="trip-day-nav">
                  <button
                    type="button"
                    aria-label="Previous day"
                    disabled={activeDay === 0}
                    onClick={() => {
                      setActiveDay((dayIndex) => Math.max(0, dayIndex - 1));
                      setActiveStop(0);
                    }}
                  >
                    <ChevronLeftOutlined />
                  </button>
                  <button
                    type="button"
                    aria-label="Next day"
                    disabled={activeDay >= dayCount - 1}
                    onClick={() => {
                      setActiveDay((dayIndex) =>
                        Math.min(dayCount - 1, dayIndex + 1)
                      );
                      setActiveStop(0);
                    }}
                  >
                    <ChevronRightOutlined />
                  </button>
                </div>
              </div>
              <div className="trip-activity-list">
                <TripTimeline
                  entries={entries}
                  activeStop={activeStop}
                  onSelectStop={setActiveStop}
                />
                {entries.length === 0 && (
                  <p className="trip-eyebrow">
                    No activities were scheduled for this day.
                  </p>
                )}
                {day && day.warnings.length > 0 && (
                  <ul className="trip-eyebrow">
                    {day.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="trip-right">
              {center && (
                <div className="trip-map-wrap">
                  <TripMap
                    center={center}
                    stops={stops}
                    geometry={geometry}
                    active={activeStop}
                    onSelect={setActiveStop}
                  />
                  <p className="trip-map-caption">
                    {itinerary.routingSource === "provider"
                      ? `Walking route through the day's stops in ${city}.`
                      : `Approximate walking route through the day's stops in ${city}.`}
                  </p>
                </div>
              )}
              {budgetAmount !== null && (
                <TripBudgetCard
                  whole={budgetAmount}
                  currencySymbol={budgetSymbol}
                  spent={null}
                  breakdown={null}
                />
              )}
              <TripPreferencesCard
                tags={tags}
                onToggleTag={toggleTag}
                pace={pace}
                onPaceChange={setPace}
                walking={walking}
                onWalkingChange={setWalking}
              />
            </div>
          </div>
        ) : (
          <section className="trip-card trip-status">
            {isFailed ? (
              <>
                <div className="trip-card-head">
                  <h3>Itinerary generation failed</h3>
                </div>
                <p className="trip-eyebrow">
                  {generate.error
                    ? errorMessage(generate.error)
                    : trip.data.generation.error ??
                      "We couldn't finish generating your itinerary. Your trip details are saved."}
                </p>
                <div className="plan-summary-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => navigate("/", { state: { focusPrompt: true } })}
                  >
                    Adjust details
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleGenerate}
                    disabled={generate.isPending}
                  >
                    {generate.isPending ? "Retrying…" : "Try again"}
                  </button>
                </div>
              </>
            ) : isGenerating ? (
              <>
                <div className="trip-card-head">
                  <h3>Building your itinerary</h3>
                </div>
                <p className="trip-eyebrow">
                  {isGenerationStale
                    ? "This is taking longer than expected. You can safely try again."
                    : `We're scheduling your days, mapping the routes, and checking the weather in ${city}. This can take a moment.`}
                </p>
                {isGenerationStale && (
                  <div className="plan-summary-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleGenerate}
                      disabled={generate.isPending}
                    >
                      {generate.isPending ? "Retrying…" : "Try again"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="trip-card-head">
                  <h3>Your trip is ready to generate</h3>
                </div>
                <p className="trip-eyebrow">
                  {dateLabel}
                  {days > 0 ? ` · ${days} days` : ""} in {city}
                  {country ? `, ${country}` : ""}. Generate the day-by-day itinerary
                  whenever you're ready.
                </p>
                <div className="plan-summary-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleGenerate}
                    disabled={generate.isPending}
                  >
                    Generate my trip
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
      <TripAssistant key={id} city={city} />
    </div>
  );
}
