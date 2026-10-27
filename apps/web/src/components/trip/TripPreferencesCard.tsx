import { resolveMessage } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
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
  useTranslation();
  return (
    <section className="trip-card pref-card">
      <div className="trip-card-head">
        <h3>{i18n.t("preferences", { ns: "trips/details" })}</h3>
      </div>
      <PreferenceFields disabled={disabled} tags={tags} onToggleTag={onToggleTag} pace={pace} onPaceChange={onPaceChange} walking={walking} onWalkingChange={onWalkingChange} />
      {error && <p role="alert">{resolveMessage(error)}</p>}
      {dirty && <div className="pref-actions">
        <button type="button" className="pref-cancel" disabled={disabled} onClick={onCancel}>{i18n.t("cancel", { ns: "common" })}</button>
        <button type="button" className="pref-regenerate" disabled={disabled} onClick={onRegenerate}>{i18n.t("regenerate", { ns: "trips/details" })}</button>
      </div>}
    </section>
  );
}
