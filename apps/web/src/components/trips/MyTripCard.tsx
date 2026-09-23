import {
  ArrowForwardOutlined,
  CalendarMonthOutlined,
  DirectionsWalkOutlined,
  RouteOutlined,
  ScheduleOutlined,
} from "@mui/icons-material";
import { TripsPageTrip } from "../../config/trips";

function formatBudget(n: number): string {
  return `€${n}`;
}

interface MyTripCardProps {
  trip: TripsPageTrip;
  isFirst: boolean;
}

export default function MyTripCard({ trip, isFirst }: MyTripCardProps) {
  const progress = Math.round((trip.completed / trip.activities) * 100);
  const planActivities = trip.planActivities.slice(0, 3);
  const hasMore = trip.planActivities.length > 3;

  return (
    <article className="my-trip-card">
      <div className="my-trip-media">
        <img src={trip.image} alt={trip.city} />
        <div className="my-trip-locale">
          <div className="my-trip-locale-row">
            <div className="my-trip-title">
              <span className="my-trip-city">{trip.city}</span>
              <span className="my-trip-locale-sub">
                {trip.country} · {trip.days} days
              </span>
            </div>
            <span
              className={`trip-status-badge is-${trip.status.toLowerCase()}`}
            >
              {trip.status}
            </span>
          </div>
        </div>
      </div>

      <div className="my-trip-body">
        <div className="trip-row">
          <span className="my-trip-date">
            <CalendarMonthOutlined fontSize="small" />
            {trip.dateLabel}
          </span>
          <span className="my-trip-budget">
            {formatBudget(trip.budgetUsed)} / {formatBudget(trip.budgetExpected)}
          </span>
        </div>

        <div className="my-trip-stats">
          <span className="my-trip-stat">
            <RouteOutlined className="my-trip-route" />
            {trip.activities} stops
          </span>
          <span className="my-trip-stat">
            <DirectionsWalkOutlined />
            {trip.distanceKm} km
          </span>
          <span className="my-trip-stat">
            <ScheduleOutlined />
            {trip.dayLabel}
          </span>
        </div>

        <div className="my-trip-progress-head">
          <span className="my-trip-progress-label">Planned</span>
          <span className="my-trip-progress-value">{progress}%</span>
        </div>
        <div className="trip-progress">
          <div className="trip-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="my-trip-plan">
          <span className="my-trip-plan-title">{trip.dayLabel} plan</span>
          <ul className="my-trip-plan-list">
            {planActivities.map((activity) => (
              <li key={activity}>
                <span className="my-trip-plan-dot" />
                {activity}
              </li>
            ))}
            {hasMore && (
              <li>
                <span className="my-trip-plan-dot" />
                ...
              </li>
            )}
          </ul>
        </div>

        <button
          type="button"
          className={`trip-btn my-trip-btn${isFirst ? " is-contained" : ""}`}
        >
          View trip
          <ArrowForwardOutlined fontSize="small" />
        </button>
      </div>
    </article>
  );
}