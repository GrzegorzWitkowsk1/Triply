import type { TripActivity } from "../../config/trip";

interface TripActivityCardProps {
  activity: TripActivity;
  index: number;
  selected: boolean;
  onSelect: () => void;
}

export default function TripActivityCard({
  activity,
  index,
  selected,
  onSelect,
}: TripActivityCardProps) {
  return (
    <button
      className={`activity-card${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <img className="activity-thumb" src={activity.image} alt={activity.name} />
      <div className="activity-info">
        <span className="activity-count">{index}</span>
        <span className="activity-meta">
          {activity.hour} · {activity.type}
        </span>
        <span className="activity-name">{activity.name}</span>
        <span className="activity-sub">
          {activity.duration} · €{activity.cost} · {activity.walkMinutes} min to next
        </span>
      </div>
    </button>
  );
}