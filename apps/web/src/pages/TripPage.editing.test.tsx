import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItineraryDay, ItineraryEditRequest, TripDetail } from "@triply/shared";
import TripPage from "./TripPage";

vi.mock("../components/trip/TripAssistant", () => ({ default: () => null }));
vi.mock("../components/trip/TripMap", () => ({ default: ({ stops, geometry, active }: { stops: number[][]; geometry: number[][] | null; active: number }) =>
  <div data-testid="map">{JSON.stringify({ stops, geometry, active })}</div> }));

const candidates = [
  { placeId: "node/1", name: "Museum", category: "culture", lat: 48.85, lng: 2.35, score: 80, scheduledDayIndex: 1 },
  { placeId: "node/2", name: "Park", category: "nature", lat: 48.86, lng: 2.36, score: 80, scheduledDayIndex: 1 },
  { placeId: "node/3", name: "Gallery", category: "culture", lat: 48.87, lng: 2.37, score: 80, scheduledDayIndex: null },
];
function day(dayIndex: number, ids: string[]): ItineraryDay {
  const places = ids.map((id) => candidates.find((place) => place.placeId === id)!);
  return { dayIndex, date: `2026-06-0${dayIndex}`, timeZone: "Europe/Paris",
    activities: places.map((place) => ({ type: "attraction", title: place.name, placeId: place.placeId,
      startTime: "2026-06-01T09:00:00+02:00", endTime: "2026-06-01T09:30:00+02:00", durationMinutes: 30 })),
    stops: places.map(({ scheduledDayIndex: _scheduled, ...place }) => place),
    geometry: ids.length > 1 ? { type: "LineString", coordinates: places.map((place) => [place.lng, place.lat]) } : null,
    segments: [], totalDistanceMeters: 0, totalTravelMinutes: 0, totalVisitMinutes: places.length * 30,
    partiallyEstimated: false, warnings: [] };
}
function fixture(): TripDetail {
  return { id: "trip-1", draftId: "trip-1", status: "ready", prompt: "Paris", badges: [], itineraryVersion: 3,
    analysis: { destination: "Paris", country: "France", startDate: "2026-06-01", endDate: "2026-06-02", durationDays: 2,
      travelers: 1, budget: { amount: null, currency: null, type: null }, interests: ["culture"],
      pace: "balanced", maxWalkingDistanceKm: null, notes: null, location: { lat: 48.85, lng: 2.35 } },
    missingFields: [], requirementsComplete: true, equipment: [], weather: [],
    generation: { startedAt: null, generatedAt: null, error: null }, fixtureKey: null, createdAt: null, updatedAt: null,
    itinerary: { timeZone: "Europe/Paris", routingSource: "provider", generatedAt: null,
      days: [day(1, ["node/1", "node/2"]), day(2, [])], unscheduled: [] } };
}
const edits: ItineraryEditRequest[] = [];
let trip: TripDetail;
let client: QueryClient;
let editFailure: { status: number; body: { error: string; warnings?: string[] } } | null;
let candidateFailure = false;
let holdEdit = false;
let releaseEdit: (() => void) | null;
let routingStillUnavailable: boolean;
let responseWarnings: string[];

