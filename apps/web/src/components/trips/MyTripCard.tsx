import {
  ArrowForwardOutlined,
  CalendarMonthOutlined,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { findCityPhoto } from "../../config/cityPhotos";
import type { TripCardModel } from "../../config/tripCards";
import MediaFallback from "./MediaFallback";
import PhotoAttribution from "./PhotoAttribution";

interface MyTripCardProps {
  trip: TripCardModel;
  isFirst: boolean;
}

export default function MyTripCard({ trip, isFirst }: MyTripCardProps) {
  const navigate = useNavigate();
  const photo = findCityPhoto(trip.city, trip.country);

  return (
    <article className="my-trip-card">
      <div className="my-trip-media">
        {photo ? (
          <>
            <img src={photo.imageUrl} alt={`${trip.city}, ${trip.country}`} />
            <PhotoAttribution photo={photo} />
          </>
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