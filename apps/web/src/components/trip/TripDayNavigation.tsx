import { useEffect, useRef } from "react";
import { ChevronLeftOutlined, ChevronRightOutlined } from "@mui/icons-material";
import { isIsoDate, type ItineraryDay } from "@triply/shared";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { formatDate } from "../../i18n/format";

export default function TripDayNavigation({ days, active, disabled, onSelect }: {
  days: ItineraryDay[]; active: number; disabled: boolean; onSelect: (index: number) => void;
}) {
  useTranslation();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { tabs.current[active]?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" }); }, [active]);
  if (!days.length) return null;
  function choose(index: number) { if (!disabled) { onSelect(index); tabs.current[index]?.focus(); } }
  return <div className="trip-day-navigation">
    <div className="trip-day-header">
      <h2 className="trip-day-label" id="trip-day-heading">{i18n.t("dayPosition", { ns: "common", day: active + 1, total: days.length })}</h2>
      <div className="trip-day-nav">
        <button type="button" aria-label={i18n.t("previousDay", { ns: "common" })} disabled={disabled || active === 0} onClick={() => choose(active - 1)}><ChevronLeftOutlined /></button>
        <button type="button" aria-label={i18n.t("nextDay", { ns: "common" })} disabled={disabled || active === days.length - 1} onClick={() => choose(active + 1)}><ChevronRightOutlined /></button>
      </div>
    </div>
    <div className="trip-day-tabs" role="tablist" aria-label={i18n.t("dayNavigation", { ns: "trips/details" })}>
      {days.map((day, index) => <button key={day.dayIndex} ref={node => { tabs.current[index] = node; }}
        type="button" role="tab" id={`trip-day-tab-${day.dayIndex}`} aria-controls="trip-day-panel"
        aria-selected={index === active} tabIndex={index === active ? 0 : -1} disabled={disabled}
        onClick={() => onSelect(index)} onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % days.length : event.key === "ArrowLeft" ? (index - 1 + days.length) % days.length : event.key === "Home" ? 0 : event.key === "End" ? days.length - 1 : null;
          if (next !== null) { event.preventDefault(); choose(next); }
        }}>
        <span>{i18n.t("dayLabel", { ns: "common", day: day.dayIndex })}</span>
        {isIsoDate(day.date) && <small>{formatDate(day.date, { month: "short", day: "numeric", timeZone: "UTC" })}</small>}
      </button>)}
    </div>
  </div>;
}
