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
        <span className="pref-slider-title">Travel pace</span>
        <div className="pref-slider-options">
          {PACE_OPTIONS.map((option, i) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              aria-pressed={pace === i} className={`pref-slider-option${pace === i ? " is-active" : ""}`}
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
              aria-pressed={walking === i} className={`pref-slider-option${walking === i ? " is-active" : ""}`}
              onClick={() => onWalkingChange(i)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
</>;
}

