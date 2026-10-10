import type { TimelineBreak } from "../../config/itineraryAdapters";

interface TripBreakCardProps {
  entry: TimelineBreak;
}

export default function TripBreakCard({ entry }: TripBreakCardProps) {
  return (
    <div className="break-card">
      <span className="break-title">
        {entry.name} · estimated {entry.minutes} min
      </span>
      <span className="break-sub">Time to recharge</span>
    </div>
  );
}
