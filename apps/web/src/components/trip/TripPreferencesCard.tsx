import {
  PACE_OPTIONS,
  PREF_OPTIONS,
  WALKING_OPTIONS,
} from "../../config/trip";

interface TripPreferencesCardProps {
  dirty: boolean;
  disabled: boolean;
  error: string | null;
  onCancel: () => void;
  onRegenerate: () => void;
  tags: string[];
  onToggleTag: (id: string) => void;
  pace: number;
  onPaceChange: (index: number) => void;
  walking: number;
  onWalkingChange: (index: number) => void;
}

export default function TripPreferencesCard({
  dirty, disabled, error, onCancel, onRegenerate,
  tags,
  onToggleTag,
  pace,
  onPaceChange,
  walking,
  onWalkingChange,
}: TripPreferencesCardProps) {
  return (
    <section className="trip-card pref-card">
      <div className="trip-card-head">
        <h3>Preferences</h3>
      </div>
      <div className="pref-tags">
        {PREF_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = tags.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              className={`pref-tag${selected ? " is-active" : ""}`}
              onClick={() => onToggleTag(option.id)}
            >
              <Icon />
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="pref-slider">
        <span className="pref-slider-title">Travel pace</span>
        <div className="pref-slider-options">
          {PACE_OPTIONS.map((option, i) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              className={`pref-slider-option${pace === i ? " is-active" : ""}`}
              onClick={() => onPaceChange(i)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="pref-slider">
        <span className="pref-slider-title">Walking tolerance</span>
        <div className="pref-slider-options">
          {WALKING_OPTIONS.map((option, i) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              className={`pref-slider-option${walking === i ? " is-active" : ""}`}
              onClick={() => onWalkingChange(i)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {dirty && <div className="pref-actions">
        <button type="button" className="pref-cancel" disabled={disabled} onClick={onCancel}>Cancel</button>
        <button type="button" className="pref-regenerate" disabled={disabled} onClick={onRegenerate}>Regenerate</button>
      </div>}
    </section>
  );
}
