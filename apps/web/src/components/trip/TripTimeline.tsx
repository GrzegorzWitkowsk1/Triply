import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { formatDistance } from "../../i18n/format";
import { useEffect, useRef, useState } from "react";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, useMediaQuery } from "@mui/material";
import { DragIndicator, MoreVert } from "@mui/icons-material";
import type { TimelineAttraction } from "../../config/itineraryAdapters";
import {
  DirectionsWalkOutlined,
  LocalCafeOutlined,
  RestaurantOutlined,
  DirectionsCarOutlined,
  DirectionsBikeOutlined,
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
  visible?: boolean;
  onReorder?: (ids: string[]) => void;
  onAction?: (action: "remove" | "replace" | "move", attractionId: string) => void;
}

function EditableAttraction({ entry, selected, onSelect, saving, onAction, tripId, onStep, canMoveUp, canMoveDown }: {
  tripId?: string;
  entry: TimelineAttraction; selected: boolean; onSelect: (index: number) => void;
  saving: boolean; onAction: NonNullable<TripTimelineProps["onAction"]>;
  onStep: (direction: -1 | 1) => void; canMoveUp: boolean; canMoveDown: boolean;
}) {
  useTranslation();
  const sortable = useSortable({ id: entry.placeId!, disabled: saving });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <li ref={sortable.setNodeRef} data-stop={entry.stopIndex}
    style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.55 : 1, zIndex: sortable.isDragging ? 2 : undefined }}
    data-dragging={sortable.isDragging || undefined} className={`timeline-item is-attraction${selected ? " is-selected" : ""}`}>
    <div className="timeline-rail"><span className="timeline-node">{entry.stopIndex + 1}</span><span className="timeline-time">{entry.time}</span></div>
    <div className="timeline-body itinerary-editable-card">
      <TripAttractionCard entry={entry} selected={selected} onSelect={onSelect} />
      <div className="itinerary-card-controls">
        {tripId && entry.attractionKey && <AttractionSaveButton tripId={tripId} attractionKey={entry.attractionKey} name={entry.name} />}
        <IconButton ref={sortable.setActivatorNodeRef} {...sortable.attributes} {...sortable.listeners}
          aria-label={i18n.t("reorder", { ns: "itinerary/editor", value0: entry.name })} disabled={saving} size="small" style={{ touchAction: "none" }}><DragIndicator /></IconButton>
        <IconButton aria-label={i18n.t("edit", { ns: "itinerary/editor", value0: entry.name })} disabled={saving} size="small" onClick={(event) => setAnchor(event.currentTarget)}><MoreVert /></IconButton>
      </div>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem disabled={saving || !canMoveUp} onClick={() => { setAnchor(null); onStep(-1); }}>{i18n.t("moveEarlier", { ns: "itinerary/editor" })}</MenuItem>
        <MenuItem disabled={saving || !canMoveDown} onClick={() => { setAnchor(null); onStep(1); }}>{i18n.t("moveLater", { ns: "itinerary/editor" })}</MenuItem>
        {(["replace", "move", "remove"] as const).map((action) => <MenuItem key={action} onClick={() => { setAnchor(null); onAction(action, entry.placeId!); }}>
          {action === "replace" ? i18n.t("replaceAttraction2", { ns: "itinerary/editor" }) : action === "move" ? i18n.t("moveToAnotherDay", { ns: "itinerary/editor" }) : i18n.t("removeAttraction", { ns: "itinerary/editor" })}
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
  visible = true,
  onReorder,
  onAction,
}: TripTimelineProps) {
  useTranslation();
  const listRef = useRef<HTMLOListElement>(null);
  const focusedStop = useRef<{ id: string; index: number } | null>(null);
  const lastSelection = useRef<string | null>(null);
  const wasVisible = useRef(visible);
  const coarse = useMediaQuery("(pointer: coarse)");
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = entries.filter((entry): entry is TimelineAttraction => entry.kind === "attraction" && Boolean(entry.placeId)).map((entry) => entry.placeId!);
  const idsKey = JSON.stringify(ids);
  useEffect(() => {
    const previous = focusedStop.current;
    if (!previous || ids.includes(previous.id)) return;
    focusedStop.current = null;
    const frame = requestAnimationFrame(() => {
      if (!visible || document.activeElement !== document.body) return;
      const cards = listRef.current?.querySelectorAll<HTMLButtonElement>(".activity-card");
      (cards?.[Math.min(previous.index, cards.length - 1)] ?? listRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [idsKey, visible]);
  const label = (id: string | number) => entries.find(
    (entry): entry is TimelineAttraction => entry.kind === "attraction" && entry.placeId === String(id),
  )?.name ?? i18n.t("category_attraction", { ns: "itinerary/categories" });

  const selectedKey = entries.find(entry => entry.kind === "attraction" && entry.stopIndex === activeStop)?.key ?? null;
  useEffect(() => {
    const revealing = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!visible) return;
    const previous = lastSelection.current;
    lastSelection.current = selectedKey;
    if (!revealing && (!previous || previous === selectedKey)) return;
    const target = listRef.current?.querySelector<HTMLElement>(
      `[data-stop="${activeStop}"]`,
    );
    const bounds = target?.getBoundingClientRect();
    if (bounds && (bounds.top < 80 || bounds.bottom > window.innerHeight - 100)) target?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" });
  }, [activeStop, selectedKey, visible]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={{ screenReaderInstructions: { draggable: i18n.t("dragInstructions", { ns: "itinerary/editor" }) }, announcements: {
      onDragStart: ({ active }) => i18n.t("pickedUpUseArrowKeysToChangeIts", { ns: "itinerary/editor", value0: label(active.id) }),
      onDragOver: ({ active, over }) => over ? i18n.t("movedToPositionOf", { ns: "itinerary/editor", value0: label(active.id), value1: ids.indexOf(String(over.id)) + 1, value2: ids.length }) : undefined,
      onDragEnd: ({ active, over }) => over && active.id !== over.id ? i18n.t("droppedAtPositionSavingItinerary", { ns: "itinerary/editor", value0: label(active.id), value1: ids.indexOf(String(over.id)) + 1 }) : i18n.t("orderUnchanged", { ns: "itinerary/editor" }),
      onDragCancel: () => i18n.t("reorderingCancelled", { ns: "itinerary/editor" }),
    } }} onDragEnd={({ active, over }) => {
      if (!saving && onReorder && over && active.id !== over.id) {
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
      }
    }}>
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
    <ol className="trip-timeline" ref={listRef} tabIndex={-1} onFocusCapture={event => {
      const item = (event.target as HTMLElement).closest<HTMLElement>("[data-stop]");
      const entry = entries.find(entry => entry.kind === "attraction" && entry.stopIndex === Number(item?.dataset.stop));
      if (entry?.kind === "attraction" && entry.placeId) focusedStop.current = { id: entry.placeId, index: ids.indexOf(entry.placeId) };
    }}>
      {entries.map((entry) => {
        if (entry.kind === "travel") {
          const TravelIcon = entry.mode === "driving" ? DirectionsCarOutlined : entry.mode === "cycling" ? DirectionsBikeOutlined : DirectionsWalkOutlined;
          return (
            <li key={entry.key} className="timeline-leg">
              <div className="timeline-rail">
                <span className="timeline-node is-travel" aria-hidden="true">
                  <TravelIcon />
                </span>
              </div>
              <div className="timeline-body">
                <p className="timeline-walk">
                  {entry.unavailable ? i18n.t("travelUnavailable", { ns: "trips/details" }) : entry.estimated === undefined ? i18n.t("walkMinutes", { ns: "itinerary/editor", count: entry.minutes }) : i18n.t(entry.mode === "driving" ? "driveMinutes" : entry.mode === "cycling" ? "cycleMinutes" : "walkDuration", { ns: "trips/details", duration: i18n.t("minutes", { ns: "common", count: entry.minutes }) })}</p>
                <span className="timeline-travel-detail">{entry.toName}</span>
                {entry.distanceMeters != null && <span className="timeline-travel-detail">{formatDistance(entry.distanceMeters)}</span>}
                {entry.estimated && !entry.unavailable && <span className="timeline-travel-detail">{i18n.t("estimatedTravel", { ns: "trips/details" })}</span>}
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
          const index = ids.indexOf(entry.placeId);
          return <EditableAttraction key={entry.placeId} entry={entry} selected={selected} onSelect={onSelectStop} saving={saving}
            canMoveUp={index > 0} canMoveDown={index < ids.length - 1} onStep={direction => { if (!saving && index + direction >= 0 && index + direction < ids.length) onReorder(arrayMove(ids, index, index + direction)); }}
            onAction={(action, id) => { if (action === "remove" && coarse) setRemoving({ id, name: entry.name }); else onAction(action, id); }} tripId={tripId} />;
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
    <Dialog open={!!removing} onClose={saving ? undefined : () => setRemoving(null)} fullWidth maxWidth="xs" aria-labelledby="remove-stop-title">
      <DialogTitle id="remove-stop-title">{i18n.t("removeAttraction", { ns: "itinerary/editor" })}</DialogTitle>
      <DialogContent>{i18n.t("removeConfirmation", { ns: "itinerary/editor", name: removing?.name ?? "" })}</DialogContent>
      <DialogActions><Button disabled={saving} onClick={() => setRemoving(null)}>{i18n.t("cancel", { ns: "common" })}</Button><Button color="error" disabled={saving} onClick={() => { if (removing) { onAction?.("remove", removing.id); setRemoving(null); } }}>{i18n.t("removeAttraction", { ns: "itinerary/editor" })}</Button></DialogActions>
    </Dialog>
    </DndContext>
  );
}
