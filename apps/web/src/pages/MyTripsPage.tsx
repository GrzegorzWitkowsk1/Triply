import {
  AccountBalanceWalletOutlined,
  Add,
  ArrowForwardOutlined,
} from "@mui/icons-material";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TripStatus } from "@triply/shared";
import MyTripCard from "../components/trips/MyTripCard";
import { buildTripCards } from "../config/tripCards";
import { TRIP_FILTERS, type TripFilter } from "../config/trips";
import { useTrips } from "../hooks/useTrips";

const FILTER_STATUS: Record<TripFilter, TripStatus | undefined> = {
  "All trips": undefined,
  Ready: "ready",
  Planning: "draft",
};

export default function MyTripsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TripFilter>("All trips");

  const status = FILTER_STATUS[filter];
  const tripsQuery = useTrips(status);

  const trips = useMemo(
    () => buildTripCards(tripsQuery.data ?? []),
    [tripsQuery.data],
  );

  const spendTotal = trips.reduce(
    (total, trip) => total + (trip.budgetUsed ?? 0),
    0,
  );

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
          {tripsQuery.isPending && <p className="my-trips-subtitle">Loading trips…</p>}

          {tripsQuery.isError && (
            <p className="my-trips-subtitle">{tripsQuery.error.message}</p>
          )}
          {tripsQuery.isFetching && !tripsQuery.isPending && (
            <p className="my-trips-subtitle">Refreshing…</p>
          )}

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
                Across {trips.length} upcoming trips
              </span>
            </div>
          </div>
          <div className="spend-total">
            <span className="spend-used">{`€${spendTotal}`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}