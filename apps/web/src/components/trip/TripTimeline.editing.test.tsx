import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TimelineEntry } from "../../config/itineraryAdapters";
import TripTimeline from "./TripTimeline";

const entries: TimelineEntry[] = [
  { kind: "attraction", placeId: "node/1", key: "a1", name: "Museum", category: "Culture", time: "09:00", durationMinutes: 30, stopIndex: 0 },
  { kind: "travel", key: "t1", toName: "Park", minutes: 2 },
  { kind: "break", key: "b1", name: "Lunch break", time: "12:00", minutes: 45, icon: "meal" },
  { kind: "attraction", placeId: "node/2", key: "a2", name: "Park", category: "Nature", time: "13:00", durationMinutes: 30, stopIndex: 1 },
];
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const index = Number(this.closest("[data-stop]")?.getAttribute("data-stop") ?? 0);
    return new DOMRect(0, index * 200, 400, 150);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("editable timeline", () => {
  it("shows handles only on attractions and exposes contextual actions", () => {
    const onAction = vi.fn();
    render(<TripTimeline entries={entries} activeStop={0} onSelectStop={() => {}} onReorder={() => {}} onAction={onAction} />);
    expect(screen.getAllByRole("button", { name: /^Reorder / })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Edit Museum" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove attraction" }));
    expect(onAction).toHaveBeenCalledWith("remove", "node/1");
  });

  it("reorders using the real keyboard drag sensor while travel and breaks remain outside the operation", async () => {
    const onReorder = vi.fn();
    render(<TripTimeline entries={entries} activeStop={0} onSelectStop={() => {}} onReorder={onReorder} onAction={() => {}} />);
    const handle = screen.getByRole("button", { name: "Reorder Museum" });
    handle.focus();
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await waitFor(() => expect(handle.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(document, { key: "ArrowDown", code: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("position 2"));
    fireEvent.keyDown(document, { key: " ", code: "Space" });
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(["node/2", "node/1"]));
  });

  it("disables handles and menus during persistence", () => {
    render(<TripTimeline entries={entries} activeStop={0} onSelectStop={() => {}} onReorder={() => {}} onAction={() => {}} saving />);
    expect((screen.getByRole("button", { name: "Reorder Museum" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Edit Park" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
