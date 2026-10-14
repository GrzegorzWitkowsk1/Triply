import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProfileUser } from "@triply/shared";
import HomePage from "./HomePage";
const mocks = vi.hoisted(() => ({ user: null as ProfileUser | null, analyze: vi.fn() }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../hooks/useTrips", () => ({ useTrips: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock("../hooks/useTripAnalysis", () => ({ useAnalyzeTrip: () => ({ mutate: mocks.analyze }), useUpdateTripRequirements: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("../hooks/useTripGeneration", () => ({ useConfirmTrip: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("../hooks/useTripPlanning", () => ({ useTripPlanning: () => ({ hasStarted: false, isDone: false, statuses: [], start: vi.fn(), reset: vi.fn(), finish: vi.fn() }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "user", email: "user@example.com", preferences: { interests: ["culture", "shopping"], pace: "relaxed", maxWalkingDistanceKm: 3 } };
});
afterEach(cleanup);
const page = () => <MemoryRouter><HomePage /></MemoryRouter>;
describe("homepage profile defaults", () => {
  it("preselects all saved preferences and sends them when planning", async () => {
    render(page());
    for (const name of ["Culture & museums", "Shopping"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
    }
    fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledWith({ prompt: "", badges: ["culture", "shopping"], pace: "relaxed", maxWalkingDistanceKm: 3 }, expect.any(Object)));
  });
  it("hydrates defaults when session loads and preserves subsequent user choices", async () => {
    const user = mocks.user;
    mocks.user = null;
    const view = render(page());
    mocks.user = user;
    view.rerender(page());
    await waitFor(() => expect(screen.getByRole("button", { name: "Shopping" }).getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Shopping" }));
    mocks.user = { ...user!, preferences: { interests: ["nature"], pace: "packed", maxWalkingDistanceKm: 10 } };
    view.rerender(page());
    expect(screen.getByRole("button", { name: "Shopping" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Culture & museums" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledWith({ prompt: "", badges: ["culture"], pace: "packed", maxWalkingDistanceKm: 10 }, expect.any(Object)));
  });
});
