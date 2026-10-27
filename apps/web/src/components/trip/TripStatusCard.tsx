import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { ExploreOutlined, RefreshOutlined } from "@mui/icons-material";

interface TripStatusCardProps {
  title: string;
  message: string;
  isError?: boolean;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  onBack: () => void;
  onEdit?: () => void;
  hasSavedDetails?: boolean;
}

export default function TripStatusCard({
  title, message, isError = false, actionLabel, onAction, disabled, onBack, onEdit, hasSavedDetails = false,
}: TripStatusCardProps) {
  useTranslation();
  return (
    <section className={`trip-state-card${isError ? " is-error" : ""}`} role={isError ? "alert" : undefined}>
      <div className="trip-state-icon" aria-hidden="true"><ExploreOutlined /></div>
      <p className="trip-build-kicker">{isError ? i18n.t("aSmallDetour", { ns: "trips/details" }) : i18n.t("yourNextAdventure", { ns: "trips/details" })}</p>
      <h2>{title}</h2>
      <p className="trip-state-message">{message}</p>
      {isError && hasSavedDetails && <p className="trip-state-note">{i18n.t("yourTripDetailsAreSafeYouCanPick", { ns: "trips/details" })}</p>}
      <div className="trip-state-actions">
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={onAction}>
          {isError && <RefreshOutlined />} {actionLabel}
        </button>
        {onEdit && <button type="button" className="btn trip-state-secondary" onClick={onEdit}>{i18n.t("adjustTripDetails", { ns: "trips/details" })}</button>}
      </div>
      <button type="button" className="trip-state-back" onClick={onBack}>{i18n.t("backToMyTrips", { ns: "trips/details" })}</button>
    </section>
  );
}