function apply(request: ItineraryEditRequest) {
  const operation = request.operation;
  const days = trip.itinerary!.days;
  const ids = (index: number) => days.find((entry) => entry.dayIndex === index)!.stops.map((stop) => stop.placeId!);
  const replaceDay = (index: number, values: string[]) => { days[days.findIndex((entry) => entry.dayIndex === index)] = day(index, values); };
  if (operation.type === "add") { const values = ids(operation.dayIndex); values.splice(operation.position ?? values.length, 0, operation.attractionId); replaceDay(operation.dayIndex, values); }
  if (operation.type === "remove") replaceDay(operation.dayIndex, ids(operation.dayIndex).filter((id) => id !== operation.attractionId));
  if (operation.type === "replace") replaceDay(operation.dayIndex, ids(operation.dayIndex).map((id) => id === operation.oldAttractionId ? operation.newAttractionId : id));
  if (operation.type === "reorder") replaceDay(operation.dayIndex, operation.attractionIds);
  if (operation.type === "reroute") {
    replaceDay(operation.dayIndex, ids(operation.dayIndex));
    if (routingStillUnavailable) days.find((entry) => entry.dayIndex === operation.dayIndex)!.geometry = null;
  }
  if (operation.type === "move") {
    replaceDay(operation.sourceDayIndex, ids(operation.sourceDayIndex).filter((id) => id !== operation.attractionId));
    const values = ids(operation.targetDayIndex); values.splice(operation.position ?? values.length, 0, operation.attractionId); replaceDay(operation.targetDayIndex, values);
  }
  trip.itineraryVersion = (trip.itineraryVersion ?? 0) + 1;
  return { trip: structuredClone(trip), itineraryVersion: trip.itineraryVersion, affectedDayIndices: [], warnings: responseWarnings };
}
beforeEach(() => {
  trip = fixture(); edits.length = 0; editFailure = null; candidateFailure = false; holdEdit = false; releaseEdit = null;
  routingStillUnavailable = false; responseWarnings = [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input.endsWith("/itinerary/edit")) {
      const request = JSON.parse(String(init?.body)) as ItineraryEditRequest;
      edits.push(request);
      if (holdEdit) await new Promise<void>((resolve) => { releaseEdit = resolve; });
      return editFailure ? new Response(JSON.stringify(editFailure.body), { status: editFailure.status }) : Response.json(apply(request));
    }
    if (input.endsWith("/itinerary/candidates")) {
      if (candidateFailure) return new Response(JSON.stringify({ error: "Search unavailable" }), { status: 503 });
      return Response.json({ candidates, warnings: [] });
    }
    if (input.endsWith("/budget")) return Response.json({ revision: 0, expenses: [], summary: {
      currency: null, totalBudgetMinor: null, allocations: {}, allocationCurrency: null, totals: [], categories: [], days: [],
      plannedSpendingMinor: null, actualSpendingMinor: null, plannedRemainingMinor: null, actualRemainingMinor: null,
      unknownAdmissionPriceCount: 0, hasIncompletePricing: false, comparisonAvailable: false,
      plannedOverBudget: false, actualOverBudget: false, warnings: [],
    } });
    if (input === "/api/trips/trip-1") return Response.json(structuredClone(trip));
    return Response.json([]);
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["trips", "trip-1"], structuredClone(trip));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function renderPage() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/trips/trip-1"]}>
    <Routes><Route path="/trips/:id" element={<TripPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}
async function openAction(action: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Edit Museum" }));
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
}

describe("TripPage manual editing", () => {
  it("keeps removal available for an unresolved visit and refreshes with remaining warnings", async () => {
    trip.itinerary!.days[0].activities[0] = { ...trip.itinerary!.days[0].activities[0], startTime: "", endTime: "", schedulingStatus: "unresolved" };
    trip.itinerary!.days[0].warnings = ["Schedule unresolved."];
    client.setQueryData(["trips", "trip-1"], structuredClone(trip));
    responseWarnings = ["Park has unconfirmed opening hours; its availability cannot be verified."];
    renderPage();
    expect(await screen.findByText("Unresolved")).toBeTruthy();
    await openAction("Remove attraction");
    await screen.findByText("Saved. Review this day's schedule before continuing.");
    expect(edits[0]).toEqual({ expectedVersion: 3, operation: { type: "remove", dayIndex: 1, attractionId: "node/1" } });
    expect(screen.queryByRole("button", { name: "Edit Museum" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Edit Park" })).toBeTruthy();
  });
  function unavailableRoute() {
    trip.itinerary!.days[0].geometry = null;
    client.setQueryData(["trips", "trip-1"], structuredClone(trip));
  }

  it("shows retry next to missing geometry, recalculates the selected day, and updates the map", async () => {
    unavailableRoute();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByText("Itinerary saved.");
    expect(edits[0]).toEqual({ expectedVersion: 3, operation: { type: "reroute", dayIndex: 1 } });
    expect(JSON.parse(screen.getByTestId("map").textContent!)).toEqual({
      stops: [[48.85, 2.35], [48.86, 2.36]], geometry: [[48.85, 2.35], [48.86, 2.36]], active: 0,
    });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Day 1 of 2")).toBeTruthy();
  });

  it("hides routing retry for existing geometry and empty days", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Next day" });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows loading and prevents repeated retry requests until persistence completes", async () => {
    unavailableRoute(); holdEdit = true;
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    const pending = await screen.findByRole("button", { name: "Retrying…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);
    expect(edits).toHaveLength(1);
    expect(JSON.parse(screen.getByTestId("map").textContent!).geometry).toBeNull();
    await waitFor(() => expect(releaseEdit).not.toBeNull());
    releaseEdit!();
    await screen.findByText("Itinerary saved.");
  });

  it("keeps retry available and explains when routing is still unavailable", async () => {
    unavailableRoute(); routingStillUnavailable = true;
    responseWarnings = ["Routing is unavailable. Travel distance and time are estimates. Route geometry is unavailable."];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByText(/Route geometry is still unavailable. You can retry again./);
    expect((screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(false);
    expect(JSON.parse(screen.getByTestId("map").textContent!).geometry).toBeNull();
    expect(screen.getByRole("alert").textContent).not.toContain(";");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(edits).toHaveLength(2));
    expect(edits[1].expectedVersion).toBe(4);
  });

  it.each([503, 409])("handles retry failures and version conflicts without changing the map (%s)", async (status) => {
    unavailableRoute(); editFailure = { status, body: { error: status === 409 ? "The itinerary has changed. Refresh it and try again." : "Network unavailable" } };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByText(editFailure.status === 409 ? "This data changed in another session. Refresh and try again." : "Something went wrong. Please try again.");
    expect(JSON.parse(screen.getByTestId("map").textContent!).geometry).toBeNull();
    expect(JSON.parse(screen.getByTestId("map").textContent!).stops).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("persists a keyboard drag reorder and keeps selection on the same attraction as markers reorder", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = Number(this.closest("[data-stop]")?.getAttribute("data-stop") ?? 0);
      return new DOMRect(0, index * 200, 400, 150);
    });
    renderPage();
    const handle = await screen.findByRole("button", { name: "Reorder Museum" });
    handle.focus();
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await waitFor(() => expect(handle.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(document, { key: "ArrowDown", code: "ArrowDown" });
    await screen.findByText("Museum moved to position 2 of 2.");
    fireEvent.keyDown(document, { key: " ", code: "Space" });
    await screen.findByText("Itinerary saved.");
    expect(edits[0]).toEqual({ expectedVersion: 3, operation: { type: "reorder", dayIndex: 1, attractionIds: ["node/2", "node/1"] } });
    expect(JSON.parse(screen.getByTestId("map").textContent!)).toEqual({
      stops: [[48.86, 2.36], [48.85, 2.35]], geometry: [[48.86, 2.36], [48.85, 2.35]], active: 1,
    });
  });
  it("adds from the picker and updates timeline, markers, route and cached version", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add Attraction" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Search attractions"), { target: { value: "Gallery" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Gallery/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add attraction" }));
    await screen.findByText("Itinerary saved.");
    expect(edits).toEqual([{ expectedVersion: 3, operation: { type: "add", dayIndex: 1, attractionId: "node/3", position: 2 } }]);
    expect(await screen.findByRole("button", { name: /Gallery.*Culture/ })).toBeTruthy();
    const map = JSON.parse(screen.getByTestId("map").textContent!);
    expect(map.stops).toEqual([[48.85, 2.35], [48.86, 2.36], [48.87, 2.37]]);
    expect(map.geometry).toHaveLength(3);
    expect(client.getQueryData<TripDetail>(["trips", "trip-1"])?.itineraryVersion).toBe(4);
  });

  it("removes a selected attraction, clears its selection and missing route geometry", async () => {
    renderPage();
    await openAction("Remove attraction");
    await screen.findByText("Itinerary saved.");
    expect(screen.queryByRole("button", { name: /Museum.*Culture/ })).toBeNull();
    const map = JSON.parse(screen.getByTestId("map").textContent!);
    expect(map).toEqual({ stops: [[48.86, 2.36]], geometry: null, active: -1 });
    expect(edits[0].operation).toEqual({ type: "remove", dayIndex: 1, attractionId: "node/1" });
  });

  it("reuses the picker for replacement and retains the original position", async () => {
    renderPage();
    await openAction("Replace attraction");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: /Gallery/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace attraction" }));
    await screen.findByText("Itinerary saved.");
    expect(edits[0].operation).toEqual({ type: "replace", dayIndex: 1, oldAttractionId: "node/1", newAttractionId: "node/3" });
    expect(JSON.parse(screen.getByTestId("map").textContent!).stops).toEqual([[48.87, 2.37], [48.86, 2.36]]);
  });

  it("moves to an empty day, preserves selected day, and refreshes the destination on navigation", async () => {
    renderPage();
    await openAction("Move to another day");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Move attraction" }));
    await screen.findByText("Itinerary saved.");
    expect(screen.getByText("Day 1 of 2")).toBeTruthy();
    expect(edits[0].operation).toEqual({ type: "move", sourceDayIndex: 1, targetDayIndex: 2, attractionId: "node/1", position: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "Next day" }));
    expect(await screen.findByRole("button", { name: /Museum.*Culture/ })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("map").textContent!).stops).toEqual([[48.85, 2.35]]);
  });

  it("waits for persistence before showing success or changing the map", async () => {
    holdEdit = true;
    renderPage();
    await openAction("Remove attraction");
    await screen.findByText("Saving itinerary…");
    expect(screen.queryByText("Itinerary saved.")).toBeNull();
    expect(JSON.parse(screen.getByTestId("map").textContent!).stops).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Add Attraction" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(releaseEdit).not.toBeNull());
    releaseEdit!();
    await screen.findByText("Itinerary saved.");
  });

  it.each([
    { status: 503, body: { error: "Network unavailable" } },
    { status: 409, body: { error: "The itinerary has changed. Refresh it and try again." } },
    { status: 422, body: { error: "No changes were saved.", warnings: ["Gallery cannot fit inside the day."] } },
  ])("shows failures without changing timeline or map (%s)", async (failure) => {
    editFailure = failure;
    renderPage();
    await openAction("Remove attraction");
    await screen.findByText(failure.status === 409 ? "This data changed in another session. Refresh and try again." : failure.status === 422 ? "Check the entered values and try again." : "Something went wrong. Please try again.");
    expect(await screen.findByRole("button", { name: /Museum.*Culture/ })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("map").textContent!).stops).toHaveLength(2);
    expect(screen.queryByText("Itinerary saved.")).toBeNull();
    if (failure.status === 409) await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === "/api/trips/trip-1").length).toBeGreaterThan(0));
  });

  it("searches candidate metadata, prevents selecting scheduled places and discovers more", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add Attraction" }));
    const dialog = await screen.findByRole("dialog");
    const museum = await within(dialog).findByRole("button", { name: /Museum/ });
    expect((museum as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Search attractions"), { target: { value: "nature" } });
    expect(within(dialog).queryByRole("button", { name: /Gallery/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Park/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Search more nearby attractions" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => String(init?.body).includes('"discover":true'))).toBe(true));
  });

  it("shows candidate loading and errors with retry", async () => {
    candidateFailure = true;
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add Attraction" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Something went wrong. Please try again.");
    candidateFailure = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(await within(dialog).findByRole("button", { name: /Gallery/ })).toBeTruthy();
  });

  it("supports adding to an empty selected day", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Next day" }));
    expect(screen.getByText("No activities were scheduled for this day.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Attraction" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: /Gallery/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add attraction" }));
    await screen.findByText("Itinerary saved.");
    expect(edits[0].operation).toEqual({ type: "add", dayIndex: 2, attractionId: "node/3", position: 0 });
    expect(screen.getByText("Day 2 of 2")).toBeTruthy();
  });
});
vi.mock("../components/ToastProvider", () => ({ useToast: () => vi.fn() }));
