import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TripDetail } from "@triply/shared";
import { ApiError } from "../api/client";
import TripPage from "./TripPage";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(), reset: vi.fn(), refetch: vi.fn(),
  save: vi.fn(),
  trip: { data: undefined as TripDetail | undefined, isPending: false, isError: false, isFetching: false, error: null as Error | null },
  generation: { isPending: false, isError: false, error: null as Error | null },
}));
vi.mock("../hooks/useTrips", () => ({ TRIPS_KEY: ["trips"], useTrip: () => ({ ...mocks.trip, refetch: mocks.refetch }) }));
vi.mock("../hooks/useTripGeneration", () => ({ useGenerateTrip: () => ({ ...mocks.generation, mutate: mocks.mutate, reset: mocks.reset }) }));
vi.mock("../hooks/useTripRegeneration", () => ({
  useRegenerateDay: () => ({ reset: vi.fn(), mutate: vi.fn(), isPending: false, error: null }),
  useApplyRegeneration: () => ({ reset: vi.fn(), mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock("../hooks/useTripAnalysis", () => ({ useUpdateTripRequirements: () => ({ reset: vi.fn(), mutate: mocks.save, isPending: false, error: null }) }));
vi.mock("../components/home/TripRequirementsDialog", () => ({ default: () => null }));
vi.mock("../components/trip/RegenerateDayDialog", () => ({ default: () => null }));
vi.mock("../components/trip/TripAssistant", () => ({ default: () => null }));

function fixture(): TripDetail {
  return {
    id: "trip-1", draftId: "trip-1", status: "draft", prompt: "Paris", badges: [],
    analysis: {
      destination: "Paris", country: "France", durationDays: 2, startDate: null, endDate: null,
      travelers: 1, budget: { amount: null, currency: null, type: null }, interests: ["culture"],
      pace: "balanced", maxWalkingDistanceKm: null, notes: null, location: null,
    },
    missingFields: [], requirementsComplete: true, equipment: [], weather: [], itinerary: null,
    generation: { startedAt: null, generatedAt: null, error: null },
    fixtureKey: null, createdAt: null, updatedAt: null,
  };
}

function Page() {
  return (
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[{ pathname: "/trips/trip-1", state: { autoStart: true } }]}>
          <Routes><Route path="/trips/:id" element={<TripPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.trip, { data: fixture(), isPending: false, isError: false, isFetching: false, error: null });
  Object.assign(mocks.generation, { isPending: false, isError: false, error: null });
});
afterEach(cleanup);

describe("TripPage generation states", () => {
  it("shows actionable quality warnings through the existing alert", () => {
    mocks.trip.data!.status = "ready";
    mocks.trip.data!.itinerary = { timeZone: "Europe/Paris", routingSource: "unavailable", generatedAt: null, days: [], unscheduled: [] };
    mocks.trip.data!.quality = { valid: true, score: null, dimensions: { schedule: null, routing: null, openingHours: null, budget: null, relevance: null, workload: null, dataCompleteness: 0 }, issues: [{ code: "ADMISSION_PRICE_UNKNOWN", severity: "warning", dimension: "budget", message: "Some admission prices are unknown. Check ticket costs." }] };
    render(<Page />);
    expect(screen.getByText("Some admission prices are unknown. Check ticket costs.")).toBeTruthy();
  });
  function preferences() {
    mocks.trip.data!.status = "ready";
    mocks.trip.data!.analysis.maxWalkingDistanceKm = 7;
    mocks.trip.data!.itinerary = { timeZone: "Europe/Paris", routingSource: "unavailable", generatedAt: null, days: [], unscheduled: [] };
    const view = render(<Page />);
    const card = within(view.container.querySelector(".pref-card") as HTMLElement);
    return card;
  }
  it("shows preferences actions only for changed values and Cancel restores persisted values", () => {
    const card = preferences();
    expect(card.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(card.getByRole("button", { name: "High" }).className).toContain("is-active");
    fireEvent.click(card.getByRole("button", { name: "Food" }));
    fireEvent.click(card.getByRole("button", { name: "Low" }));
    fireEvent.click(card.getByRole("button", { name: "Relaxed" }));
    fireEvent.click(card.getByRole("button", { name: "Cancel" }));
    expect(card.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(card.getByRole("button", { name: "High" }).className).toContain("is-active");
    expect(card.getByRole("button", { name: "Balanced" }).className).toContain("is-active");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("saves preferences before generating and preserves an unchanged custom walking limit", () => {
    const card = preferences();
    fireEvent.click(card.getByRole("button", { name: "Food" }));
    fireEvent.click(card.getByRole("button", { name: "Regenerate" }));
    expect(mocks.save.mock.calls[0][0]).toEqual({ draftId: "trip-1", regenerate: true, confirmedFields: [],
      answers: { interests: ["culture", "food"], pace: "balanced" } });
    expect(mocks.mutate).not.toHaveBeenCalled();
    mocks.save.mock.calls[0][1].onSuccess();
    expect(mocks.mutate).toHaveBeenCalledWith("trip-1");
  });
  it("does not generate after a save failure and retains changes for retry", () => {
    mocks.save.mockImplementationOnce((_input, options) => options.onError(new Error("Save failed")));
    const card = preferences();
    fireEvent.click(card.getByRole("button", { name: "Low" }));
    fireEvent.click(card.getByRole("button", { name: "Regenerate" }));
    expect(mocks.save.mock.calls[0][0].answers.maxWalkingDistanceKm).toBe(3);
    expect(card.getByRole("alert").textContent).toBe("Save failed");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(card.getByRole("button", { name: "Regenerate" })).toBeTruthy();
  });
  it("starts only one generation when StrictMode replays the effects", () => {
    render(<Page />);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith("trip-1");
  });

  it("waits for trip data before automatically generating", () => {
    Object.assign(mocks.trip, { data: undefined, isPending: true });
    const view = render(<Page />);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeTruthy();
    Object.assign(mocks.trip, { data: fixture(), isPending: false });
    view.rerender(<Page />);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("shows the loading layout while the server is generating despite a local error", () => {
    mocks.trip.data!.status = "generating";
    Object.assign(mocks.generation, { isError: true, error: new ApiError("Conflict", 409) });
    const { container } = render(<Page />);
    expect(screen.getByText("Your Paris trip is taking shape")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector(".trip-skeleton-map")).toBeTruthy();
    expect(container.querySelectorAll(".trip-skeleton-stop")).toHaveLength(4);
  });

  it("keeps a retrieval error on the page and permits retry", () => {
    Object.assign(mocks.trip, { data: undefined, isError: true, error: new ApiError("Unavailable", 503) });
    render(<Page />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("shows saved generation errors with recovery actions", () => {
    mocks.trip.data!.status = "failed";
    mocks.trip.data!.generation.error = "The places service is temporarily unavailable.";
    render(<Page />);
    expect(screen.getByText("The places service is temporarily unavailable.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Adjust trip details" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
});
