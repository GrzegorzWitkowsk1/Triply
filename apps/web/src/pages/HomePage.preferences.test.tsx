import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { findDestination, type ProfileUser } from "@triply/shared";
import HomePage from "./HomePage";
const mocks = vi.hoisted(() => ({ user: null as ProfileUser | null, analyze: vi.fn() }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../hooks/useGuestUsage", () => ({ useGuestUsage: () => ({ isGuest: false }) }));
vi.mock("../hooks/useTrips", () => ({ useTrips: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock("../hooks/useTripAnalysis", () => ({ useAnalyzeTrip: () => ({ mutate: mocks.analyze }), useUpdateTripRequirements: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("../hooks/useTripGeneration", () => ({ useConfirmTrip: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("../hooks/useTripPlanning", () => ({ useTripPlanning: () => ({ hasStarted: false, isDone: false, statuses: [], start: vi.fn(), reset: vi.fn(), finish: vi.fn() }) }));
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(findDestination("city-003")))));
  vi.clearAllMocks();
  mocks.user = { id: "user", email: "user@example.com", preferences: { interests: ["culture", "shopping"], pace: "relaxed", maxWalkingDistanceKm: 3 } };
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const page = () => <QueryClientProvider client={client}><MemoryRouter><HomePage /></MemoryRouter></QueryClientProvider>;
describe("homepage profile defaults", () => {
  it("prefills a saved destination without invoking AI and submits its canonical ID", async () => {
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: "/home", state: { destinationId: "city-003" } }]}><HomePage /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Plan a trip to Barcelona, Spain"));
    expect(mocks.analyze).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ destinationId: "city-003" }), expect.any(Object));
  });
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
