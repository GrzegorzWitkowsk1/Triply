import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { paceLabel } from "../../i18n/labels";
import { PACE_OPTIONS, PREF_OPTIONS, WALKING_OPTIONS } from "../../config/trip";
interface PreferenceFieldsProps {
  showInterests?: boolean;
  disabled: boolean;
  tags: string[];
  onToggleTag: (id: string) => void;
  pace: number;
  onPaceChange: (index: number) => void;
  walking: number;
  onWalkingChange: (index: number) => void;
}
export default function PreferenceFields({ showInterests = true, disabled, tags, onToggleTag, pace, onPaceChange, walking, onWalkingChange }: PreferenceFieldsProps) {
  useTranslation();
  return <>
      {showInterests && <div className="pref-tags">
        {PREF_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = tags.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected} className={`pref-tag${selected ? " is-active" : ""}`}
              onClick={() => onToggleTag(option.id)}
            >
              <Icon />
              {option.label}
            </button>
          );
        })}
      </div>}
      <div className="pref-slider">
        <span className="pref-slider-title">{i18n.t("paceTitle", { ns: "tripCreator/preferences" })}</span>
        <div className="pref-slider-options">
          {PACE_OPTIONS.map((option, i) => (
            <button
              key={paceLabel(["relaxed", "balanced", "packed"][i])}
              type="button"
              disabled={disabled}
              aria-pressed={pace === i} className={`pref-slider-option${pace === i ? " is-active" : ""}`}
              onClick={() => onPaceChange(i)}
            >
              {paceLabel(["relaxed", "balanced", "packed"][i])}
            </button>
          ))}
        </div>
      </div>
      <div className="pref-slider">
        <span className="pref-slider-title">{i18n.t("walkingTitle", { ns: "tripCreator/preferences" })}</span>
        <div className="pref-slider-options">
          {WALKING_OPTIONS.map((option, i) => (
            <button
              key={i18n.t(`walking_${i}`, { ns: "tripCreator/preferences" })}
              type="button"
              disabled={disabled}
              aria-pressed={walking === i} className={`pref-slider-option${walking === i ? " is-active" : ""}`}
              onClick={() => onWalkingChange(i)}
            >
              {i18n.t(`walking_${i}`, { ns: "tripCreator/preferences" })}
            </button>
          ))}
        </div>
      </div>
</>;
}

