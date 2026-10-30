import { formatCurrency, formatNumber } from "../../i18n/format";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import {
  ArrowForwardOutlined,
  CalendarMonthOutlined,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { findCityPhoto } from "../../config/cityPhotos";
import type { TripCardModel } from "../../config/tripCards";
import MediaFallback from "./MediaFallback";
import DestinationImage from "../DestinationImage";

interface MyTripCardProps {
  trip: TripCardModel;
  isFirst: boolean;
}

export default function MyTripCard({ trip, isFirst }: MyTripCardProps) {
  useTranslation();
  const navigate = useNavigate();
  const photo = findCityPhoto(trip.city, trip.country);

  return (
    <article className="my-trip-card">
      <div className="my-trip-media">
        {photo ? (
          <DestinationImage photo={photo} />
        ) : (
          <MediaFallback alt={`${trip.city}, ${trip.country}`} />
        )}
      </div>
      <div className="my-trip-body">
        <div className="trip-row">
          <div className="my-trip-title">
            <span className="my-trip-city">{trip.city}</span>
            {trip.country && (
              <span className="my-trip-locale-sub">
                {trip.country} · {i18n.t("days", { ns: "common", count: trip.days })}
              </span>
            )}
          </div>
          <span className={`trip-status-badge is-${trip.status.toLowerCase()}`}>
            {i18n.t(trip.status === "Ready" ? "statusReady" : trip.status === "Failed" ? "statusFailed" : "statusPlanning", { ns: "trips" })}
          </span>
        </div>

        <div className="trip-row">
          <span className="my-trip-date">
            <CalendarMonthOutlined fontSize="small" />
            {trip.dateLabel}
          </span>
          {trip.budgetUsed !== null && (
            <span className="my-trip-budget">{trip.currency ? formatCurrency(trip.budgetUsed, trip.currency, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : formatNumber(trip.budgetUsed)}</span>
          )}
        </div>

        <button
          type="button"
          className={`trip-btn my-trip-btn${isFirst ? " is-contained" : ""}`}
          onClick={() => navigate(`/trips/${trip.id}`)}
        >
          {i18n.t("viewTrip", { ns: "trips" })}<ArrowForwardOutlined fontSize="small" />
        </button>
      </div>
    </article>
  );
}
