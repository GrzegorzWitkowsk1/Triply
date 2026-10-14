import PreferenceFields from "./PreferenceFields";

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
      <PreferenceFields disabled={disabled} tags={tags} onToggleTag={onToggleTag} pace={pace} onPaceChange={onPaceChange} walking={walking} onWalkingChange={onWalkingChange} />
      {error && <p role="alert">{error}</p>}
      {dirty && <div className="pref-actions">
        <button type="button" className="pref-cancel" disabled={disabled} onClick={onCancel}>Cancel</button>
        <button type="button" className="pref-regenerate" disabled={disabled} onClick={onRegenerate}>Regenerate</button>
      </div>}
    </section>
  );
}
