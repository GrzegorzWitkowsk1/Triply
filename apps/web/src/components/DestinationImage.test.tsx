import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { findDestination } from "@triply/shared";
import DestinationImage from "./DestinationImage";

const photo = findDestination("city-001")!;
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each([
  { imageUrl: "" }, { imageUrl: "javascript:alert(1)" }, { imageUrl: "https://user:secret@example.com/x" },
  { license: "" }, { sourceUrl: "javascript:alert(1)" }, { licenseUrl: "" }, { photographer: "" }, { licenseAuditStatus: "restricted" },
])("uses a safe placeholder for incomplete or unsafe image metadata %j", fields => {
  render(<DestinationImage photo={{ ...photo, ...fields }} />);
  expect(screen.getByRole("img", { name: "Paris: image unavailable" })).toBeVisible(); expect(screen.queryByAltText("Paris")).toBeNull();
});
it("uses lazy decoding, handles a broken image and retries when the source changes", () => {
  const view = render(<DestinationImage photo={photo} />);
  const image = screen.getByAltText("Paris"); expect(image).toHaveAttribute("loading", "lazy"); expect(image).toHaveAttribute("decoding", "async");
  fireEvent.error(image); expect(screen.getByRole("img", { name: "Paris: image unavailable" })).toBeVisible();
  view.rerender(<DestinationImage photo={{ ...photo, imageUrl: "https://example.com/repaired.jpg" }} />);
  expect(screen.getByAltText("Paris")).toHaveAttribute("src", "https://example.com/repaired.jpg");
});
it("falls back after a visible image stays slow, and cancels that timeout after load", () => {
  vi.useFakeTimers(); vi.stubGlobal("IntersectionObserver", undefined);
  const view = render(<DestinationImage photo={photo} />);
  act(() => { vi.advanceTimersByTime(15_001); }); expect(screen.getByRole("img", { name: "Paris: image unavailable" })).toBeVisible();
  view.rerender(<DestinationImage photo={{ ...photo, imageUrl: "https://example.com/loaded.jpg" }} />);
  fireEvent.load(screen.getByAltText("Paris")); act(() => { vi.advanceTimersByTime(15_001); });
  expect(screen.getByAltText("Paris")).toBeVisible();
});
it("preserves existing author, source and license links even when attribution is optional", () => {
  const cc0 = findDestination("city-034")!;
  render(<DestinationImage photo={cc0} />);
  expect(screen.getByText(`Photo: ${cc0.photographer}`)).toBeVisible();
  expect(screen.getByRole("link", { name: "CC0" })).toHaveAttribute("href", cc0.licenseUrl);
});
