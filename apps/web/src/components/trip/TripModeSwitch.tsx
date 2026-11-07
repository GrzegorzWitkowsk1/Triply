import { useRef } from "react";
import { useTranslation } from "react-i18next";

export type TripMode = "plan" | "journey";
export default function TripModeSwitch({ value, disabled, onChange }: { value: TripMode; disabled?: boolean; onChange: (value: TripMode) => void }) {
  const { t } = useTranslation("itinerary/journey");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return <div className="trip-mode-switch" role="group" aria-label={t("tripMode")}>
    {(["plan", "journey"] as const).map((mode, index) => <button key={mode} ref={node => { buttons.current[index] = node; }}
      type="button" disabled={disabled} aria-pressed={value === mode} aria-label={t(`${mode}Mode`)} onClick={() => onChange(mode)}
      onKeyDown={event => {
        const next = event.key === "ArrowLeft" || event.key === "ArrowRight" ? 1 - index : event.key === "Home" ? 0 : event.key === "End" ? 1 : null;
        if (next !== null) { event.preventDefault(); onChange(next === 0 ? "plan" : "journey"); buttons.current[next]?.focus(); }
      }}>{t(mode)}</button>)}
  </div>;
}
