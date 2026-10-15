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
import { useTrips, useDeleteTrip } from "../hooks/useTrips";
import { useGuestUsage } from "../hooks/useGuestUsage";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from "@mui/material";

const FILTER_STATUS: Record<TripFilter, TripStatus | undefined> = {
  "All trips": undefined,
  Ready: "ready",
  Planning: "draft",
};

export default function MyTripsPage() {
  const usage = useGuestUsage();
  const storageBlocked = usage.isGuest && (!usage.data || usage.data.tripCount >= usage.data.tripLimit);
  const deletion = useDeleteTrip();
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
            disabled={storageBlocked}
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
            <div key={trip.id}><MyTripCard trip={trip} isFirst={i === 0} />
              <button type="button" className="auth-link" onClick={() => { deletion.reset(); setDeleteId(trip.id); }} aria-label={`Delete trip ${trip.city}`}>Delete trip</button>
            </div>
          ))}

          <button
            type="button"
            className="empty-trip"
            disabled={storageBlocked}
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
      <Dialog open={deleteId !== null} onClose={() => { if (!deletion.isPending) setDeleteId(null); }} aria-labelledby="delete-trip-title">
        <DialogTitle id="delete-trip-title">Delete this trip?</DialogTitle>
        <DialogContent>This permanently deletes the trip and its public share link. Deletion does not restore AI quota.
          {deletion.error && <p role="alert">{deletion.error.message}</p>}
        </DialogContent>
        <DialogActions><Button disabled={deletion.isPending} onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button color="error" disabled={deletion.isPending} onClick={() => { if (deleteId) deletion.mutate(deleteId, { onSuccess: () => setDeleteId(null) }); }}>{deletion.isPending ? "Deleting…" : "Delete trip"}</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
