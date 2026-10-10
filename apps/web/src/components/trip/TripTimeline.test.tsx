import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineEntry } from "../../config/itineraryAdapters";
import TripTimeline from "./TripTimeline";

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
