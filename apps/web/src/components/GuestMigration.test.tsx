import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { GuestMigrationStatus, IdentitySession, TripSummary } from "@triply/shared";
import { AuthProvider } from "../auth/AuthProvider";
import { PublicOnlyRoute, RequireAuth } from "../auth/RouteGuards";
import LoginPage from "./LoginPage";
import AppLayout from "./layout/AppLayout";
import MyTripsPage from "../pages/MyTripsPage";
import { ToastProvider } from "./ToastProvider";
import SavedPage from "../pages/SavedPage";
import { findDestinationByCity } from "@triply/shared";
import { useSavedDestinationIds } from "../hooks/useSavedDestinations";
import { useSavedAttractionKeys } from "../hooks/useSavedAttractions";

vi.mock("../hooks/useNotifications", () => ({ useNotifications: () => ({ data: [] }) }));
let session: IdentitySession;
let migration: GuestMigrationStatus;
let imported = false;
let failure = 0;
let statusFailure = false;
let release: (() => void) | null;
let held = false;
let fetcher: ReturnType<typeof vi.fn>;
let client: QueryClient;
let merged = false;
let responseLost = false;
const emptySavedReceipt = { importedDestinationCount: 0, importedAttractionCount: 0, mergedDestinationCount: 0, mergedAttractionCount: 0 };
const savedDestination = (city: string, country: string) => ({ destinationId: findDestinationByCity(city, country)!.id, destination: findDestinationByCity(city, country), createdAt: "2030-06-01" });
const savedAttraction = (key: string) => ({ attractionKey: key, provider: "overpass", snapshot: { name: key === "osm:node:1" ? "Existing museum" : "New museum", category: "culture", country: "France", coordinates: { lat: 48.85, lng: 2.35 } }, createdAt: "2030-06-01" });
function SavedStateProbe() {
  const ids = useSavedDestinationIds(); const keys = useSavedAttractionKeys();
  return <><output data-testid="destination-status">{ids.data?.destinationIds.join(",")}</output><output data-testid="attraction-status">{keys.data?.attractionKeys.join(",")}</output><SavedPage /></>;
}
const trip: TripSummary = { id: "507f1f77bcf86cd799439011", status: "ready", destination: "Paris", country: "France", startDate: "2030-06-02", endDate: "2030-06-02", durationDays: 1, travelers: 1, budget: { amount: 500, currency: "EUR", type: "total" }, location: null, fixtureKey: null, prompt: "Paris", badges: [], createdAt: null, updatedAt: null };
function mount(path = "/home") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><AuthProvider><ToastProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<PublicOnlyRoute><LoginPage mode="login" /></PublicOnlyRoute>} />
    <Route path="/register" element={<PublicOnlyRoute><LoginPage mode="register" /></PublicOnlyRoute>} />
    <Route element={<RequireAuth allowGuest><AppLayout /></RequireAuth>}><Route path="/home" element={<MyTripsPage />} /><Route path="/saved" element={<SavedStateProbe />} /></Route>
  </Routes></MemoryRouter></ToastProvider></AuthProvider></QueryClientProvider>);
  return view;
}
beforeEach(() => {
  imported = false; merged = false; responseLost = false; failure = 0; statusFailure = false; release = null; held = false;
  session = { status: "authenticated", user: { id: "user-1", email: "account@example.com" } };
  migration = { status: "pending", tripCount: 2, destinationCount: 0, attractionCount: 0, expiresAt: "2030-06-02T12:15:00.000Z", busy: false };
  fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === "/api/auth/session?identity=1") return json(session);
    if (path === "/api/auth/logout") { session = { status: "anonymous" }; return json({}); }
    if (path.startsWith("/api/saved/destinations")) {
      const rows = [savedDestination("Paris", "France"), ...(imported ? [savedDestination("Lisbon", "Portugal")] : [])];
      return json(path.endsWith("/status") ? { destinationIds: rows.map(row => row.destinationId) } : { destinations: rows });
    }
    if (path.startsWith("/api/saved/attractions")) {
      const rows = [savedAttraction("osm:node:1"), ...(imported ? [savedAttraction("osm:node:2")] : [])];
      return json(path.endsWith("/status") ? { attractionKeys: rows.map(row => row.attractionKey) } : { attractions: rows });
    }
    if (path === "/api/auth/login" || path === "/api/auth/register") {
      session = { status: "authenticated", user: { id: "user-1", email: "account@example.com" } }; return json({ user: session.user }, path.endsWith("register") ? 201 : 200);
    }
    if (path === "/api/auth/guest-migration/status") return statusFailure ? json({ error: "Raw database problem" }, 503) : json(migration);
    if (path === "/api/auth/guest-migration/confirm") {
      if (held) await new Promise<void>(resolve => { release = resolve; });
      if (failure) {
        const code = failure; failure = 0;
        if (responseLost && migration.status === "pending") { imported = true; migration = { status: "completed", ...emptySavedReceipt, importedCount: migration.tripCount, importedDestinationCount: migration.destinationCount, importedAttractionCount: migration.attractionCount }; }
        if (code === 410) migration = { status: "expired" };
        return json({ error: "Raw driver detail must stay hidden" }, code);
      }
      const counts = migration.status === "pending" ? { ...emptySavedReceipt, importedCount: migration.tripCount, importedDestinationCount: migration.destinationCount, importedAttractionCount: migration.attractionCount } : { ...emptySavedReceipt, importedCount: 2 };
      if (merged) { counts.mergedDestinationCount = 1; counts.mergedAttractionCount = 1; }
      imported = true; migration = { status: "completed", ...counts }; return json({ ...counts, alreadyImported: false });
    }
    if (path === "/api/auth/guest-migration/discard") { migration = { status: "discarded" }; return json(migration); }
    if (path.startsWith("/api/trips")) return json(imported ? [trip] : []);
    return json({ error: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { release?.(); cleanup(); client?.clear(); vi.unstubAllGlobals(); });
async function authenticate(mode: "login" | "register") {
  const email = await screen.findByLabelText(/^Email address/);
  fireEvent.change(email, { target: { value: "account@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "Password123!Aa" } });
  fireEvent.click(within(email.closest("form")!).getByRole("button", { name: mode === "login" ? "Sign in" : "Create account" }));
}

describe("guest migration UX", () => {
  it.each(["user-2", "user-1"])("does not apply a late import response after a new sign-in context for %s", async nextUser => {
    held = true; mount();
    fireEvent.click(await screen.findByRole("button", { name: "Import to my account" }));
    await waitFor(() => expect(release).not.toBeNull());
    session = { status: "authenticated", user: { id: nextUser, email: "second@example.com" } }; migration = { status: "none" };
    await act(async () => {
      await client.cancelQueries(); client.removeQueries({ predicate: query => query.queryKey[0] !== "auth" });
      client.setQueryData(["auth", "session"], session);
    });
    await waitFor(() => expect(client.getQueryData(["guest-migration", nextUser])).toEqual({ status: "none" }));
    const privateSaved = { destinations: [savedDestination("Paris", "France")] };
    client.setQueryDefaults(["saved"], { gcTime: Infinity });
    client.setQueryData(["saved", `user:${nextUser}`, "list"], privateSaved);
    await act(async () => { release!(); });
    await waitFor(() => expect(imported).toBe(true));
    expect(client.getQueryData(["guest-migration", nextUser])).toEqual({ status: "none" });
    expect(client.getQueryData(["saved", `user:${nextUser}`, "list"])).toEqual(privateSaved);
    expect(screen.queryByText(/from your guest session are saved/)).toBeNull();
  });
  it("refreshes Saved from a completed status receipt after losing the confirmation response", async () => {
    migration = { status: "pending", tripCount: 0, destinationCount: 1, attractionCount: 1, expiresAt: "2030-06-02T12:15:00Z", busy: false };
    responseLost = true; failure = 503; mount("/saved");
    fireEvent.click(await screen.findByRole("button", { name: "Import to my account" }));
    await screen.findByText(/We couldn't finish the import safely/);
    fireEvent.click(screen.getByRole("button", { name: "Check import status" }));
    await screen.findByRole("button", { name: "All (4)" });
    expect(screen.getByTestId("attraction-status").textContent).toBe("osm:node:1,osm:node:2");
    expect(fetcher.mock.calls.filter(([path]) => path.endsWith("/confirm"))).toHaveLength(1);
  });
  it("shows actual mixed resource counts and refreshes Saved lists and both status queries after import", async () => {
    migration = { status: "pending", tripCount: 1, destinationCount: 2, attractionCount: 2, expiresAt: "2030-06-02T12:15:00Z", busy: false }; merged = true;
    mount("/saved");
    const dialog = await screen.findByRole("dialog", { name: "Save your guest data" });
    expect(dialog.textContent).toContain("1 trip, 2 destinations, and 2 attractions");
    client.setQueryData(["saved", "guest:retired", "list"], { destinations: [savedDestination("Paris", "France")] });
    await waitFor(() => expect(client.getQueryData(["saved", "user:user-1", "list"])).toBeDefined());
    fireEvent.click(within(dialog).getByRole("button", { name: "Import to my account" }));
    await screen.findByRole("button", { name: "All (4)" });
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getByTestId("destination-status").textContent).toContain(findDestinationByCity("Lisbon", "Portugal")!.id);
    expect(screen.getByTestId("attraction-status").textContent).toBe("osm:node:1,osm:node:2");
    expect(client.getQueryData(["saved", "guest:retired", "list"])).toBeUndefined();
    expect(screen.getByText(/were already saved and merged/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Destinations (2)" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lisbon" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Sort saved places" }));
    fireEvent.click(await screen.findByRole("option", { name: "Name Z–A" }));
    expect(screen.getByText("Lisbon", { exact: true })).toBeTruthy();
  });
  it.each(["destinations", "attractions"])("offers Saved-only %s with no invented zero trip count", async resource => {
    migration = { status: "pending", tripCount: 0, destinationCount: resource === "destinations" ? 2 : 0, attractionCount: resource === "attractions" ? 3 : 0, expiresAt: "2030-06-02T12:15:00Z", busy: false };
    mount(); const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(resource === "destinations" ? "2 destinations saved as a guest" : "3 attractions saved as a guest");
    expect(dialog.textContent).not.toContain("0 trips");
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(imported).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "Resume import" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import to my account" }));
    expect(await screen.findByText(/from your guest session are saved to your account/)).toBeTruthy();
  });
  it("clears all private Saved caches on logout", async () => {
    migration = { status: "none" }; mount("/saved");
    await screen.findByRole("button", { name: "All (2)" });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByLabelText(/^Email address/);
    expect(client.getQueriesData({ queryKey: ["saved"] })).toEqual([]);
  });
  it.each(["login", "register"] as const)("offers import after %s with authenticated navigation and accurate count", async mode => {
    session = { status: "guest", guest: { id: "guest-1", expiresAt: "2030-06-09T00:00:00Z" } }; mount(`/${mode}`);
    await authenticate(mode);
    const dialog = await screen.findByRole("dialog", { name: "Save your guest data" });
    expect(dialog.textContent).toContain("You have 2 trips saved as a guest");
    expect(screen.getByText("account@example.com")).toBeTruthy();
    expect(screen.queryByText("Guest", { exact: true })).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/confirm"))).toBe(false);
  });
  it("skips the prompt when there are no eligible trips", async () => {
    migration = { status: "none" }; mount();
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith("/status"))).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("disables duplicate confirmation while importing, refreshes queries and shows imported trips", async () => {
    held = true; mount();
    client.setQueryData(["guest", "usage"], { tripCount: 2 });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Import to my account" }));
    const importing = await screen.findByRole("button", { name: "Importing…" });
    expect((importing as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(importing);
    await waitFor(() => expect(release).not.toBeNull());
    release!();
    expect(await screen.findByText("Paris", { exact: true })).toBeTruthy();
    expect(await screen.findByText(/2 trips from your guest session are saved to your account/)).toBeTruthy();
    expect(client.getQueryData(["guest", "usage"])).toBeUndefined();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/confirm"))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/auth/session?identity=1").length).toBeGreaterThan(1);
  });
  it("shows a safe import error and retries without exposing raw details", async () => {
    failure = 503; mount();
    fireEvent.click(await screen.findByRole("button", { name: "Import to my account" }));
    expect(await screen.findByText(/We couldn't finish the import safely/)).toBeTruthy();
    expect(screen.queryByText(/Raw driver/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import to my account" }));
    expect(await screen.findByText("Paris", { exact: true })).toBeTruthy();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/confirm"))).toHaveLength(2);
  });
  it("explains expired contexts and closes the prompt after checking status", async () => {
    failure = 410; mount();
    fireEvent.click(await screen.findByRole("button", { name: "Import to my account" }));
    expect(await screen.findByText(/This import window has expired/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check import status" }));
    expect(await screen.findByText(/The pending guest import has expired/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("defers without calling mutations and offers a bounded resume action", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("Pending guest import").textContent).toContain("until");
    expect(fetcher.mock.calls.some(([url, init]) => init?.method === "POST" && url.includes("guest-migration"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Resume import" }));
    expect(await screen.findByRole("dialog", { name: "Save your guest data" })).toBeTruthy();
  });
  it("discards only after explicit confirmation and keeps the account signed in", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard pending import" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard this pending import?" });
    expect(dialog.textContent).toContain("without deleting the guest data");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard import" }));
    await waitFor(() => expect(screen.queryByLabelText("Pending guest import")).toBeNull());
    expect(screen.getByText("account@example.com")).toBeTruthy();
    expect(imported).toBe(false);
  });
  it("waits for guest work instead of importing a stale trip snapshot", async () => {
    migration = { status: "pending", tripCount: 2, destinationCount: 0, attractionCount: 0, expiresAt: "2030-06-02T12:15:00Z", busy: true }; mount();
    expect((await screen.findByRole("button", { name: "Import to my account" }) as HTMLButtonElement).disabled).toBe(true);
    migration.busy = false;
    await client.invalidateQueries({ queryKey: ["guest-migration"] });
    await waitFor(() => expect((screen.getByRole("button", { name: "Import to my account" }) as HTMLButtonElement).disabled).toBe(false));
  });
  it("shows an already-imported receipt without prompting for another transfer", async () => {
    migration = { status: "completed", ...emptySavedReceipt, importedCount: 6 }; mount();
    expect(await screen.findByText(/6 trips from your guest session are saved/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("reports status lookup failure safely and allows retry", async () => {
    statusFailure = true; mount();
    expect(await screen.findByText(/We couldn't check for guest data/)).toBeTruthy();
    expect(screen.queryByText(/Raw database/)).toBeNull();
    statusFailure = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry import status" }));
    expect(await screen.findByRole("dialog", { name: "Save your guest data" })).toBeTruthy();
  });
});
