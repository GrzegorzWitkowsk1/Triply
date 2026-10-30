import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TripItinerary } from "@triply/shared";

/** Keep navigation in history and selection tied to confirmed place IDs. */
export function useTripDaySelection(tripId: string | undefined, itinerary: TripItinerary | null) {
  const [params, setParams] = useSearchParams();
  const days = itinerary?.days ?? [];
  const activeDay = Math.max(0, days.findIndex(day => day.dayIndex === Number(params.get("day"))));
  const day = days[activeDay];
  const ids = day?.stops.filter(stop => stop.placeId && day.activities.some(activity => activity.type === "attraction" && activity.placeId === stop.placeId)).map(stop => stop.placeId!) ?? [];
  const scope = `${tripId}:${day?.dayIndex}`;
  const [selection, setSelection] = useState<{ scope: string; placeId: string | null } | null>(null);
  const selectedId = selection?.scope === scope ? selection.placeId : ids[0] ?? null;
  const activeStop = selectedId ? ids.indexOf(selectedId) : -1;
  const signature = JSON.stringify(ids);
  useEffect(() => {
    setSelection(current => {
      if (current?.scope !== scope) return { scope, placeId: ids[0] ?? null };
      if (current.placeId && !ids.includes(current.placeId)) return { scope, placeId: null };
      return current;
    });
  }, [scope, signature]);
  function setActiveDay(next: number | ((current: number) => number)) {
    const index = typeof next === "function" ? next(activeDay) : next;
    const target = days[index];
    if (!target) return;
    setParams(current => { const updated = new URLSearchParams(current); updated.set("day", String(target.dayIndex)); return updated; });
    setSelection(null);
  }
  function setActiveStop(index: number) { setSelection({ scope, placeId: ids[index] ?? null }); }
  return { activeDay, activeStop, setActiveDay, setActiveStop };
}
