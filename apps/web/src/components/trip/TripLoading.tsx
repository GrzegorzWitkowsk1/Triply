import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
interface TripLoadingProps {
  city?: string;
  isStale?: boolean;
  onRetry?: () => void;
}

export default function TripLoading({ city, isStale = false, onRetry }: TripLoadingProps) {
  useTranslation();
  return (
    <div className="trip-loading" aria-busy="true" aria-label={i18n.t("preparingYourItinerary", { ns: "trips/details" })}>
      <section className="trip-build-banner" role="status" aria-live="polite">
        <svg className="trip-build-route" viewBox="0 0 120 64" fill="none" aria-hidden="true">
          <path className="trip-build-path" d="M14 46C30 46 24 18 49 18S70 46 106 18" />
          <circle cx="14" cy="46" r="6" />
          <circle cx="49" cy="18" r="6" />
          <circle cx="106" cy="18" r="6" />
          <circle className="trip-build-traveler" r="4" />
        </svg>
        <div>
          <p className="trip-build-kicker">{i18n.t("aLittlePlanningAGreatAdventure", { ns: "trips/details" })}</p>
          <h2>{city ? i18n.t("yourTripIsTakingShape", { ns: "trips/details", value0: city }) : i18n.t("gettingYourTripReady", { ns: "trips/details" })}</h2>
          <p>{isStale
            ? i18n.t("thisIsTakingLongerThanUsualYouCan", { ns: "trips/details" })
            : i18n.t("findingPlacesConnectingTheDotsAndMakingRoom", { ns: "trips/details" })}</p>
        </div>
        {isStale && onRetry && (
          <button className="btn btn-primary" type="button" onClick={onRetry}>{i18n.t("tryAgain", { ns: "common" })}</button>
        )}
      </section>
      <div className="trip-content trip-loading-content" aria-hidden="true">
        <div className="trip-left">
          <div className="trip-skeleton-day">
            <span className="trip-skeleton trip-skeleton-label" />
            <span className="trip-skeleton trip-skeleton-controls" />
          </div>
          <div className="trip-skeleton-timeline">
            {[0, 1, 2, 3].map((index) => (
              <div className="trip-skeleton-stop" key={index}>
                <span className="trip-skeleton trip-skeleton-dot" />
                <div className="trip-skeleton-activity">
                  <span className="trip-skeleton trip-skeleton-time" />
                  <span className="trip-skeleton trip-skeleton-title" />
                  <span className="trip-skeleton trip-skeleton-description" />
                  <div className="trip-skeleton-tags">
                    <span className="trip-skeleton" /><span className="trip-skeleton" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="trip-right">
          <div className="trip-skeleton trip-skeleton-map">
            <svg viewBox="0 0 320 230" fill="none">
              <path className="trip-skeleton-street" d="M-20 55L340 145M-20 180L340 45M55-20L120 260M210-20L180 260" />
              <path className="trip-skeleton-map-route" d="M65 160C95 160 95 90 155 90S195 145 255 65" />
              <circle cx="65" cy="160" r="8" /><circle cx="155" cy="90" r="8" /><circle cx="255" cy="65" r="8" />
            </svg>
          </div>
          <div className="trip-skeleton-panel">
            <span className="trip-skeleton trip-skeleton-title" />
            <span className="trip-skeleton trip-skeleton-description" />
            <span className="trip-skeleton trip-skeleton-description" />
          </div>
        </div>
      </div>
    </div>
  );
}
