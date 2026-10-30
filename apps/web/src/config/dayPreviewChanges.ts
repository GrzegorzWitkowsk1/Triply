import type { ItineraryDay } from "@triply/shared";

/** Compare only retained identities; an insertion alone is not a reorder. */
export function dayPreviewChanges(before: ItineraryDay, after: ItineraryDay) {
  const original = before.activities.filter(activity => activity.type === "attraction" && activity.placeId);
  const proposed = after.activities.filter(activity => activity.type === "attraction" && activity.placeId);
  const originalById = new Map(original.map(activity => [activity.placeId!, activity]));
  const proposedIds = new Set(proposed.map(activity => activity.placeId!));
  const originalCommon = original.filter(activity => proposedIds.has(activity.placeId!)).map(activity => activity.placeId!);
  const proposedCommon = proposed.filter(activity => originalById.has(activity.placeId!)).map(activity => activity.placeId!);
  return proposed.flatMap(activity => {
    const id = activity.placeId!;
    const previous = originalById.get(id);
    if (!previous) return [];
    const reordered = originalCommon.indexOf(id) !== proposedCommon.indexOf(id);
    const timeChanged = previous.startTime !== activity.startTime || previous.endTime !== activity.endTime;
    return reordered || timeChanged ? [{ id, name: activity.title, reordered, timeChanged, before: previous, after: activity }] : [];
  });
}
