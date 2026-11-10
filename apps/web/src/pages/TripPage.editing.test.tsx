import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { ItineraryDay, ItineraryEditRequest, TripDetail, TripExpense } from "@triply/shared";
import TripPage from "./TripPage";
import { installTripRecovery } from "../query/recovery";

vi.mock("../components/trip/TripAssistant", () => ({ default: () => null }));
vi.mock("../components/trip/TripMap", () => ({ default: ({ stops, geometry, active, statuses, stopNames, stopIndexes, onSelect }: { stops: number[][]; geometry: number[][] | null; active: number; statuses?: string[]; stopNames?: string[]; stopIndexes?: number[]; onSelect: (index: number) => void }) =>
  <><div data-testid="map">{JSON.stringify({ stops, geometry, active, statuses })}</div>
    {statuses && stopNames?.map((name, index) => <button key={name} onClick={() => onSelect(stopIndexes?.[index] ?? index)}>Select map {name}</button>)}</> }));

const candidates = [
  { placeId: "node/1", name: "Museum", category: "culture", lat: 48.85, lng: 2.35, score: 80, scheduledDayIndex: 1 },
  { placeId: "node/2", name: "Park", category: "nature", lat: 48.86, lng: 2.36, score: 80, scheduledDayIndex: 1 },
  { placeId: "node/3", name: "Gallery", category: "culture", lat: 48.87, lng: 2.37, score: 80, scheduledDayIndex: null },
];
function day(dayIndex: number, ids: string[]): ItineraryDay {
  const places = ids.map((id) => candidates.find((place) => place.placeId === id)!);
  return { dayIndex, date: `2026-06-0${dayIndex}`, timeZone: "Europe/Paris",
    activities: places.map((place) => ({ type: "attraction", title: place.name, placeId: place.placeId,
      itineraryItemId: `00000000-0000-4000-8000-00000000000${place.placeId.slice(-1)}`,
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
let visitFailure = false;
let holdVisit = false;
let releaseVisit: (() => void) | undefined;
let visitRequests = 0;
let journeyEnabled = true;
let journeyRevision = 0;
let preferenceFailure = false;
let offerExpensePrompt = false;
let expenseFailure = false;
let budgetCurrency: string | null = null;
let budgetExpenses: TripExpense[] = [];
let budgetRevision = 0;
let automaticAmount = 0;
let automaticFailure = false;

function budgetResponse() {
  const actualMinor = budgetExpenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const totals = budgetCurrency ? [{ currency: budgetCurrency, plannedMinor: 0, actualMinor, automaticMinor: 0, manualPlannedMinor: 0 }] : [];
  return { revision: budgetRevision, expenses: budgetExpenses, summary: {
    currency: budgetCurrency, totalBudgetMinor: budgetCurrency ? 50000 : null, allocations: {}, allocationCurrency: budgetCurrency, totals, categories: [],
    days: budgetExpenses.length ? [{ dayId: "1", totals, categories: [] }] : [],
    plannedSpendingMinor: budgetCurrency ? 0 : null, actualSpendingMinor: budgetCurrency ? actualMinor : null, plannedRemainingMinor: null, actualRemainingMinor: null,
    unknownAdmissionPriceCount: 0, hasIncompletePricing: false, comparisonAvailable: Boolean(budgetCurrency),
    plannedOverBudget: false, actualOverBudget: false, warnings: [],
  } };
}

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
  journeyEnabled = true; journeyRevision = 0; preferenceFailure = false; offerExpensePrompt = false; expenseFailure = false;
  budgetCurrency = null; budgetExpenses = []; budgetRevision = 0;
  automaticAmount = 0; automaticFailure = false;
  visitFailure = false; holdVisit = false; releaseVisit = undefined; visitRequests = 0;
  trip = fixture(); edits.length = 0; editFailure = null; candidateFailure = false; holdEdit = false; releaseEdit = null;
  routingStillUnavailable = false; responseWarnings = [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/profile/preferences/journey") {
      if (init?.method === "PATCH") {
        if (preferenceFailure) return Response.json({ error: "Preference failed" }, { status: 503 });
        journeyEnabled = JSON.parse(String(init.body)).promptForExpenseAfterVisit; journeyRevision++;
      }
      return Response.json({ preferences: { promptForExpenseAfterVisit: journeyEnabled }, revision: journeyRevision });
    }
    if (input.endsWith("/expenses") && init?.method === "POST") {
      if (expenseFailure) return Response.json({ error: "Expense failed" }, { status: 503 });
      const body = JSON.parse(String(init.body));
      if (!budgetExpenses.some(expense => expense.id === body.requestId)) {
        budgetExpenses.push({ ...body.expense, id: body.requestId, createdAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z" }); budgetRevision++;
      }
      return Response.json(budgetResponse());
    }
    if (input.includes("/expenses/") && init?.method === "DELETE") {
      budgetExpenses = budgetExpenses.filter(expense => expense.id !== input.split("/expenses/")[1]); budgetRevision++;
      return Response.json(budgetResponse());
    }
    if (input.includes("/expenses/") && init?.method === "PATCH") {
      if (expenseFailure) return Response.json({ error: "Expense failed" }, { status: 503 });
      const body = JSON.parse(String(init.body));
      budgetExpenses = budgetExpenses.map(expense => expense.id === input.split("/expenses/")[1] ? { ...expense, ...body.expense } : expense);
      budgetRevision++; return Response.json(budgetResponse());
    }
    if (input.includes("/visits/")) {
      visitRequests++;
      if (holdVisit) await new Promise<void>(resolve => { releaseVisit = resolve; });
      if (visitFailure) return Response.json({ error: "Unable to save visit" }, { status: 503 });
      const itemId = input.split("/visits/")[1].split("/")[0];
      const { status } = input.endsWith("/expense/retry") ? { status: trip.visits?.find(record => record.itineraryItemId === itemId)?.status ?? "planned" } : JSON.parse(String(init?.body));
      trip.visits = (trip.visits ?? []).filter(record => record.itineraryItemId !== itemId);
      if (status !== "planned") trip.visits.push({ itineraryItemId: itemId, status, updatedAt: "2026-11-05T12:00:00Z",
        ...(status === "visited" ? { visitedAt: "2026-11-05T12:00:00Z" } : { skippedAt: "2026-11-05T12:00:00Z" }) });
      trip.visitRevision = (trip.visitRevision ?? 0) + 1;
      if (automaticAmount && status === "visited") {
        trip.pendingVisitExpenseItemIds = automaticFailure ? [itemId] : [];
        if (!automaticFailure && !budgetExpenses.some(expense => expense.itineraryItemId === itemId)) {
          budgetExpenses.push({ id: "automatic-ticket", itineraryItemId: itemId, title: "Museum", category: "attractions", amountMinor: automaticAmount, currency: "EUR", type: "actual", dayId: "1", date: "2026-06-01", attractionId: "node/1", replacesAdmission: false, note: null, createdAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z" });
          budgetRevision++;
        }
        trip.budgetData = budgetResponse();
        return Response.json({ ...structuredClone(trip), automaticExpense: automaticFailure ? { itemId, status: "failed" } : { itemId, status: "posted", amountMinor: automaticAmount, currency: "EUR" } });
      }
      return Response.json({ ...structuredClone(trip), ...(offerExpensePrompt && status === "visited" ? { expensePromptItemId: itemId } : {}) });
    }
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
    if (input.endsWith("/budget")) return Response.json(budgetResponse());
    if (input.split("?")[0] === "/api/trips/trip-1") return Response.json(structuredClone(trip));
    return Response.json([]);
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["trips", "trip-1"], structuredClone(trip));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function HistoryControls() {
  const navigate = useNavigate(); const location = useLocation();
  return <><button onClick={() => navigate(-1)}>History back</button><button onClick={() => navigate(1)}>History forward</button><output data-testid="location-search">{location.search}</output></>;
}
function renderPage(path = "/trips/trip-1", history = false) {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    {history && <HistoryControls />}
    <Routes><Route path="/trips/:id" element={<TripPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}
async function openAction(action: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Edit Museum" }));
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
}

function enableJourneyAccount() {
  offerExpensePrompt = true; budgetCurrency = "EUR";
  client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "user-1", email: "journey@example.com" } });
  client.setQueryData(["journey-preferences", "user-1"], { preferences: { promptForExpenseAfterVisit: journeyEnabled }, revision: journeyRevision });
}
const promptRegion = () => screen.queryByRole("region", { name: "Add an expense for this visit?" });

describe("tab recovery with the real Trip and Budget views", () => {
  it.each(["deleted", "malformed"])("hides cached authoritative controls when recovery reports a %s trip", async failure => {
    renderPage(); await waitFor(() => expect(client.isFetching()).toBe(0));
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => String(input).includes("snapshot=true")
      ? failure === "deleted" ? Response.json({ error: "Trip not found" }, { status: 404 }) : Response.json({ id: "trip-1", itinerary: {} })
      : original(input, init));
    const stop = installTripRecovery(client);
    try {
      window.dispatchEvent(new Event("focus"));
      await screen.findByText(failure === "deleted" ? "This trip couldn't be found" : "The server returned an invalid response. Please try again.");
      expect(screen.queryByRole("button", { name: "Edit Museum" })).toBeNull();
      if (failure === "malformed") {
        expect(client.getQueryData<TripDetail>(["trips", "trip-1"])!.itinerary!.days).toHaveLength(2);
      }
    } finally { stop(); }
  });

  it("A/C/D: focus recovers visits, editing locks, automatic expenses and Journey totals together", async () => {
    budgetCurrency = "EUR";
    renderPage();
    await screen.findByRole("button", { name: "Edit Museum" });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const initialSnapshots = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("snapshot=true")).length;
    const stop = installTripRecovery(client);
    try {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      trip.visitRevision = 1;
      const itemId = trip.itinerary!.days[0].activities[0].itineraryItemId!;
      trip.visits = [{ itineraryItemId: itemId, status: "visited", visitedAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:00:00Z" }];
      budgetExpenses = [{ id: "automatic-ticket", itineraryItemId: itemId, title: "Admission elsewhere", category: "attractions",
        amountMinor: 2500, currency: "EUR", type: "actual", date: null, dayId: "1", attractionId: "node/1", replacesAdmission: false,
        note: null, createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:00:00Z",
        automaticSource: { type: "visit_admission", itineraryItemId: itemId, unit: "per_person", participants: 1, unitAmountMinor: 2500, postedAmountMinor: 2500, currency: "EUR" } }];
      budgetRevision = 1; trip.budgetData = budgetResponse();
      window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect((screen.getByRole("button", { name: "Edit Museum" }) as HTMLButtonElement).disabled).toBe(true));
      expect((screen.getByRole("button", { name: "Reorder Museum" }) as HTMLButtonElement).disabled).toBe(true);
      await screen.findByText("Admission elsewhere");
      expect(client.getQueryData<{ revision: number; expenses: unknown[] }>(["trips", "trip-1", "budget"])).toMatchObject({ revision: 1, expenses: [expect.objectContaining({ id: "automatic-ticket" })] });
      fireEvent.click(screen.getByRole("button", { name: "Journey mode" }));
      await screen.findByRole("button", { name: "Next: Park" });
      expect(screen.getByText("Trip: €25.00")).toBeTruthy();
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("snapshot=true"))).toHaveLength(initialSnapshots + 1);
    } finally { stop(); }
  });

  it("B/C: a storage notification refreshes Budget without duplicate expenses and retains the authoritative revision", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    budgetCurrency = "EUR";
    renderPage(); await screen.findByRole("heading", { name: "Trip budget & expenses" });
    const stop = installTripRecovery(client);
    try {
      budgetExpenses = [{ id: "external", title: "External ticket", category: "attractions", amountMinor: 1200, currency: "EUR", type: "actual",
        date: null, dayId: null, attractionId: null, replacesAdmission: false, note: null, createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:00:00Z" }];
      budgetRevision = 9;
      window.dispatchEvent(new StorageEvent("storage", { key: "triply:mutable-data:v1", newValue: "nonce" }));
      await screen.findByText("External ticket");
      expect(screen.getAllByText("External ticket")).toHaveLength(1);
      expect(screen.getByLabelText("Total expenses and budget").textContent).toContain("€12.00");
      expect(client.getQueryData<{ revision: number }>(["trips", "trip-1", "budget"])!.revision).toBe(9);
    } finally { stop(); }
  });
});

describe("Plan / Journey execution", () => {
  it("corrects an automatic expense through Budget and preserves entered values on save failure", async () => {
    budgetCurrency = "EUR";
    budgetExpenses = [{ id: "automatic", itineraryItemId: trip.itinerary!.days[0].activities[0].itineraryItemId!, title: "Museum", category: "attractions", amountMinor: 6000, currency: "EUR", type: "actual", date: "2026-06-01", dayId: "1", attractionId: "node/1", replacesAdmission: false, note: null, createdAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z",
      automaticSource: { type: "visit_admission", itineraryItemId: trip.itinerary!.days[0].activities[0].itineraryItemId!, unit: "per_person", participants: 3, unitAmountMinor: 2000, postedAmountMinor: 6000, currency: "EUR" } }];
    renderPage("/trips/trip-1?mode=journey");
    fireEvent.click(await screen.findByRole("button", { name: "Correct expense for Museum" }));
    const dialog = screen.getByRole("dialog", { name: "Correct admission expense" });
    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    expect((amount as HTMLInputElement).value).toBe("60.00");
    fireEvent.change(amount, { target: { value: "45.00" } });
    expenseFailure = true;
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect((amount as HTMLInputElement).value).toBe("45.00"); expect(budgetExpenses[0].amountMinor).toBe(6000);
    expenseFailure = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(budgetExpenses[0].amountMinor).toBe(4500);
    expect(budgetExpenses[0].automaticSource?.postedAmountMinor).toBe(6000);
    expect(client.getQueryData<{ expenses: TripExpense[] }>(["trips", "trip-1", "budget"])!.expenses[0].amountMinor).toBe(4500);
  });

  it.each([6000, 8000])("shows the persisted automatic amount %s and synchronizes Budget without a manual prompt", async amount => {
    automaticAmount = amount; budgetCurrency = "EUR"; offerExpensePrompt = true;
    renderPage("/trips/trip-1?mode=journey");
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    expect(await screen.findByText(/Visited · .*added to expenses/)).toBeTruthy();
    expect(screen.queryByText("Add an expense for this visit?")).toBeNull();
    expect(budgetExpenses).toHaveLength(1);
    expect(client.getQueryData<{ expenses: TripExpense[] }>(["trips", "trip-1", "budget"])!.expenses[0].amountMinor).toBe(amount);
    expect(screen.getByRole("list", { name: "Actual expenses for Museum" }).textContent).toContain("Museum");
    fireEvent.click(screen.getByRole("button", { name: "Plan mode" }));
    expect((screen.getByRole("button", { name: "Edit Museum" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Editing locked. Reset this visit to planned to change its itinerary.")).toBeTruthy();
  });

  it("keeps a visited item after expense failure and offers a safe retry after refetch", async () => {
    automaticAmount = 6000; automaticFailure = true; budgetCurrency = "EUR";
    renderPage("/trips/trip-1?mode=journey");
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    expect(await screen.findByText(/Visit saved\. The admission expense was not recorded/)).toBeTruthy();
    expect(trip.visits?.[0].status).toBe("visited"); expect(budgetExpenses).toEqual([]);
    await client.invalidateQueries({ queryKey: ["trips", "trip-1"] });
    expect(screen.getByRole("button", { name: "Retry expense posting" })).toBeTruthy();
    automaticFailure = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry expense posting" }));
    expect(await screen.findByText(/Admission expense recorded:/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry expense posting" })).toBeNull();
    expect(trip.visits?.[0].status).toBe("visited"); expect(budgetExpenses).toHaveLength(1);
  });

  it("defaults to Plan, preserves the day and drafts, and supports Back/Forward without mutations", async () => {
    renderPage("/trips/trip-1", true);
    expect(screen.getByRole("button", { name: "Plan mode" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(await screen.findByRole("textbox", { name: "Expense name" }), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Food" }));
    const map = screen.getByTestId("map");
    fireEvent.click(screen.getByRole("tab", { name: /Day 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Journey mode" }));
    expect(await screen.findByText("A day to explore at your own pace")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Day 2/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("map")).toBe(map);
    expect(screen.queryByRole("button", { name: "Add Attraction" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plan mode" }));
    expect((screen.getByRole("textbox", { name: "Expense name" }) as HTMLInputElement).value).toBe("Keep this draft");
    expect(screen.getByRole("button", { name: "Food" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Add Attraction" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    expect(screen.getByRole("button", { name: "Journey mode" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    expect(screen.getByRole("button", { name: "Plan mode" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "History forward" }));
    expect(screen.getByRole("button", { name: "Journey mode" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("location-search").textContent).toContain("day=2");
    expect(visitRequests).toBe(0); expect(edits).toEqual([]); expect(budgetExpenses).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /places|itinerary\/candidates|regenerate/.test(String(url)))).toBe(false);
  });

  it("visits, skips and resets through existing mutations, synchronizing next stop, map and Plan", async () => {
    journeyEnabled = false; enableJourneyAccount(); renderPage("/trips/trip-1?mode=journey");
    expect(await screen.findByRole("button", { name: "Next: Museum" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark Museum as visited" }));
    expect(await screen.findByRole("button", { name: "Next: Park" })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("map").textContent!).statuses).toEqual(["visited", "planned"]);
    expect(screen.getByRole("progressbar", { name: "Trip progress" }).getAttribute("value")).toBe("50");
    expect(promptRegion()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark Park as skipped" }));
    expect(await screen.findByText("No planned places remaining for this day.")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Trip progress" }).getAttribute("value")).toBe("50");
    fireEvent.click(screen.getByRole("button", { name: "Reset Museum to planned" }));
    expect(await screen.findByRole("button", { name: "Next: Museum" })).toBeTruthy();
    await client.invalidateQueries({ queryKey: ["trips", "trip-1"] }); expect(promptRegion()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plan mode" }));
    expect(screen.getByRole("button", { name: "Mark Museum as visited" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset Park to planned" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Museum" })).toBeTruthy(); expect(budgetExpenses).toHaveLength(0);
  });

  it("keeps visit errors visible in Journey without changing progress", async () => {
    visitFailure = true; renderPage("/trips/trip-1?mode=journey");
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    expect(await screen.findByText("Visit status could not be saved. Try again.")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Trip progress" }).getAttribute("value")).toBe("0");
    expect(screen.getByRole("button", { name: "Next: Museum" })).toBeTruthy(); expect(promptRegion()).toBeNull();
  });

  it("reuses the expense prompt and Budget form, reflects actual expense updates/deletion, and never posts estimates", async () => {
    enableJourneyAccount(); renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Journey mode" })); expect(promptRegion()).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    const prompt = await screen.findByRole("region", { name: "Add an expense for this visit?" });
    expect(budgetExpenses).toEqual([]);
    fireEvent.click(within(prompt).getByRole("button", { name: "Add expense" }));
    await waitFor(() => expect((screen.getByLabelText("Expense name") as HTMLInputElement).value).toBe("Museum"));
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Trip: €12.50")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Actual expenses for Museum" })).getByText("€12.50")).toBeTruthy();
    budgetExpenses[0].amountMinor = 2000; budgetRevision++;
    await client.invalidateQueries({ queryKey: ["trips", "trip-1", "budget"] });
    expect(await screen.findByText("Trip: €20.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Museum" }));
    expect(await screen.findByText("Trip: €0.00")).toBeTruthy(); expect(screen.queryByRole("list", { name: "Actual expenses for Museum" })).toBeNull();
    expect(trip.visits![0].status).toBe("visited");
  });

  it("supports mobile keyboard mode switching and bidirectional list/map selection", async () => {
    vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ matches: media === "(max-width: 1023px)", media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
    const view = renderPage();
    const toggle = screen.getByRole("button", { name: "Plan mode" }); toggle.focus(); fireEvent.keyDown(toggle, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Journey mode" }));
    expect(view.container.querySelector<HTMLElement>("#trip-map-panel")?.hidden).toBe(false);
    expect(view.container.querySelector<HTMLElement>(".trip-left")?.hidden).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Select map Park" }));
    expect(screen.getByRole("button", { name: /Park.*09:00/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Museum.*09:00/ }));
    expect(JSON.parse(screen.getByTestId("map").textContent!).active).toBe(0);
    expect(screen.queryByRole("button", { name: "Edit Museum" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerate Day" })).toBeNull();
  });

  it("explains missing itineraries and preserves normal Plan generation actions", async () => {
    trip.status = "draft"; trip.itinerary = null; client.setQueryData(["trips", "trip-1"], structuredClone(trip));
    renderPage("/trips/trip-1?mode=journey");
    expect(await screen.findByText("Generate an itinerary in Plan mode before starting your Journey.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate my trip" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plan mode" }));
    expect(screen.getByRole("button", { name: "Generate my trip" })).toBeTruthy();
  });

  it("allows guest visit tracking without fetching authenticated preferences or opening an expense prompt", async () => {
    client.setQueryData(["auth", "session"], { status: "guest", guest: { id: "guest", expiresAt: "2030-01-01" } });
    renderPage("/trips/trip-1?mode=journey"); fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    expect(await screen.findByRole("button", { name: "Next: Park" })).toBeTruthy(); expect(promptRegion()).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/profile/"))).toBe(false);
  });
});

describe("Journey optional expenses", () => {
  it("opens the existing expense form on mobile while keeping the timeline controls usable", async () => {
    vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ matches: media === "(max-width: 1023px)", media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
    enableJourneyAccount(); const view = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    const prompt = await screen.findByRole("region", { name: "Add an expense for this visit?" });
    fireEvent.click(within(prompt).getByRole("button", { name: "Add expense" }));
    await waitFor(() => expect((screen.getByLabelText("Expense name") as HTMLInputElement).value).toBe("Museum"));
    expect(view.container.querySelector<HTMLElement>(".trip-secondary-panels")?.hidden).toBe(false);
    expect(screen.getByRole("button", { name: "Edit Museum" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Amount"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("waits for persisted visited status, then opens the existing form with a blank actual amount", async () => {
    enableJourneyAccount(); holdVisit = true;
    trip.itinerary!.days[0].stops[0].admission = { status: "paid", price: { amountMinor: 9900, currency: "EUR", fractionDigits: 2, priceType: "general", unit: "per_person" },
      source: "osm", sourceUrl: null, checkedAt: null, retrievedAt: null, rawFee: null, rawCharge: null, rawFeeConditional: null, rawChargeConditional: null, rawCurrency: null, menuUrl: null, notes: null };
    client.setQueryData(["trips", "trip-1"], structuredClone(trip)); renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    await waitFor(() => expect(visitRequests).toBe(1)); expect(promptRegion()).toBeNull();
    releaseVisit!();
    const prompt = await screen.findByRole("region", { name: "Add an expense for this visit?" });
    expect(within(prompt).getByText(/You visited Museum/)).toBeTruthy();
    expect(client.getQueryData<TripDetail>(["trips", "trip-1"])!.visits?.[0].status).toBe("visited");
    fireEvent.click(within(prompt).getByRole("button", { name: "Add expense" }));
    expect(promptRegion()).toBeNull();
    await waitFor(() => expect((screen.getByLabelText("Expense name") as HTMLInputElement).value).toBe("Museum"));
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
    expect(budgetExpenses).toEqual([]);
    expect((screen.getByLabelText("Spending date") as HTMLInputElement).value).toBe("2026-06-01");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Expense saved.")).toBeTruthy();
    expect(budgetExpenses).toHaveLength(1);
    expect(budgetExpenses[0]).toMatchObject({ title: "Museum", amountMinor: 1250, currency: "EUR", category: "attractions", type: "actual", dayId: "1", date: "2026-06-01", itineraryItemId: trip.itinerary!.days[0].activities[0].itineraryItemId });
    expect(client.getQueryData<{ revision: number }>(["trips", "trip-1", "budget"])!.revision).toBe(1);
    expect(screen.getByLabelText("Total expenses and budget").textContent).toContain("12.50");
    expect(trip.visits![0].status).toBe("visited");
  });

  it("keeps the visit and form values after expense failure and retries with the same UUID", async () => {
    enableJourneyAccount(); expenseFailure = true; renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    const prompt = await screen.findByRole("region", { name: "Add an expense for this visit?" });
    fireEvent.click(within(prompt).getByRole("button", { name: "Add expense" }));
    await waitFor(() => expect((screen.getByLabelText("Expense name") as HTMLInputElement).value).toBe("Museum"));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeTruthy();
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("12.50");
    expect(trip.visits![0].status).toBe("visited");
    const posts = () => vi.mocked(fetch).mock.calls.filter(([url, options]) => String(url).endsWith("/expenses") && options?.method === "POST");
    const first = JSON.parse(String(posts()[0][1]?.body)).requestId;
    expenseFailure = false; fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Expense saved.")).toBeTruthy();
    expect(JSON.parse(String(posts()[1][1]?.body)).requestId).toBe(first); expect(budgetExpenses).toHaveLength(1);
  });

  it("suppresses prompts for skipped, repeated visited, refetch, remount, and undo/revisit", async () => {
    enableJourneyAccount(); const view = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as skipped" }));
    await screen.findByText("Visited 0/2 (0%) · Skipped 1 · Remaining 1"); expect(promptRegion()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark Museum as visited" }));
    const prompt = await screen.findByRole("region", { name: "Add an expense for this visit?" });
    fireEvent.click(within(prompt).getByRole("button", { name: "Not now" })); expect(promptRegion()).toBeNull();
    await client.invalidateQueries({ queryKey: ["trips", "trip-1"] }); expect(promptRegion()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset Museum to planned" }));
    await screen.findByText("Visited 0/2 (0%) · Skipped 0 · Remaining 2");
    fireEvent.click(screen.getByRole("button", { name: "Mark Museum as visited" }));
    await screen.findByText("Visited 1/2 (50%) · Skipped 0 · Remaining 1"); expect(promptRegion()).toBeNull();
    view.unmount(); renderPage(); await screen.findByText("Visited 1/2 (50%) · Skipped 0 · Remaining 1"); expect(promptRegion()).toBeNull();
  });

  it("keeps manual creation available when prompts are disabled", async () => {
    journeyEnabled = false; enableJourneyAccount(); renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    await screen.findByText("Visited 1/2 (50%) · Skipped 0 · Remaining 1"); expect(promptRegion()).toBeNull();
    fireEvent.change(screen.getByLabelText("Expense name"), { target: { value: "Manual lunch" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Expense saved.")).toBeTruthy(); expect(budgetExpenses[0].itineraryItemId).toBeUndefined();
  });

  it.each(["Add expense", "Not now"])("saves Don't ask again only after explicitly selecting %s", async action => {
    enableJourneyAccount(); renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    const prompt = await screen.findByRole("region", { name: "Add an expense for this visit?" });
    fireEvent.click(within(prompt).getByRole("checkbox", { name: "Don't ask again. I'll add expenses manually." }));
    expect(journeyEnabled).toBe(true);
    fireEvent.click(within(prompt).getByRole("button", { name: action }));
    await waitFor(() => expect(journeyEnabled).toBe(false)); expect(journeyRevision).toBe(1);
  });

  it("dismisses a checked prompt without saving a preference", async () => {
    enableJourneyAccount(); renderPage(); fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    const prompt = await screen.findByRole("region", { name: "Add an expense for this visit?" });
    fireEvent.click(within(prompt).getByRole("checkbox")); fireEvent.click(within(prompt).getByRole("button", { name: "Dismiss" }));
    expect(promptRegion()).toBeNull(); expect(journeyEnabled).toBe(true); expect(journeyRevision).toBe(0);
  });

  it("reports a preference failure while independently opening the expense form", async () => {
    enableJourneyAccount(); preferenceFailure = true; renderPage(); fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    const prompt = await screen.findByRole("region", { name: "Add an expense for this visit?" });
    fireEvent.click(within(prompt).getByRole("checkbox")); fireEvent.click(within(prompt).getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText(/Could not save or load your Journey preference/)).toBeTruthy();
    expect(journeyEnabled).toBe(true); expect(trip.visits![0].status).toBe("visited");
    expect((screen.getByLabelText("Expense name") as HTMLInputElement).value).toBe("Museum");
  });

  it("does not prompt when persisting a visit fails", async () => {
    enableJourneyAccount(); visitFailure = true; renderPage(); fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    await screen.findByText("Visit status could not be saved. Try again."); expect(promptRegion()).toBeNull();
  });
});

describe("TripPage manual editing", () => {
  it("marks visited, skipped and planned through the API and synchronizes daily progress and cache", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Museum as visited" }));
    expect(await screen.findByText("Visited 1/2 (50%) · Skipped 0 · Remaining 1")).toBeTruthy();
    expect(client.getQueryData<TripDetail>(["trips", "trip-1"])!.visits?.[0].status).toBe("visited");
    fireEvent.click(screen.getByRole("button", { name: "Mark Museum as skipped" }));
    expect(await screen.findByText("Visited 0/2 (0%) · Skipped 1 · Remaining 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset Museum to planned" }));
    expect(await screen.findByText("Visited 0/2 (0%) · Skipped 0 · Remaining 2")).toBeTruthy();
    expect(client.getQueryData<TripDetail>(["trips", "trip-1"])!.visits).toEqual([]);
    expect(screen.getByRole("button", { name: "Edit Museum" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reorder Museum" })).toBeTruthy();
    expect(edits).toEqual([]);
  });

  it("disables double submissions and keeps confirmed state when a visit mutation fails", async () => {
    visitFailure = true; holdVisit = true;
    renderPage();
    const button = await screen.findByRole("button", { name: "Mark Museum as visited" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(visitRequests).toBe(1));
    expect(await screen.findByText("Saving visit status…")).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    releaseVisit!();
    expect(await screen.findByText("Visit status could not be saved. Try again.")).toBeTruthy();
    expect(screen.getByText("Visited 0/2 (0%) · Skipped 0 · Remaining 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Museum" })).toBeTruthy();
    expect(client.getQueryData<TripDetail>(["trips", "trip-1"])!.visits ?? []).toEqual([]);
  });

  it("shows a neutral progress state for an empty day", async () => {
    trip.itinerary!.days[0] = day(1, []);
    client.setQueryData(["trips", "trip-1"], structuredClone(trip));
    renderPage();
    expect(await screen.findByText("No places to visit this day")).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByRole("button", { name: "Add Attraction" })).toBeTruthy();
  });
  it("preserves selection, the map node and expense drafts across mobile Plan/Map switching", async () => {
    vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ matches: media === "(max-width: 1023px)", media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
    const view = renderPage();
    const selected = await screen.findByRole("button", { name: /Park.*Nature/ });
    fireEvent.click(selected);
    fireEvent.change(screen.getByRole("textbox", { name: "Expense name" }), { target: { value: "Keep my draft" } });
    const map = screen.getByTestId("map");
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(view.container.querySelector<HTMLElement>(".trip-left")?.hidden).toBe(true);
    expect(screen.getByTestId("map")).toBe(map);
    expect(JSON.parse(map.textContent!).active).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByRole("textbox", { name: "Expense name" }).getAttribute("value")).toBe("Keep my draft");
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(edits).toHaveLength(0);
  });
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
      stops: [[48.85, 2.35], [48.86, 2.36]], geometry: [[48.85, 2.35], [48.86, 2.36]], active: 0, statuses: ["planned", "planned"],
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
      stops: [[48.86, 2.36], [48.85, 2.35]], geometry: [[48.86, 2.36], [48.85, 2.35]], active: 1, statuses: ["planned", "planned"],
    });
  });
  it("adds from the picker and updates timeline, markers, route and cached version", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add Attraction" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("button", { name: /Gallery/ });
    const options = dialog.querySelectorAll<HTMLButtonElement>(".itinerary-picker-results > button");
    expect(Array.from(options, option => option.querySelector(".activity-name")?.textContent)).toEqual(["Gallery", "Museum", "Park"]);
    expect(Array.from(options, option => option.disabled)).toEqual([false, true, true]);
    expect(screen.queryByRole("link", { name: "View expenses" })).toBeNull();
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
    expect(map).toEqual({ stops: [[48.86, 2.36]], geometry: null, active: -1, statuses: ["planned"] });
    expect(edits[0].operation).toEqual({ type: "remove", dayIndex: 1, attractionId: "node/1" });
  });

  it("reuses the picker for replacement and retains the original position", async () => {
    renderPage();
    await openAction("Replace attraction");
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("button", { name: /Gallery/ });
    const options = dialog.querySelectorAll<HTMLButtonElement>(".itinerary-picker-results > button");
    expect(Array.from(options, option => option.querySelector(".activity-name")?.textContent)).toEqual(["Gallery", "Museum", "Park"]);
    expect(Array.from(options, option => option.disabled)).toEqual([false, true, true]);
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
    if (failure.status === 409) await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).split("?")[0] === "/api/trips/trip-1").length).toBeGreaterThan(0));
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
