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
  const check = entry.openingHoursCheck;
  const knownIntervals = check?.intervals.filter(interval => !interval.unknown) ?? [];
  const allDay = knownIntervals.some(interval => interval.start.slice(11, 16) === "00:00"
    && interval.end.slice(0, 10) > interval.start.slice(0, 10));
  const dailyHours = knownIntervals.map(interval => `${interval.start.slice(11, 16)}–${interval.end.slice(11, 16)}${interval.end.slice(0, 10) > interval.start.slice(0, 10) ? " (next day)" : ""}`).join(", ");
  const hoursLabel = check?.status === "open" ? allDay ? "Open all day" : `Open ${dailyHours}`
    : check?.status === "closed" ? "Opening-hours conflict" : "Opening hours unavailable";
  return (
    <button
      type="button"
      className={`activity-card${selected ? " is-selected" : ""}`}
      onClick={() => entry.stopIndex >= 0 && onSelect(entry.stopIndex)}
    >
      <span className="activity-name">{entry.name}</span>
      <span className="activity-category">{entry.category}</span>
      <span className="activity-category" title={entry.admission ? `Source: ${entry.admission.source ?? "unavailable"}${entry.admission.sourceUrl ? ` (${entry.admission.sourceUrl})` : ""}. Prices may change; verify before visiting.` : undefined}>{admissionLabel(entry.admission)}</span>
      <span className="activity-time">
        <ScheduleOutlined /> {formatDuration(entry.durationMinutes)} visit
      </span>
      <span className="activity-category" title={entry.openingHoursCheck?.reason}>
        {hoursLabel}
      </span>
    </button>
  );
}
