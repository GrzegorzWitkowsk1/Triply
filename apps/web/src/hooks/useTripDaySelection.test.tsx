import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { vi } from "vitest";
import type { ItineraryDay, TripItinerary } from "@triply/shared";
import { useTripDaySelection } from "./useTripDaySelection";

afterEach(cleanup);
it("chooses today's destination-local day once, keeps it on refetch and respects explicit links", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-06-03T00:30:00Z"));
  try {
    const data = itinerary(); data.timeZone = "America/Los_Angeles";
    data.days[0] = { ...data.days[0], date: "2030-06-01", timeZone: data.timeZone };
    data.days[1] = { ...data.days[1], date: "2030-06-02", timeZone: data.timeZone };
    const view = renderHook(({ itinerary }) => ({ ...useTripDaySelection("t", itinerary), search: useLocation().search, navigate: useNavigate() }), {
      initialProps: { itinerary: data }, wrapper: ({ children }) => <MemoryRouter initialEntries={["/trips/t?mode=journey"]}>{children}</MemoryRouter>,
    });
    expect(view.result.current.activeDay).toBe(1); expect(view.result.current.search).toContain("day=2"); expect(view.result.current.search).toContain("mode=journey");
    act(() => view.result.current.setActiveDay(0));
    vi.setSystemTime(new Date("2030-06-03T12:00:00Z")); view.rerender({ itinerary: structuredClone(data) });
    expect(view.result.current.activeDay).toBe(0);
    act(() => view.result.current.navigate(-1)); expect(view.result.current.activeDay).toBe(1);
  } finally { vi.useRealTimers(); }
});
function day(dayIndex: number, ids: string[]): ItineraryDay {
  return { dayIndex, date: "2030-06-02", timeZone: "UTC", stops: ids.map(placeId => ({ placeId, name: placeId, lat: 1, lng: 2, category: "culture", score: null })),
    activities: ids.map(placeId => ({ placeId, type: "attraction", title: placeId, startTime: "", endTime: "", durationMinutes: 30 })),
    geometry: null, segments: [], totalDistanceMeters: null, totalTravelMinutes: null, totalVisitMinutes: 60, partiallyEstimated: false, warnings: [] };
}
function itinerary(): TripItinerary { return { days: [day(1, ["a", "b"]), day(2, ["c"])], timeZone: "UTC", generatedAt: null, routingSource: "unavailable", unscheduled: [] }; }
function mount(path = "/trips/t") {
  return renderHook(({ data }) => ({ ...useTripDaySelection("t", data), search: useLocation().search }), {
    initialProps: { data: itinerary() }, wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>,
  });
}
it("restores the linked day and preserves unrelated URL parameters", () => {
  const view = mount("/trips/t?day=2&keep=1");
  expect(view.result.current.activeDay).toBe(1);
  act(() => view.result.current.setActiveDay(0));
  expect(view.result.current.search).toContain("day=1");
  expect(view.result.current.search).toContain("keep=1");
});
it("keeps a selected place after reorder and clears it after deletion", () => {
  const view = mount();
  act(() => view.result.current.setActiveStop(1));
  expect(view.result.current.activeStop).toBe(1);
  const updated = itinerary(); updated.days[0] = day(1, ["b", "a"]);
  view.rerender({ data: updated });
  expect(view.result.current.activeStop).toBe(0);
  updated.days[0] = day(1, ["a"]);
  view.rerender({ data: { ...updated } });
  expect(view.result.current.activeStop).toBe(-1);
});
it("uses a safe day for an invalid URL and no selection on an empty day", () => {
  const view = mount("/trips/t?day=999");
  expect(view.result.current.activeDay).toBe(0);
  const updated = itinerary(); updated.days[0] = day(1, []);
  view.rerender({ data: updated });
  expect(view.result.current.activeStop).toBe(-1);
});
