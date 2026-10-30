import { expect, it } from "vitest";
import type { ItineraryDay } from "@triply/shared";
import { dayPreviewChanges } from "./dayPreviewChanges";
function day(ids: string[]): ItineraryDay {
  return { dayIndex: 1, date: "2030-06-02", timeZone: "UTC", stops: [],
    activities: ids.map(placeId => ({ placeId, type: "attraction", title: placeId, startTime: "2030-06-02T09:00:00", endTime: "2030-06-02T10:00:00", durationMinutes: 60 })),
    geometry: null, segments: [], totalDistanceMeters: null, totalTravelMinutes: null, totalVisitMinutes: 120, partiallyEstimated: false, warnings: [] };
}
it("does not mislabel insertion/removal as reordering retained attractions", () => {
  expect(dayPreviewChanges(day(["a", "b"]), day(["new", "a", "b"]))).toEqual([]);
  expect(dayPreviewChanges(day(["a", "b"]), day(["b"]))).toEqual([]);
});
it("detects reorder and time changes by place ID rather than position or name", () => {
  const before = day(["a", "b"]); const after = day(["b", "a"]);
  after.activities[0].startTime = "2030-06-02T11:00:00";
  const changes = dayPreviewChanges(before, after);
  expect(changes.map(change => [change.id, change.reordered, change.timeChanged])).toEqual([["b", true, true], ["a", true, false]]);
});
