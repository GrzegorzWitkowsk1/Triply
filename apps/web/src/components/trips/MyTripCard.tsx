import {
  ArrowForwardOutlined,
  CalendarMonthOutlined,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import type { TripCardModel } from "../../config/tripCards";

interface MyTripCardProps {
  trip: TripCardModel;
  isFirst: boolean;
}

export default function MyTripCard({ trip, isFirst }: MyTripCardProps) {
  const navigate = useNavigate();

  return (
    <article className="my-trip-card">
      <div className="my-trip-body">
        <div className="trip-row">
          <div className="my-trip-title">
            <span className="my-trip-city">{trip.city}</span>
            {trip.country && (
              <span className="my-trip-locale-sub">
                {trip.country} · {trip.days} days
              </span>
            )}
          </div>
          <span className={`trip-status-badge is-${trip.status.toLowerCase()}`}>
            {trip.status}
          </span>
        </div>

        <div className="trip-row">
          <span className="my-trip-date">
            <CalendarMonthOutlined fontSize="small" />
            {trip.dateLabel}
          </span>
          {trip.budgetUsed !== null && (
            <span className="my-trip-budget">{`€${trip.budgetUsed}`}</span>
          )}
        </div>

        <button
          type="button"
          className={`trip-btn my-trip-btn${isFirst ? " is-contained" : ""}`}
          onClick={() => navigate(`/trips/${trip.id}`)}
        >
          View trip
          <ArrowForwardOutlined fontSize="small" />
        </button>
      </div>
    </article>
  );
}