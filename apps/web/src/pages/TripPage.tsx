import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
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
import { useNavigate } from "react-router-dom";
import TripActivityCard from "../components/trip/TripActivityCard";
import TripAssistant from "../components/trip/TripAssistant";
import TripBudgetCard from "../components/trip/TripBudgetCard";
import TripMap from "../components/trip/TripMap";
import TripPreferencesCard from "../components/trip/TripPreferencesCard";
import { EMPTY_BUDGET_BREAKDOWN, findTripDetailByKey } from "../config/trip";
import { useTrip } from "../hooks/useTrips";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const trip = useTrip(id);

  const analysis = trip.data?.analysis;
  const fixture = findTripDetailByKey(trip.data?.fixtureKey ?? null);

  const [activeDay, setActiveDay] = useState(0);
  const [activeActivity, setActiveActivity] = useState(0);
  const [tags, setTags] = useState<string[]>(fixture?.prefDefaults.tags ?? []);
  const [pace, setPace] = useState(fixture?.prefDefaults.pace ?? 1);
  const [walking, setWalking] = useState(fixture?.prefDefaults.walking ?? 1);

  useEffect(() => {
    if (!fixture) return;
    setActiveDay(0);
    setActiveActivity(0);
    setTags(fixture.prefDefaults.tags);
    setPace(fixture.prefDefaults.pace);
    setWalking(fixture.prefDefaults.walking);
  }, [id, fixture]);

  if (trip.isPending) {
    return (
      <div className="trip-page">
        <div className="trip-inner">
          <p className="trip-eyebrow">Loading trip…</p>
        </div>
      </div>
    );
  }

  if (trip.isError || !trip.data) {
    return <Navigate to="/trips" replace />;
  }

  const city = analysis?.destination ?? fixture?.city ?? "Untitled trip";
  const country = analysis?.country ?? fixture?.country ?? "";
  const days = analysis?.durationDays ?? fixture?.days ?? 0;
  const dateLabel = formatRange(analysis?.startDate ?? null, analysis?.endDate ?? null);

  const weather = fixture?.weather ?? null;
  const stepsKm = fixture?.stepsKm ?? null;
  const center =
    analysis?.location ??
    (fixture ? { lat: fixture.center[0], lng: fixture.center[1] } : null);
  const tripDays = fixture?.tripDays ?? [];
  const dayRoutes = fixture?.dayRoutes ?? [];
  const budgetSpent = fixture?.budget.spent ?? analysis?.budget.amount ?? 0;
  const budgetWhole = fixture?.budget.whole ?? analysis?.budget.amount ?? 0;

  const WeatherIcon = weather?.icon ?? null;
  const totalActivities = tripDays.reduce((sum, day) => sum + day.activities.length, 0);
  const spent = budgetSpent;
  const whole = budgetWhole;
  const budgetLevel = spent > whole ? "is-over" : whole - spent <= 50 ? "is-close" : "is-ok";
  const day = tripDays[activeDay];
  const stops = center && dayRoutes[activeDay]
    ? dayRoutes[activeDay].map(([lat, lng]) => [lat, lng] as [number, number])
    : [];

  const toggleTag = (tagId: string) => {
    setTags((current) =>
      current.includes(tagId)
        ? current.filter((tag) => tag !== tagId)
        : [...current, tagId]
    );
  };

  return (
    <div className="trip-page">
      <div className="trip-inner">
        <section className="trip-hero">
          <div className="trip-hero-locale">
            <p className="trip-eyebrow">Your itinerary</p>
            <h1>
              {city}, {country}
            </h1>
            <p className="trip-hero-sub">
              {dateLabel} · {days} days
            </p>
            <div className="trip-hero-badges">
              {WeatherIcon && weather && (
                <span className="trip-badge">
                  <WeatherIcon /> {weather.temp}° {weather.label}
                </span>
              )}
              <span className={`trip-badge is-budget ${budgetLevel}`}>
                <AccountBalanceWalletOutlined /> €{spent} / €{whole}
              </span>
              <span className="trip-badge">
                <PlaceOutlined /> {totalActivities} activities
              </span>
              {stepsKm !== null && (
                <span className="trip-badge">
                  <DirectionsWalkOutlined /> {stepsKm} km walking
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
            <button type="button" className="trip-action">
              <EditOutlined /> Edit
            </button>
            <button type="button" className="trip-action">
              <ShareOutlined /> Share
            </button>
            <button type="button" className="trip-action is-primary">
              <AutoFixHighOutlined /> Optimize
            </button>
          </div>
        </section>

        <div className="trip-content">
          <div className="trip-left">
            <div className="trip-day-header">
              <span className="trip-day-label">
                Day {activeDay + 1} of {days}
              </span>
              <div className="trip-day-nav">
                <button
                  type="button"
                  aria-label="Previous day"
                  disabled={activeDay === 0}
                  onClick={() => {
                    setActiveDay((dayIndex) => Math.max(0, dayIndex - 1));
                    setActiveActivity(0);
                  }}
                >
                  <ChevronLeftOutlined />
                </button>
                <button
                  type="button"
                  aria-label="Next day"
                  disabled={activeDay === dayRoutes.length - 1}
                  onClick={() => {
                    setActiveDay((dayIndex) =>
                      Math.min(dayRoutes.length - 1, dayIndex + 1)
                    );
                    setActiveActivity(0);
                  }}
                >
                  <ChevronRightOutlined />
                </button>
              </div>
            </div>
            <div className="trip-activity-list">
              {day?.activities.map((activity, i) => (
                <TripActivityCard
                  key={`${i}-${activity.name}`}
                  activity={activity}
                  index={i + 1}
                  selected={activeActivity === i}
                  onSelect={() => setActiveActivity(i)}
                />
              ))}
              {!day && (
                <p className="trip-eyebrow">
                  The itinerary for this trip has not been generated yet.
                </p>
              )}
            </div>
          </div>

          <div className="trip-right">
            {center && (
              <div className="trip-map-wrap">
                <TripMap
                  center={[center.lat, center.lng]}
                  stops={stops}
                  active={activeActivity}
                  onSelect={setActiveActivity}
                />
                <p className="trip-map-caption">
                  Every stop sits within a short walk — less time in transit, more
                  time enjoying {city}.
                </p>
              </div>
            )}
            <TripBudgetCard
              spent={spent}
              whole={whole}
              breakdown={fixture?.budget.breakdown ?? EMPTY_BUDGET_BREAKDOWN}
            />
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
      </div>
      <TripAssistant key={id} city={city} />
    </div>
  );
}