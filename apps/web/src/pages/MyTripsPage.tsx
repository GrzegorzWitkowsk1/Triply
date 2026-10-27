import { errorMessage as localizedError } from "../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
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
  const { t } = useTranslation("trips", { i18n });
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
    [tripsQuery.data, i18n.resolvedLanguage],
  );

  const spendTotal = trips.reduce(
    (total, trip) => total + (trip.budgetUsed ?? 0),
    0,
  );

  return (
    <div className="my-trips-page">
      <div className="my-trips-inner">
        <p className="my-trips-eyebrow">{t("eyebrow")}</p>

        <div className="my-trips-head">
          <div>
            <h1 className="my-trips-title">{t("title")}</h1>
            <p className="my-trips-subtitle">
              {i18n.t("pickUpWhereYouLeftOffOrStart", { ns: "trips" })}</p>
          </div>
          <button
            type="button"
            className="btn btn-primary my-trips-add-btn"
            disabled={storageBlocked}
            onClick={() => navigate("/home", { state: { focusPrompt: true } })}
          >
            <Add fontSize="small" />
            {t("planNew")}
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
          {tripsQuery.isPending && <p className="my-trips-subtitle">{i18n.t("loadingTrips", { ns: "trips" })}</p>}

          {tripsQuery.isError && (
            <p className="my-trips-subtitle">{localizedError(tripsQuery.error)}</p>
          )}
          {tripsQuery.isFetching && !tripsQuery.isPending && (
            <p className="my-trips-subtitle">{i18n.t("refreshing", { ns: "trips" })}</p>
          )}

          {trips.map((trip, i) => (
            <div key={trip.id}><MyTripCard trip={trip} isFirst={i === 0} />
              <button type="button" className="auth-link" onClick={() => { deletion.reset(); setDeleteId(trip.id); }} aria-label={i18n.t("deleteTrip2", { ns: "trips", value0: trip.city })}>{i18n.t("deleteTrip", { ns: "trips" })}</button>
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
            <span className="empty-trip-title">{t("planNew")}</span>
            <span className="empty-trip-desc">
              {i18n.t("describeWhereYouReGoingAndTriplyBuilds", { ns: "trips" })}</span>
          </button>
        </div>

        <div className="spend-card">
          <div className="spend-card-left">
            <span className="spend-icon">
              <AccountBalanceWalletOutlined />
            </span>
            <div className="spend-copy">
              <span className="spend-title">{i18n.t("totalPlannedSpend", { ns: "trips" })}</span>
              <span className="spend-sub">
                {i18n.t("upcomingCount", { ns: "trips", count: trips.length })}
              </span>
            </div>
          </div>
          <div className="spend-total">
            <span className="spend-used">{`€${spendTotal}`}</span>
          </div>
        </div>
      </div>
      <Dialog open={deleteId !== null} onClose={() => { if (!deletion.isPending) setDeleteId(null); }} aria-labelledby="delete-trip-title">
        <DialogTitle id="delete-trip-title">{i18n.t("deleteThisTrip", { ns: "trips" })}</DialogTitle>
        <DialogContent>{i18n.t("thisPermanentlyDeletesTheTripAndItsPublic", { ns: "trips" })}{deletion.error && <p role="alert">{localizedError(deletion.error)}</p>}
        </DialogContent>
        <DialogActions><Button disabled={deletion.isPending} onClick={() => setDeleteId(null)}>{t("cancel", { ns: "common" })}</Button>
          <Button color="error" disabled={deletion.isPending} onClick={() => { if (deleteId) deletion.mutate(deleteId, { onSuccess: () => setDeleteId(null) }); }}>{deletion.isPending ? i18n.t("deleting", { ns: "trips" }) : i18n.t("deleteTrip", { ns: "trips" })}</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
