import { ScheduleOutlined } from "@mui/icons-material";
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
  return (
    <button
      type="button"
      className={`activity-card${selected ? " is-selected" : ""}`}
      onClick={() => entry.stopIndex >= 0 && onSelect(entry.stopIndex)}
    >
      <span className="activity-name">{entry.name}</span>
      <span className="activity-category">{entry.category}</span>
      <span className="activity-time">
        <ScheduleOutlined /> {formatDuration(entry.durationMinutes)} visit
      </span>
    </button>
  );
}
