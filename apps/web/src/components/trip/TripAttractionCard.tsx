import { categoryLabel, localizedAdmission } from "../../i18n/labels";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { ScheduleOutlined } from "@mui/icons-material";
import { admissionLabel } from "@triply/shared";
import type { TimelineAttraction } from "../../config/itineraryAdapters";
import { formatDuration } from "../../config/itineraryAdapters";

interface TripAttractionCardProps {
  entry: TimelineAttraction;
  selected: boolean;
  onSelect: (stopIndex: number) => void;
}

export default function TripAttractionCard({
  entry,
  selected,
  onSelect,
}: TripAttractionCardProps) {
  useTranslation();
  const check = entry.openingHoursCheck;
  const knownIntervals = check?.intervals.filter(interval => !interval.unknown) ?? [];
  const allDay = knownIntervals.some(interval => interval.start.slice(11, 16) === "00:00"
    && interval.end.slice(0, 10) > interval.start.slice(0, 10));
  const dailyHours = knownIntervals.map(interval => `${interval.start.slice(11, 16)}–${interval.end.slice(11, 16)}${interval.end.slice(0, 10) > interval.start.slice(0, 10) ? i18n.t("nextDay", { ns: "itinerary/editor" }) : ""}`).join(", ");
  const hoursLabel = check?.status === "open" ? allDay ? i18n.t("openAllDay", { ns: "itinerary/editor" }) : i18n.t("open", { ns: "itinerary/editor", value0: dailyHours })
    : check?.status === "closed" ? i18n.t("openingHoursConflict", { ns: "itinerary/editor" }) : i18n.t("openingHoursUnavailable", { ns: "itinerary/editor" });
  return (
    <button
      type="button"
      className={`activity-card${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      data-place-id={entry.placeId}
      onClick={() => entry.stopIndex >= 0 && onSelect(entry.stopIndex)}
    >
      <span className="activity-name">{entry.name}</span>
      {entry.endTime && <span className="activity-schedule">{entry.time}–{entry.endTime}</span>}
      <span className="activity-category">{categoryLabel(entry.category)}</span>
      <span className="activity-category" title={entry.admission ? i18n.t("priceSource", { ns: "itinerary/editor", source: entry.admission.source ?? i18n.t("sourceUnavailable", { ns: "itinerary/editor" }), url: entry.admission.sourceUrl ? ` (${entry.admission.sourceUrl})` : "" }) : undefined}>{localizedAdmission(entry.admission)}</span>
      <span className="activity-time">
        <ScheduleOutlined /> {i18n.t("durationVisit", { ns: "itinerary/editor", duration: formatDuration(entry.durationMinutes) })}
      </span>
      <span className={`activity-category${check?.status === "closed" ? " activity-conflict" : ""}`}>
        {hoursLabel}
      </span>
    </button>
  );
}
