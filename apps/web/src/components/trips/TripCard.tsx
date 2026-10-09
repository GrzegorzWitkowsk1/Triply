import { AccountBalanceWalletOutlined, ArrowForwardOutlined, RouteOutlined } from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { findCityPhoto } from "../../config/cityPhotos";
import type { HomeTripCardModel } from "../../config/tripCards";
import MediaFallback from "./MediaFallback";
import PhotoAttribution from "./PhotoAttribution";

interface TripCardProps {
  trip: HomeTripCardModel;
  isFirst: boolean;
}

function formatBudget(n: number): string {
  return `€${n}`;
}

export default function TripCard({ trip, isFirst }: TripCardProps) {
  const navigate = useNavigate();
  const photo = findCityPhoto(trip.city, trip.country);

  const hasProgress =
    trip.activities !== undefined &&
    trip.completed !== undefined &&
    trip.activities > 0;
  const hasBudgetRatio =
    trip.budgetUsed !== null && trip.budgetExpected !== undefined;
  const progress = hasProgress
    ? Math.round(((trip.completed as number) / (trip.activities as number)) * 100)
    : 0;
  const overBudget = hasBudgetRatio && (trip.budgetUsed as number) > (trip.budgetExpected as number);

  return (
    <article className="trip-card">
      <div className="trip-card-media">
        {photo ? (
          <>
            <img src={photo.imageUrl} alt={`${trip.city}, ${trip.country}`} />
            <PhotoAttribution photo={photo} />
          </>
        ) : (
          <MediaFallback alt={`${trip.city}, ${trip.country}`} />
        )}
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
          {trip.budgetUsed !== null && (
            <span className="trip-budget">
              {formatBudget(trip.budgetUsed)}
              {hasBudgetRatio && `/${formatBudget(trip.budgetExpected as number)}`}
            </span>
          )}
        </div>

        {(hasProgress || hasBudgetRatio) && (
          <div className="trip-row">
            {hasProgress && (
              <span className="trip-activities">
                <RouteOutlined className="trip-route" fontSize="small" />
                {trip.activities} activities
              </span>
            )}
            {hasBudgetRatio && (
              <span className="trip-status">
                <AccountBalanceWalletOutlined
                  fontSize="small"
                  sx={{ color: overBudget ? "#e5484d" : "#43b047" }}
                />
                {overBudget ? "over budget" : "On budget"}
              </span>
            )}
          </div>
        )}

        {hasProgress && (
          <div className="trip-progress">
            <div className="trip-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}

        <button
          onClick={() => navigate(`/trips/${trip.id}`)}
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
