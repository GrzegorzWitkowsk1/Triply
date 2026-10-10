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
  return (
    <section className={`trip-state-card${isError ? " is-error" : ""}`} role={isError ? "alert" : undefined}>
      <div className="trip-state-icon" aria-hidden="true"><ExploreOutlined /></div>
      <p className="trip-build-kicker">{isError ? "A small detour" : "Your next adventure"}</p>
      <h2>{title}</h2>
      <p className="trip-state-message">{message}</p>
      {isError && hasSavedDetails && <p className="trip-state-note">Your trip details are safe. You can pick up right where you left off.</p>}
      <div className="trip-state-actions">
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={onAction}>
          {isError && <RefreshOutlined />} {actionLabel}
        </button>
        {onEdit && <button type="button" className="btn trip-state-secondary" onClick={onEdit}>Adjust trip details</button>}
      </div>
      <button type="button" className="trip-state-back" onClick={onBack}>Back to my trips</button>
    </section>
  );
}
