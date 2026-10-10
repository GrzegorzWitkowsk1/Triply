import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RegenerateDayPreview } from "@triply/shared";
import RegenerateDayDialog from "./RegenerateDayDialog";

afterEach(cleanup);

const PREVIEW: RegenerateDayPreview = {
  previewId: "preview-1",
  tripId: "trip-1",
  dayIndex: 1,
  baseItineraryVersion: 3,
  expiresAt: "2026-06-01T12:00:00.000Z",
  day: {
    dayIndex: 1,
    date: "2026-06-01",
    timeZone: "Europe/Paris",
    activities: [],
    stops: [],
    geometry: null,
    segments: [],
    totalVisitMinutes: 180,
    totalTravelMinutes: 12,
    totalDistanceMeters: 1400,
    partiallyEstimated: false,
    warnings: [],
  },
  warnings: ["Walking distance couldn't be compared reliably for this alternative."],
  unscheduled: [],
  comparison: {
    original: {
      attractionCount: 1,
      walkingMeters: 3200,
      travelMinutes: 20,
      visitMinutes: 120,
    },
    proposed: {
      attractionCount: 2,
      walkingMeters: 1400,
      travelMinutes: 12,
      visitMinutes: 180,
    },
    added: [{ placeId: "node/2", name: "Park", category: "nature", lat: 1, lng: 1, score: 70 }],
    removed: [{ placeId: "node/1", name: "Museum", category: "culture", lat: 1, lng: 1, score: 80 }],
  },
  appliedPreferences: {
    lessWalking: true,
    moreFood: false,
    relaxedPace: false,
    preferIndoor: false,
    surpriseMe: false,
  },
  customInstructions: null,
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof RegenerateDayDialog>> = {}) {
  const props = {
    open: true,
    dayNumber: 1,
    preview: null,
    isGenerating: false,
    isApplying: false,
    error: null,
    onGenerate: vi.fn(),
    onApply: vi.fn(),
    onEditOptions: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };

  render(<RegenerateDayDialog {...props} />);

  return props;
}

describe("RegenerateDayDialog", () => {
  it("disables submission until a preference or instruction is chosen", () => {
    renderDialog();

    const submit = screen.getByRole("button", { name: /Generate alternative/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Less walking/ }));

    expect(submit.disabled).toBe(false);
  });

  it("submits the chosen preferences", () => {
    const { onGenerate } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /More food & local experiences/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate alternative/ }));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          moreFood: true,
          lessWalking: false,
        }),
      }),
    );
  });

  it("shows the preview and applies it", () => {
    const { onApply } = renderDialog({ preview: PREVIEW });

    expect(screen.getByText("Here's the new day")).toBeTruthy();
    expect(screen.getByText("Park")).toBeTruthy();
    expect(screen.getByText("Museum")).toBeTruthy();
    expect(
      screen.getByText("Walking distance couldn't be compared reliably for this alternative."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Apply changes/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("returns to the options when a different alternative is requested", () => {
    const { onEditOptions } = renderDialog({ preview: PREVIEW });

    fireEvent.click(screen.getByRole("button", { name: /Try different options/ }));

    expect(onEditOptions).toHaveBeenCalledTimes(1);
  });
});