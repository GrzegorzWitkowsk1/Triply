import { useEffect, useRef } from "react";
import {
  DirectionsWalkOutlined,
  LocalCafeOutlined,
  RestaurantOutlined,
} from "@mui/icons-material";
import type { TimelineEntry } from "../../config/itineraryAdapters";
import TripAttractionCard from "./TripAttractionCard";
import TripBreakCard from "./TripBreakCard";

interface TripTimelineProps {
  entries: TimelineEntry[];
  activeStop: number;
  onSelectStop: (stopIndex: number) => void;
}

export default function TripTimeline({
  entries,
  activeStop,
  onSelectStop,
}: TripTimelineProps) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const target = listRef.current?.querySelector<HTMLElement>(
      `[data-stop="${activeStop}"]`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeStop, entries]);

  return (
    <ol className="trip-timeline" ref={listRef}>
      {entries.map((entry) => {
        if (entry.kind === "travel") {
          return (
            <li key={entry.key} className="timeline-leg">
              <div className="timeline-rail">
                <span className="timeline-node is-travel" aria-hidden="true">
                  <DirectionsWalkOutlined />
                </span>
              </div>
              <div className="timeline-body">
                <p className="timeline-walk">
                  Walk to next stop · estimated {entry.minutes} min
                </p>
              </div>
            </li>
          );
        }

        if (entry.kind === "break") {
          const Icon = entry.icon === "coffee" ? LocalCafeOutlined : RestaurantOutlined;

          return (
            <li key={entry.key} className="timeline-item is-break">
              <div className="timeline-rail">
                <span className="timeline-node is-break" aria-hidden="true">
                  <Icon />
                </span>
                <span className="timeline-time">{entry.time}</span>
              </div>
              <div className="timeline-body">
                <TripBreakCard entry={entry} />
              </div>
            </li>
          );
        }

        const selected = entry.stopIndex >= 0 && entry.stopIndex === activeStop;

        return (
          <li
            key={entry.key}
            className={`timeline-item is-attraction${selected ? " is-selected" : ""}`}
            data-stop={entry.stopIndex}
          >
            <div className="timeline-rail">
              <span className="timeline-node">{entry.stopIndex + 1}</span>
              <span className="timeline-time">{entry.time}</span>
            </div>
            <div className="timeline-body">
              <TripAttractionCard
                entry={entry}
                selected={selected}
                onSelect={onSelectStop}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
