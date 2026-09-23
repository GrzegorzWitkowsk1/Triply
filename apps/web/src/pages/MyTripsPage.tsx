import {
  AccountBalanceWalletOutlined,
  Add,
  ArrowForwardOutlined,
} from "@mui/icons-material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import MyTripCard from "../components/trips/MyTripCard";
import {
  TRIP_FILTERS,
  TRIPS_LIST,
  TRIP_SUMMARY,
  type TripFilter,
} from "../config/trips";

export default function MyTripsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TripFilter>("All trips");

  const trips =
    filter === "All trips"
      ? TRIPS_LIST
      : TRIPS_LIST.filter((trip) => trip.status === filter);

  return (
    <div className="my-trips-page">
      <div className="my-trips-inner">
        <p className="my-trips-eyebrow">Your adventures</p>

        <div className="my-trips-head">
          <div>
            <h1 className="my-trips-title">My trips</h1>
            <p className="my-trips-subtitle">
              Pick up where you left off, or start something new.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary my-trips-add-btn"
            onClick={() => navigate("/home", { state: { focusPrompt: true } })}
          >
            <Add fontSize="small" />
            Plan a new trip
          </button>
        </div>

        <div className="trip-filters">
          {TRIP_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`trip-filter${filter === f ? " is-active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="my-trips-grid">
          {trips.map((trip, i) => (
            <MyTripCard key={trip.id} trip={trip} isFirst={i === 0} />
          ))}

          <button
            type="button"
            className="empty-trip"
            onClick={() => navigate("/home", { state: { focusPrompt: true } })}
          >
            <span className="empty-trip-icon">
              <Add />
            </span>
            <span className="empty-trip-title">Plan a new trip</span>
            <span className="empty-trip-desc">
              Describe where you're going and Triply builds the whole itinerary.
            </span>
          </button>
        </div>

        <div className="spend-card">
          <div className="spend-card-left">
            <span className="spend-icon">
              <AccountBalanceWalletOutlined />
            </span>
            <div className="spend-copy">
              <span className="spend-title">Total planned spend</span>
              <span className="spend-sub">
                Across {TRIP_SUMMARY.upcoming} upcoming trips
              </span>
            </div>
          </div>
          <div className="spend-total">
            <span className="spend-used">{`€${TRIP_SUMMARY.spent}`} / </span>
            <span className="spend-whole">{`€${TRIP_SUMMARY.whole}`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}