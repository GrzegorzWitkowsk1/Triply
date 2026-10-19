import { useEffect, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconButton, Menu, MenuItem } from "@mui/material";
import { DragIndicator, MoreVert } from "@mui/icons-material";
import type { TimelineAttraction } from "../../config/itineraryAdapters";
import {
  DirectionsWalkOutlined,
  LocalCafeOutlined,
  RestaurantOutlined,
} from "@mui/icons-material";
import type { TimelineEntry } from "../../config/itineraryAdapters";
import TripAttractionCard from "./TripAttractionCard";
import TripBreakCard from "./TripBreakCard";
import AttractionSaveButton from "../AttractionSaveButton";

interface TripTimelineProps {
  tripId?: string;
  entries: TimelineEntry[];
  activeStop: number;
  onSelectStop: (stopIndex: number) => void;
  saving?: boolean;
  onReorder?: (ids: string[]) => void;
  onAction?: (action: "remove" | "replace" | "move", attractionId: string) => void;
}

function EditableAttraction({ entry, selected, onSelect, saving, onAction, tripId }: {
  tripId?: string;
  entry: TimelineAttraction; selected: boolean; onSelect: (index: number) => void;
  saving: boolean; onAction: NonNullable<TripTimelineProps["onAction"]>;
}) {
  const sortable = useSortable({ id: entry.placeId!, disabled: saving });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <li ref={sortable.setNodeRef} data-stop={entry.stopIndex}
    style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.55 : 1, zIndex: sortable.isDragging ? 2 : undefined }}
    className={`timeline-item is-attraction${selected ? " is-selected" : ""}`}>
    <div className="timeline-rail"><span className="timeline-node">{entry.stopIndex + 1}</span><span className="timeline-time">{entry.time}</span></div>
    <div className="timeline-body itinerary-editable-card">
      <TripAttractionCard entry={entry} selected={selected} onSelect={onSelect} />
      <div className="itinerary-card-controls">
        {tripId && entry.attractionKey && <AttractionSaveButton tripId={tripId} attractionKey={entry.attractionKey} name={entry.name} />}
        <IconButton ref={sortable.setActivatorNodeRef} {...sortable.attributes} {...sortable.listeners}
          aria-label={`Reorder ${entry.name}`} disabled={saving} size="small" style={{ touchAction: "none" }}><DragIndicator /></IconButton>
        <IconButton aria-label={`Edit ${entry.name}`} disabled={saving} size="small" onClick={(event) => setAnchor(event.currentTarget)}><MoreVert /></IconButton>
      </div>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {(["replace", "move", "remove"] as const).map((action) => <MenuItem key={action} onClick={() => { setAnchor(null); onAction(action, entry.placeId!); }}>
          {action === "replace" ? "Replace attraction" : action === "move" ? "Move to another day" : "Remove attraction"}
        </MenuItem>)}
      </Menu>
    </div>
  </li>;
}

export default function TripTimeline({
  tripId,
  entries,
  activeStop,
  onSelectStop,
  saving = false,
  onReorder,
  onAction,
}: TripTimelineProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = entries.filter((entry): entry is TimelineAttraction => entry.kind === "attraction" && Boolean(entry.placeId)).map((entry) => entry.placeId!);
  const label = (id: string | number) => entries.find(
    (entry): entry is TimelineAttraction => entry.kind === "attraction" && entry.placeId === String(id),
  )?.name ?? "Attraction";

  useEffect(() => {
    const target = listRef.current?.querySelector<HTMLElement>(
      `[data-stop="${activeStop}"]`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeStop, entries]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={{ announcements: {
      onDragStart: ({ active }) => `Picked up ${label(active.id)}. Use arrow keys to change its position.`,
      onDragOver: ({ active, over }) => over ? `${label(active.id)} moved to position ${ids.indexOf(String(over.id)) + 1} of ${ids.length}.` : undefined,
      onDragEnd: ({ active, over }) => over && active.id !== over.id ? `Dropped ${label(active.id)} at position ${ids.indexOf(String(over.id)) + 1}. Saving itinerary.` : "Order unchanged.",
      onDragCancel: () => "Reordering cancelled.",
    } }} onDragEnd={({ active, over }) => {
      if (!saving && onReorder && over && active.id !== over.id) {
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
      }
    }}>
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
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

        if (onAction && onReorder && entry.placeId) {
          return <EditableAttraction key={entry.placeId} entry={entry} selected={selected} onSelect={onSelectStop} saving={saving} onAction={onAction} tripId={tripId} />;
        }

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
              {tripId && entry.attractionKey && <AttractionSaveButton tripId={tripId} attractionKey={entry.attractionKey} name={entry.name} />}
            </div>
          </li>
        );
      })}
    </ol>
    </SortableContext>
    </DndContext>
  );
}
