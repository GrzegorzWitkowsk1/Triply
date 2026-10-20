import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { findDestination, type TripAnalysisResult } from "@triply/shared";
import HomePage from "./HomePage";
import ExploreDestinationCard from "../components/ExploreDestinationCard";
import { destinationReference } from "../hooks/useDestinationPrefill";

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), update: vi.fn(), confirm: vi.fn(), guest: false }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ user: null, guest: mocks.guest ? { id: "g" } : null, status: mocks.guest ? "guest" : "authenticated" }) }));
vi.mock("../hooks/useGuestUsage", () => ({ useGuestUsage: () => ({ isGuest: mocks.guest, data: { tripCount: 0, tripLimit: 6, maxTripDays: 7, aiGenerationsRemaining: 2 } }) }));
vi.mock("../hooks/useTrips", () => ({ useTrips: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock("../hooks/useTripAnalysis", () => ({ useAnalyzeTrip: () => ({ mutate: mocks.analyze }), useUpdateTripRequirements: () => ({ mutate: mocks.update }) }));
vi.mock("../hooks/useTripGeneration", () => ({ useConfirmTrip: () => ({ mutate: mocks.confirm, isPending: false }) }));
vi.mock("../hooks/useTripPlanning", () => ({ useTripPlanning: () => ({ hasStarted: false, isDone: false, statuses: [], start: vi.fn(), reset: vi.fn(), finish: vi.fn() }) }));
const result: TripAnalysisResult = { draftId: "draft", analysis: { destinationId: "city-003", destination: "Barcelona", country: "Spain", startDate: "2030-06-02", endDate: "2030-06-04", durationDays: 3, travelers: 1, budget: { amount: 500, currency: "EUR", type: "total" }, interests: ["food"], pace: "relaxed", maxWalkingDistanceKm: 5, notes: null, location: null }, missingFields: [], requirementsComplete: true };
let client: QueryClient;
let fail = 0;
let defer = false;
let release: (() => void) | undefined;
function Probe() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output data-testid="url">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate("/home?destinationId=city-005")}>Open Rome</button><button onClick={() => navigate("/home?destinationId=bad")}>Open invalid link</button><button onClick={() => navigate("/home?destinationId=city-003&collection=food-first-weekends")}>Open food collection</button></>;
}
function mount(path = "/home?destinationId=city-003") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetcher = vi.fn(async (path: string) => {
    if (path.includes("/saved")) return new Response(JSON.stringify({ destinationIds: [] }));
    if (defer) await new Promise<void>(resolve => { release = resolve; });
    if (fail) return new Response("{}", { status: fail });
    return new Response(JSON.stringify(findDestination(path.split("/").at(-1)!)));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Probe /><Routes>
    <Route path="/home" element={<HomePage />} />
    <Route path="/explore" element={<ExploreDestinationCard destination={findDestination("city-003")!} onOpen={vi.fn()} />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return fetcher;
}
beforeEach(() => { vi.clearAllMocks(); mocks.guest = false; });
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); fail = 0; defer = false; release = undefined; });
const prompt = () => screen.getByRole("textbox", { name: "Describe your trip" });
const ready = () => waitFor(() => expect(prompt()).toHaveValue("Plan a trip to Barcelona, Spain"));
it.each([false, true])("prefills the existing wizard with no AI or creation request (guest=%s)", async guest => {
  mocks.guest = guest; const fetcher = mount(); await ready();
  expect(screen.getByText(/Selected destination: Barcelona, Spain/)).toBeVisible();
  expect(mocks.analyze).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![0]).toBe("/api/destinations/city-003");
});
it("keeps the selected destination authoritative when prompt preferences are edited", async () => {
  mount(); await ready(); fireEvent.change(prompt(), { target: { value: "Rome, 3 days, food" } });
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ destinationId: "city-003", prompt: "Rome, 3 days, food" }), expect.anything());
});
it("lets an explicit manual destination replace the prefill", async () => {
  mount(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
  fireEvent.change(prompt(), { target: { value: "Paris, France, 3 days" } });
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ destinationId: undefined, prompt: "Paris, France, 3 days" }), expect.anything());
  expect(screen.getByTestId("url")).toHaveTextContent("/home");
});
it("shows loading and never overwrites manual edits with a late lookup response", async () => {
  defer = true; mount(); expect(screen.getByText("Loading selected destination…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Plan my trip" })).toBeDisabled();
  fireEvent.change(prompt(), { target: { value: "Paris, France" } });
  await waitFor(() => expect(release).toBeTypeOf("function")); await act(async () => release!());
  expect(prompt()).toHaveValue("Paris, France"); expect(screen.queryByText(/Selected destination:/)).toBeNull();
});
it.each(["?destinationId=bad", "?destinationId=", "?destinationId=city-003&destinationId=city-005", "?destinationId=%E0%A4%A", `?destinationId=${"a".repeat(3000)}`])("recovers from invalid URL %s", async search => {
  const fetcher = mount(`/home${search}`); expect(await screen.findByText(/This destination link is invalid/)).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled(); fireEvent.change(prompt(), { target: { value: "Paris, France" } });
  expect(screen.getByRole("button", { name: "Plan my trip" })).toBeEnabled();
});
it("keeps the normal wizard usable without a destination parameter", () => { mount("/home"); expect(prompt()).toHaveValue(""); expect(destinationReference("")).toEqual({}); });
it.each([404, 500])("shows a recoverable lookup failure %s and retry", async status => {
  fail = status; mount("/home?destinationId=city-999"); await screen.findByText(/Could not load the selected destination/);
  fireEvent.change(prompt(), { target: { value: "Paris, France" } }); expect(screen.getByRole("button", { name: "Plan my trip" })).toBeEnabled();
});
it("can retry a failed lookup before the user edits", async () => {
  fail = 500; mount(); await screen.findByRole("button", { name: "Retry destination" });
  fail = 0; fireEvent.click(screen.getByRole("button", { name: "Retry destination" })); await ready();
});
it("uses the existing requirements dialog, preserving dates, budget, interests and pace", async () => {
  mount(); await ready();
  mocks.analyze.mockImplementation((_input, options) => options.onSuccess({ ...result, missingFields: ["travelers"], requirementsComplete: false }));
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText("Where are you going?")).toHaveValue("Barcelona");
  expect(within(dialog).getByLabelText("Which country is that in?")).toHaveValue("Spain");
  expect(within(dialog).getByLabelText("When does the trip start?")).toHaveValue("2030-06-02");
  expect(within(dialog).getByLabelText("When does the trip end?")).toHaveValue("2030-06-04");
  expect(within(dialog).getByRole("button", { name: "Relaxed" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(within(dialog).getByLabelText("Where are you going?"), { target: { value: "Paris" } });
  fireEvent.change(within(dialog).getByLabelText("Which country is that in?"), { target: { value: "France" } });
  const proceed = within(dialog).getByRole("button", { name: "Continue" }); await waitFor(() => expect(proceed).toBeEnabled()); fireEvent.click(proceed);
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  expect(mocks.update.mock.calls[0]![0].answers).toMatchObject({ destination: "Paris", country: "France", startDate: "2030-06-02", endDate: "2030-06-04", budget: { amount: 500, currency: "EUR" }, interests: ["food"], pace: "relaxed" });
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("asks before replacing meaningful in-memory wizard work", async () => {
  mount(); await ready(); fireEvent.change(prompt(), { target: { value: "My Barcelona settings" } });
  fireEvent.click(screen.getByRole("button", { name: "Open Rome" })); await screen.findByRole("button", { name: "Continue existing draft" });
  expect(prompt()).toHaveValue("My Barcelona settings"); fireEvent.click(screen.getByRole("button", { name: "Continue existing draft" })); expect(prompt()).toHaveValue("My Barcelona settings");
});
it("clears the old canonical selection when an open wizard receives an invalid link", async () => {
  mount(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Open invalid link" }));
  await screen.findByText(/This destination link is invalid/);
  await waitFor(() => expect(screen.queryByText(/Selected destination:/)).toBeNull());
  expect(screen.getByRole("button", { name: "Plan my trip" })).toBeDisabled();
  fireEvent.change(prompt(), { target: { value: "Paris, France" } });
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ destinationId: undefined, prompt: "Paris, France" }), expect.anything());
});
it("plans from Explore without toggling Save and restores the discovery URL on Back", async () => {
  const fetcher = mount("/explore?q=barce&country=spain&sort=name-desc&page=2");
  const plan = screen.getByRole("button", { name: "Plan a trip" }); plan.focus(); expect(plan).toHaveFocus();
  fireEvent.click(plan); await ready(); expect(screen.getByTestId("url")).toHaveTextContent("/home?destinationId=city-003");
  expect(fetcher.mock.calls.some(([path]) => path === "/api/saved/destinations")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Back" })); await screen.findByRole("button", { name: "Plan a trip" });
  expect(screen.getByTestId("url")).toHaveTextContent("/explore?q=barce&country=spain&sort=name-desc&page=2");
});

it.each([
  ["food-first-weekends", ["food", "culture"], "relaxed"],
  ["architecture-and-icons", ["architecture", "culture"], "balanced"],
])("applies supported editable suggestions from %s without generation", async (slug, interests, pace) => {
  mount(`/home?destinationId=city-003&collection=${slug}`); await ready();
  expect(mocks.analyze).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  expect(screen.getByText(/Suggestions from/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ destinationId: "city-003", interests, pace }), expect.anything());
});
it.each(["unknown", "culture-deep-dives", "food-first-weekends&collection=architecture-and-icons", "%E0%A4%A", "x".repeat(300)])("ignores invalid or non-member collection %s while preserving valid destination", async slug => {
  mount(`/home?destinationId=city-003&collection=${slug}&interests=nightlife&pace=packed`); await ready();
  expect(screen.queryByText(/Suggestions from/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  expect(mocks.analyze.mock.calls[0]![0]).toMatchObject({ destinationId: "city-003", badges: [], pace: "balanced" });
  expect(mocks.analyze.mock.calls[0]![0]).not.toHaveProperty("interests");
});
it("preserves manually selected interests when collection lookup completes asynchronously", async () => {
  defer = true; mount("/home?destinationId=city-003&collection=food-first-weekends");
  fireEvent.click(screen.getByRole("button", { name: "Nature escape" }));
  await waitFor(() => expect(release).toBeTypeOf("function")); await act(async () => release!()); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  expect(mocks.analyze.mock.calls[0]![0]).toMatchObject({ interests: ["nature"], pace: "relaxed" });
});
it("allows removing and adding suggestions and clears collection context on manual destination change", async () => {
  mount("/home?destinationId=city-003&collection=food-first-weekends"); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Food trip" })); fireEvent.click(screen.getByRole("button", { name: "Nature escape" }));
  fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
  expect(screen.queryByText(/Suggestions from/)).toBeNull(); expect(screen.getByTestId("url")).toHaveTextContent("/home");
  expect(screen.getByTestId("url")).not.toHaveTextContent("collection=");
  fireEvent.change(prompt(), { target: { value: "Paris, France" } }); fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  expect(mocks.analyze.mock.calls[0]![0]).toMatchObject({ destinationId: undefined, interests: ["culture", "nature"] });
});
it("uses the existing conflict choice even when a different collection targets the same destination", async () => {
  mount("/home?destinationId=city-003&collection=architecture-and-icons"); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open food collection" }));
  await screen.findByRole("button", { name: "Continue existing draft" });
  fireEvent.click(screen.getByRole("button", { name: "Continue existing draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  expect(mocks.analyze.mock.calls[0]![0]).toMatchObject({ interests: ["architecture", "culture"], pace: "balanced" });
});
it("keeps a user's edited pace and dates through the requirements review", async () => {
  mount("/home?destinationId=city-003&collection=architecture-and-icons"); await ready();
  mocks.analyze.mockImplementation((_input, options) => options.onSuccess({ ...result, analysis: { ...result.analysis, interests: ["architecture", "culture"], pace: "balanced" }, missingFields: ["travelers"], requirementsComplete: false }));
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" })); const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "Balanced" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Relaxed" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Architecture" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Nature" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  expect(mocks.update.mock.calls[0]![0].answers).toMatchObject({ interests: ["culture", "nature"], pace: "relaxed", startDate: "2030-06-02", budget: { amount: 500 } });
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it("retains custom interests and edited pace when planning again after collection review", async () => {
  mount("/home?destinationId=city-003&collection=food-first-weekends"); await ready();
  mocks.analyze.mockImplementation((_input, options) => options.onSuccess({ ...result, missingFields: ["travelers"], requirementsComplete: false }));
  mocks.update.mockImplementation((_input, options) => options.onSuccess({ ...result, analysis: { ...result.analysis, interests: ["Rail heritage"], pace: "packed" } }));
  fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  const dialog = await screen.findByRole("dialog"); fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
  fireEvent.change(prompt(), { target: { value: "Paris, France" } }); fireEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
  expect(mocks.analyze.mock.calls.at(-1)![0]).toMatchObject({ destinationId: undefined, interests: ["Rail heritage"], badges: [], pace: "packed" });
});
