import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "../i18n";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GuestUsage as Usage, IdentitySession, TripDetail, TripSummary } from "@triply/shared";
import { AuthProvider } from "../auth/AuthProvider";
import { RequireAuth, PublicOnlyRoute } from "../auth/RouteGuards";
import AppLayout from "./layout/AppLayout";
import MyTripsPage from "../pages/MyTripsPage";
import HomePage from "../pages/HomePage";
import TripPage from "../pages/TripPage";
import LoginPage from "./LoginPage";
import { ToastProvider } from "./ToastProvider";
import { ApiError, parseResponse } from "../api/client";

vi.mock("../hooks/useNotifications", () => ({ useNotifications: () => ({ data: [] }) }));
vi.mock("./trip/TripMap", () => ({ default: () => null }));
vi.mock("./trip/TripAssistant", () => ({ default: () => <p>Account assistant</p> }));
let usage: Usage;
let session: IdentitySession;
let trips: TripSummary[];
let detail: TripDetail;
let fetcher: ReturnType<typeof vi.fn>;
let client: QueryClient;
let usageError = false;
const id = "507f1f77bcf86cd799439011";
function mount(path = "/trips") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><AuthProvider><ToastProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<PublicOnlyRoute><LoginPage mode="login" /></PublicOnlyRoute>} />
    <Route element={<RequireAuth allowGuest><AppLayout /></RequireAuth>}>
      <Route path="/trips" element={<MyTripsPage />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/trips/:id" element={<TripPage />} />
    </Route>
  </Routes></MemoryRouter></ToastProvider></AuthProvider></QueryClientProvider>);
}
beforeEach(() => {
  usageError = false;
  usage = { tripCount: 1, tripLimit: 6, aiGenerationsRemaining: 1, aiGenerationsLimit: 2, dayRegenerationsRemaining: 2, dayRegenerationsLimit: 2, maxTripDays: 7, aiQuotaResetsAt: "2030-06-03T00:00:00.000Z", dayQuotaResetsAt: null };
  session = { status: "guest", guest: { id: "guest-1", expiresAt: "2030-06-09T00:00:00Z" } };
  trips = [{ id, status: "draft", destination: "Paris", country: "France", startDate: "2030-06-02", endDate: "2030-06-02", durationDays: 1, travelers: 1, budget: { amount: 500, currency: "EUR", type: "total" }, location: null, fixtureKey: null, prompt: "Paris", badges: [], createdAt: null, updatedAt: null }];
  detail = { id, draftId: id, prompt: "Paris", badges: [], status: "draft", analysis: { destination: "Paris", country: "France", startDate: "2030-06-02", endDate: "2030-06-02", durationDays: 1, travelers: 1, budget: { amount: 500, currency: "EUR", type: "total" }, interests: ["culture"], pace: "balanced", maxWalkingDistanceKm: 5, notes: null, location: { lat: 48.85, lng: 2.35 } }, itinerary: null, itineraryVersion: 0, generation: { startedAt: null, generatedAt: null, error: null }, weather: [], equipment: [], missingFields: [], requirementsComplete: true, fixtureKey: null, createdAt: null, updatedAt: null };
  fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/api/auth/session?identity=1") return json(session);
    if (path === "/api/guest/usage") return usageError ? json({ error: "Could not load guest usage" }, 503) : json(usage);
    if (path === `/api/trips/${id}` && init?.method === "DELETE") { trips = []; usage.tripCount--; return new Response(null, { status: 204 }); }
    if (path.startsWith("/api/trips?") || path === "/api/trips") return json(trips);
    if (path === `/api/trips/${id}`) return json(detail);
    if (path === "/api/trips/analyze") { usage.tripCount++; return json({ draftId: id, analysis: detail.analysis, missingFields: [], requirementsComplete: true }); }
    if (path.endsWith("/budget")) return json({});
    return json({ error: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => { cleanup(); client?.clear(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });

describe("guest trips and limits UI", () => {
  it("switches exhausted quota copy without consuming any allowance", async () => {
    usage.tripCount = 6; usage.aiGenerationsRemaining = 0; usage.dayRegenerationsRemaining = 0; usage.maxTripDays = 1;
    mount(); await screen.findByLabelText("Guest usage");
    const original = structuredClone(usage);
    await act(() => i18n.changeLanguage("pl"));
    const indicator = screen.getByLabelText("Limity gościa");
    expect(indicator.textContent).toContain("Do 1 dnia kalendarzowego na podróż");
    expect(indicator.textContent).toContain("Osiągnięto limit podróży gościa");
    expect(indicator.textContent).toContain("Wykorzystano limit generowania planów");
    expect(indicator.textContent).toContain("Wykorzystano limit zmian dnia z AI");
    expect(usage).toEqual(original);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== "GET")).toHaveLength(0);
  });
  it("shows server-provided usage, own trip list and separate AI counters", async () => {
    mount();
    const indicator = await screen.findByLabelText("Guest usage");
    await waitFor(() => expect(indicator.textContent).toContain("Trips: 1 / 6"));
    expect(indicator.textContent).toContain("AI generations remaining: 1 / 2");
    expect(indicator.textContent).toContain("AI day regenerations remaining: 2 / 2");
    expect(await screen.findByText("Paris", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Notifications" })).toBeNull();
  });
  it("guards creation at six trips and explains that deleting frees storage", async () => {
    usage.tripCount = 6; mount();
    expect(await screen.findByText(/Delete an existing trip to free a slot/)).toBeTruthy();
    for (const button of screen.getAllByRole("button", { name: "Plan a new trip" })) expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("Guest usage").textContent).toContain("you can choose to import your guest trips");
  });
  it("deletes through the existing list and refreshes usage without refunding AI", async () => {
    usage.tripCount = 6; usage.aiGenerationsRemaining = 0; mount();
    fireEvent.click(await screen.findByRole("button", { name: "Delete trip Paris" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("does not restore AI quota");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete trip" }));
    await waitFor(() => expect(screen.getByLabelText("Guest usage").textContent).toContain("Trips: 5 / 6"));
    expect(screen.getByLabelText("Guest usage").textContent).toContain("AI generations remaining: 0 / 2");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete trip Paris" })).toBeNull());
  });
  it("enables the same wizard and refreshes guest storage after creation", async () => {
    mount("/home");
    const prompt = await screen.findByPlaceholderText(/4 days in Barcelona/);
    fireEvent.change(prompt, { target: { value: "Paris, France" } });
    const plan = screen.getByRole("button", { name: "Plan my trip" });
    await waitFor(() => expect((plan as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(plan);
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === "/api/trips/analyze")).toBe(true));
    await waitFor(() => expect(screen.getByLabelText("Guest usage").textContent).toContain("Trips: 2 / 6"));
  });
  it("opens guest trip details and guards generation when quota is exhausted", async () => {
    usage.aiGenerationsRemaining = 0; mount(`/trips/${id}`);
    const action = await screen.findByRole("button", { name: "Generate my trip" });
    await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByLabelText("Guest usage").textContent).toContain("You can still view and edit your trips");
    expect(screen.getByLabelText("Guest usage").textContent).toContain("Next allowance:");
    expect(screen.queryByText("Account assistant")).toBeNull();
  });
  it("reports quota status network errors with retry", async () => {
    usageError = true; mount();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Something went wrong. Please try again. Retry");
    usageError = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByLabelText("Guest usage").textContent).toContain("Trips: 1 / 6"));
  });
  it("returns to login with an expiration notice and clears old trip cache", async () => {
    mount(); await screen.findByText("Paris", { exact: true });
    session = { status: "anonymous" };
    window.dispatchEvent(new CustomEvent("triply:session-expired", { detail: "GUEST_SESSION_EXPIRED" }));
    expect(await screen.findByText(/Your guest session has expired/)).toBeTruthy();
    expect(client.getQueryData(["trips", { status: null }])).toBeUndefined();
  });
  it("keeps the registered experience free of guest quota controls", async () => {
    session = { status: "authenticated", user: { id: "user", email: "user@example.com" } }; mount();
    expect(await screen.findByText("user@example.com")).toBeTruthy();
    expect(screen.queryByLabelText("Guest usage")).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => url === "/api/guest/usage")).toBe(false);
  });
  it.each(["GUEST_TRIP_LIMIT_REACHED", "GUEST_AI_LIMIT_REACHED", "GUEST_DAY_REGEN_LIMIT_REACHED"])("preserves actionable %s errors", async code => {
    await expect(parseResponse(new Response(JSON.stringify({ code, error: "Specific limit explanation" }), { status: 429 }))).rejects.toMatchObject({ code, message: "Specific limit explanation" });
  });
});
