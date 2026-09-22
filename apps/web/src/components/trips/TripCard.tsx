import { AccountBalanceWalletOutlined, ArrowForwardOutlined, RouteOutlined } from "@mui/icons-material";
import { isOverBudget, Trip } from "../../config/home";

interface TripCardProps {
  trip: Trip;
  isFirst: boolean;
}

function formatBudget(n: number): string {
  return `€${n}`;
}

export default function TripCard({ trip, isFirst }: TripCardProps) {
  const progress = Math.round((trip.completed / trip.activities) * 100);
  const overBudget = isOverBudget(trip);

  return (
    <article className="trip-card">
      <div className="trip-card-media">
        <img src={trip.image} alt={trip.city} />
        <div className="trip-card-locale">
          <span className="trip-city">{trip.city}</span>
          <span className="trip-locale-sub">
            {trip.country} · {trip.days} days
          </span>
        </div>
      </div>

      <div className="trip-card-body">
        <div className="trip-row">
          <span className="trip-date">{trip.dateLabel}</span>
          <span className="trip-budget">
            {formatBudget(trip.budgetUsed)}/{formatBudget(trip.budgetExpected)}
          </span>
        </div>

        <div className="trip-row">
          <span className="trip-activities">
            <RouteOutlined className="trip-route" fontSize="small" />
            {trip.activities} activities
          </span>
          <span className="trip-status">
            <AccountBalanceWalletOutlined
              fontSize="small"
              sx={{ color: overBudget ? "#e5484d" : "#43b047" }}
            />
            {overBudget ? "over budget" : "On budget"}
          </span>
        </div>

        <div className="trip-progress">
          <div className="trip-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <button
          type="button"
          className={`trip-btn${isFirst ? " is-contained" : ""}`}
        >
          View trip
          <ArrowForwardOutlined fontSize="small" />
        </button>
      </div>
    </article>
  );
}