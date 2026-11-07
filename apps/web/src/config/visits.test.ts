import { expect, it } from "vitest";
import { visitProgress, type ItineraryDay, type VisitProgress } from "@triply/shared";

const day = (ids: string[]): ItineraryDay => ({ activities: [
  ...ids.map(itineraryItemId => ({ type: "attraction", itineraryItemId })), { type: "travel" }, { type: "break" },
] }) as ItineraryDay;
const record = (id: string, status: "visited" | "skipped"): VisitProgress => ({ itineraryItemId: id, status, updatedAt: "2026-11-05T12:00:00Z" });

it("uses the same calculation for daily and whole trip progress, excluding retired visits and non-visits", () => {
  const days = [day(["one", "two", "three"]), day(["four"])];
  const visits = [record("one", "visited"), record("two", "skipped"), record("retired", "visited")];
  expect(visitProgress(days, visits)).toEqual({ total: 4, planned: 2, remaining: 2, visited: 1, skipped: 1, percentage: 25 });
  expect(visitProgress([days[0]], visits).percentage).toBeCloseTo(100 / 3);
  expect(visitProgress([days[1]], visits).remaining).toBe(1);
});
it("treats all skipped and empty days as zero visited completion", () => {
  expect(visitProgress([day(["one"])], [record("one", "skipped")])).toEqual({ total: 1, planned: 0, remaining: 0, visited: 0, skipped: 1, percentage: 0 });
  expect(visitProgress([day([])])).toEqual({ total: 0, planned: 0, remaining: 0, visited: 0, skipped: 0, percentage: 0 });
  expect(visitProgress([]).percentage).toBe(0);
});
