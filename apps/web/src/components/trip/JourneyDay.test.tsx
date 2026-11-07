import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ItineraryDay, TripExpense, VisitProgress } from "@triply/shared";
import JourneyDay from "./JourneyDay";
import JourneyOverview from "./JourneyOverview";
import i18n from "../../i18n";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const day: ItineraryDay = { dayIndex: 1, date: "2026-11-05", timeZone: "Asia/Tokyo",
  activities: ["Museum", "Park", "Gallery"].map((title, i) => ({ type: "attraction", itineraryItemId: `item-${i}`, placeId: `node/${i}`, title, startTime: "2026-11-05T09:00:00+09:00", endTime: "2026-11-05T10:00:00+09:00", durationMinutes: 60 })),
  stops: ["Museum", "Park", "Gallery"].map((name, i) => ({ itineraryItemId: `item-${i}`, placeId: `node/${i}`, name, lat: 35 + i * .001, lng: 139, category: "culture", score: null })),
  geometry: null, segments: [], totalVisitMinutes: 180, totalDistanceMeters: null, totalTravelMinutes: null, partiallyEstimated: false, warnings: [] };
const visits: VisitProgress[] = [{ itineraryItemId: "item-0", status: "visited", updatedAt: "2026-11-05T00:00:00Z" }, { itineraryItemId: "item-1", status: "skipped", updatedAt: "2026-11-05T00:00:00Z" }];

it("identifies the next planned occurrence in order and reuses visited/skipped/reset controls", () => {
  const select = vi.fn(); const visit = vi.fn();
  const view = render(<JourneyDay day={day} visits={visits} active={0} saving={false} visible onSelect={select} onVisit={visit} />);
  expect(screen.getByRole("button", { name: "Next: Gallery" })).toBeTruthy();
  expect(view.container.querySelector("[data-next-visit]")?.textContent).toContain("Gallery");
  expect(view.container.querySelectorAll(".is-visited")).toHaveLength(1); expect(view.container.querySelectorAll(".is-skipped")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Mark Gallery as visited" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark Gallery as skipped" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset Museum to planned" }));
  expect(visit.mock.calls).toEqual([["item-2", "visited"], ["item-2", "skipped"], ["item-0", "planned"]]);
  fireEvent.click(screen.getByRole("button", { name: /Gallery.*09:00/ })); expect(select).toHaveBeenCalledWith(2);
});

it("shows only actual linked expenses and a safe external navigation anchor", () => {
  const expenses = [{ id: "real", itineraryItemId: "item-0", title: "Real ticket", type: "actual", currency: "EUR", amountMinor: 1250 },
    { id: "estimate", itineraryItemId: "item-0", title: "Estimated ticket", type: "planned", currency: "EUR", amountMinor: 9900 }] as TripExpense[];
  render(<JourneyDay day={day} expenses={expenses} active={0} saving={false} visible onSelect={() => {}} onVisit={() => {}} />);
  expect(screen.getByText("Real ticket")).toBeTruthy(); expect(screen.queryByText("Estimated ticket")).toBeNull();
  const link = screen.getByRole("link", { name: /Navigate to Museum.*opens Google Maps/ });
  expect(link.getAttribute("target")).toBe("_blank"); expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(new URL(link.getAttribute("href")!).searchParams.get("destination")).toBe("35,139");
});

it("handles missing coordinates and legacy records without inventing IDs or navigation links", () => {
  const legacy = structuredClone(day); legacy.stops[0].lat = NaN; delete legacy.activities[0].itineraryItemId;
  render(<JourneyDay day={legacy} active={0} saving={false} visible onSelect={() => {}} onVisit={() => {}} />);
  expect(screen.queryByRole("link", { name: /Navigate to Museum/ })).toBeNull();
  expect(screen.getByText(/Navigation unavailable/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mark Museum as visited" })).toBeNull();
  expect(screen.getByText("Next planned stop")).toBeTruthy();
});

it("shows a neutral empty day and zero progress without counting skipped as visited", () => {
  const empty = { ...day, activities: [], stops: [] };
  const view = render(<JourneyDay day={empty} active={-1} saving={false} visible onSelect={() => {}} onVisit={() => {}} />);
  expect(screen.getByText("A day to explore at your own pace")).toBeTruthy();
  view.unmount();
  render(<JourneyOverview days={[empty]} day={empty} visits={visits} loading={false} error={false} onRetry={() => {}} />);
  expect(screen.getAllByText("0 / 0 visited")).toHaveLength(2);
  expect(screen.getAllByRole("progressbar").every(bar => bar.getAttribute("value") === "0")).toBe(true);
});

it("announces status and progress in Polish and keeps all skipped at zero visited", async () => {
  await i18n.changeLanguage("pl");
  const skipped = day.activities.map(item => ({ itineraryItemId: item.itineraryItemId!, status: "skipped" as const, updatedAt: "2026-11-05T00:00:00Z" }));
  render(<><JourneyDay day={day} visits={skipped} active={0} saving={false} visible onSelect={() => {}} onVisit={() => {}} />
    <JourneyOverview days={[day]} day={day} visits={skipped} loading={false} error={false} onRetry={() => {}} /></>);
  expect(screen.getByText("Brak pozostałych zaplanowanych miejsc na ten dzień.")).toBeTruthy();
  expect(screen.getAllByText("Odwiedzone: 0 / 3")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Przywróć Museum do zaplanowanych" })).toBeTruthy();
});
