import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@triply/shared";
import TripDayNavigation from "./TripDayNavigation";
afterEach(cleanup);
const days = [1, 2, 3].map(dayIndex => ({ dayIndex, date: `2030-06-0${dayIndex}` })) as ItineraryDay[];
it("supports arrow/Home/End navigation and labels the active panel", () => {
  const onSelect = vi.fn();
  render(<TripDayNavigation days={days} active={0} disabled={false} onSelect={onSelect} />);
  const tabs = screen.getAllByRole("tab");
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(tabs[1].tabIndex).toBe(-1);
  fireEvent.keyDown(tabs[0], { key: "End" }); expect(onSelect).toHaveBeenLastCalledWith(2);
  fireEvent.keyDown(tabs[2], { key: "Home" }); expect(onSelect).toHaveBeenLastCalledWith(0);
  fireEvent.keyDown(tabs[0], { key: "ArrowLeft" }); expect(onSelect).toHaveBeenLastCalledWith(2);
});
it("blocks day changes while an edit or preview is pending", () => {
  const onSelect = vi.fn();
  render(<TripDayNavigation days={days} active={0} disabled onSelect={onSelect} />);
  fireEvent.click(screen.getAllByRole("tab")[1]);
  expect(onSelect).not.toHaveBeenCalled();
});
it("handles missing or invalid dates without fabricating calendar labels", () => {
  render(<TripDayNavigation days={[{ ...days[0], date: "invalid" }]} active={0} disabled={false} onSelect={() => {}} />);
  expect(screen.getByRole("tab").textContent).toBe("Day 1");
});
