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
import { getTripDetail } from "../config/trip";

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = id ? getTripDetail(id) : undefined;

  const [activeDay, setActiveDay] = useState(0);
  const [activeActivity, setActiveActivity] = useState(0);
  const [tags, setTags] = useState<string[]>(detail?.prefDefaults.tags ?? []);
  const [pace, setPace] = useState(detail?.prefDefaults.pace ?? 1);
  const [walking, setWalking] = useState(detail?.prefDefaults.walking ?? 1);

  useEffect(() => {
    if (!detail) return;
    setActiveDay(0);
    setActiveActivity(0);
    setTags(detail.prefDefaults.tags);
    setPace(detail.prefDefaults.pace);
    setWalking(detail.prefDefaults.walking);
  }, [id, detail]);

  if (!detail) return <Navigate to="/trips" replace />;

  const {
    city,
    country,
    days,
    dateLabel,
    stepsKm,
    weather,
    center,
    dayRoutes,
    tripDays,
    budget,
  } = detail;

  const WeatherIcon = weather.icon;
  const totalActivities = tripDays.reduce((sum, day) => sum + day.activities.length, 0);
  const spent = budget.spent;
  const whole = budget.whole;
  const budgetLevel = spent > whole ? "is-over" : whole - spent <= 50 ? "is-close" : "is-ok";
  const day = tripDays[activeDay];
  const stops = dayRoutes[activeDay] ?? [];

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
              <span className="trip-badge">
                <WeatherIcon /> {weather.temp}° {weather.label}
              </span>
              <span className={`trip-badge is-budget ${budgetLevel}`}>
                <AccountBalanceWalletOutlined /> €{spent} / €{whole}
              </span>
              <span className="trip-badge">
                <PlaceOutlined /> {totalActivities} activities
              </span>
              <span className="trip-badge">
                <DirectionsWalkOutlined /> {stepsKm} km walking
              </span>
            </div>
          </div>
          <div className="trip-hero-actions">
            <button
              type="button"
              className="trip-action"
              onClick={() => navigate(`/trips/${id}/equipment`)}
            >
              <BackpackOutlined /> Equipment
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
              {day.activities.map((activity, i) => (
                <TripActivityCard
                  key={`${i}-${activity.name}`}
                  activity={activity}
                  index={i + 1}
                  selected={activeActivity === i}
                  onSelect={() => setActiveActivity(i)}
                />
              ))}
            </div>
          </div>

          <div className="trip-right">
            <div className="trip-map-wrap">
              <TripMap
                center={center}
                stops={stops}
                active={activeActivity}
                onSelect={setActiveActivity}
              />
              <p className="trip-map-caption">
                Every stop sits within a short walk — less time in transit, more
                time enjoying {city}.
              </p>
            </div>
            <TripBudgetCard
              spent={spent}
              whole={whole}
              breakdown={budget.breakdown}
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