import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineEntry } from "../../config/itineraryAdapters";
import TripTimeline from "./TripTimeline";
import type { AttractionAdmission } from "@triply/shared";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

const entries: TimelineEntry[] = [
  { kind: "travel", key: "t1", minutes: 5, toName: "Museum" },
  {
    kind: "attraction",
    key: "a1",
    stopIndex: 0,
    time: "09:00",
    name: "Museum",
    category: "Culture",
    durationMinutes: 60,
  },
  {
    kind: "break",
    key: "b1",
    time: "10:00",
    name: "Lunch break",
    minutes: 45,
    icon: "meal",
  },
  {
    kind: "attraction",
    key: "a2",
    stopIndex: 1,
    time: "10:45",
    name: "Park",
    category: "Nature",
    durationMinutes: 30,
  },
];

describe("TripTimeline", () => {
  it("distinguishes routed driving, estimated travel and unavailable timing", () => {
    const view = render(<TripTimeline entries={[{ kind: "travel", key: "drive", minutes: 12, toName: "Museum", mode: "driving", estimated: false }]} activeStop={-1} onSelectStop={() => {}} />);
    expect(screen.getByText(/Drive to next stop/)).toBeTruthy();
    expect(screen.queryByText("Estimated travel")).toBeNull();
    view.rerender(<TripTimeline entries={[{ kind: "travel", key: "unknown", minutes: 0, toName: "Museum", unavailable: true, estimated: true }]} activeStop={-1} onSelectStop={() => {}} />);
    expect(screen.getByText("Travel time unavailable — verify the route")).toBeTruthy();
    expect(screen.queryByText(/0 min/)).toBeNull();
  });
  it.each([
    ["free", null, "Free admission"],
    ["paid", null, "Paid admission — price unavailable"],
    ["paid", { amountMinor: 1250, currency: "EUR", fractionDigits: 2, priceType: "general", unit: "per_person" }, "€12.50 admission per person"],
    ["unknown", null, "Admission price unavailable"],
  ] as const)("renders %s admission without turning unknown prices into zero", (status, price, label) => {
    const admission: AttractionAdmission = { status, price, source: "osm", sourceUrl: "https://museum.example", checkedAt: null, retrievedAt: "2026-10-11", rawFee: null, rawCharge: null, rawFeeConditional: null, rawChargeConditional: null, rawCurrency: null, menuUrl: null, notes: null };
    const entry: TimelineEntry = { ...entries[1] as Extract<TimelineEntry, { kind: "attraction" }>, admission };
    render(<TripTimeline entries={[entry]} activeStop={0} onSelectStop={() => {}} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(label).title).toContain("Prices may change");
  });
  it("summarizes 24/7 availability without a misleading midnight-to-midnight label", () => {
    const entry: TimelineEntry = { ...entries[1] as Extract<TimelineEntry, { kind: "attraction" }>,
      openingHoursCheck: { status: "open", reason: "Open all day", source: "osm", timeZone: "Europe/Paris",
        warnings: [], intervals: [{ start: "2026-10-13T00:00:00", end: "2026-10-15T00:00:00", unknown: false }] } };
    render(<TripTimeline entries={[entry]} activeStop={0} onSelectStop={() => {}} />);
    expect(screen.getByText("Open all day")).toBeTruthy();
  });
  it("renders evaluated daily hours and keeps missing hours explicitly unavailable", () => {
    const known: TimelineEntry = { ...entries[1] as Extract<TimelineEntry, { kind: "attraction" }>,
      openingHoursCheck: { status: "open", reason: "The full visit fits within known opening hours.",
        source: "osm", timeZone: "Europe/Paris", warnings: [],
        intervals: [{ start: "2026-10-13T10:00:00", end: "2026-10-13T18:00:00", unknown: false }] } };
    render(<TripTimeline entries={[known, entries[3]]} activeStop={0} onSelectStop={() => {}} />);
    expect(screen.getByText("Open 10:00–18:00")).toBeTruthy();
    expect(screen.getByText("Opening hours unavailable")).toBeTruthy();
  });
  it("renders the existing card's conflict warning", () => {
    const entry: TimelineEntry = { ...entries[1] as Extract<TimelineEntry, { kind: "attraction" }>,
      openingHoursCheck: { status: "closed", reason: "Visit extends beyond closing time.", source: "osm",
        timeZone: "Europe/Paris", intervals: [], warnings: [] } };
    render(<TripTimeline entries={[entry]} activeStop={0} onSelectStop={() => {}} />);
    expect(screen.getByText("Opening-hours conflict").title).toBe("");
    expect(entry.openingHoursCheck?.reason).toBe("Visit extends beyond closing time.");
  });
  it("selects a stop when its attraction card is clicked", () => {
    const onSelectStop = vi.fn();
    render(
      <TripTimeline entries={entries} activeStop={0} onSelectStop={onSelectStop} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Park/ }));

    expect(onSelectStop).toHaveBeenCalledWith(1);
  });

  it("renders walk legs and non-clickable break cards", () => {
    render(<TripTimeline entries={entries} activeStop={0} onSelectStop={() => {}} />);

    expect(screen.getByText("Walk to next stop · estimated 5 min")).toBeTruthy();
    expect(screen.getByText("Lunch break · estimated 45 min")).toBeTruthy();
    expect(screen.getByText("Time to recharge")).toBeTruthy();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.className.includes("activity-card"))).toBe(true);
  });
});
