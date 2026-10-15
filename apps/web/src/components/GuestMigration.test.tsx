import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { GuestMigrationStatus, IdentitySession, TripSummary } from "@triply/shared";
import { AuthProvider } from "../auth/AuthProvider";
import { PublicOnlyRoute, RequireAuth } from "../auth/RouteGuards";
import LoginPage from "./LoginPage";
import AppLayout from "./layout/AppLayout";
import MyTripsPage from "../pages/MyTripsPage";
import { ToastProvider } from "./ToastProvider";

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
const trip: TripSummary = { id: "507f1f77bcf86cd799439011", status: "ready", destination: "Paris", country: "France", startDate: "2030-06-02", endDate: "2030-06-02", durationDays: 1, travelers: 1, budget: { amount: 500, currency: "EUR", type: "total" }, location: null, fixtureKey: null, prompt: "Paris", badges: [], createdAt: null, updatedAt: null };
function mount(path = "/home") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><AuthProvider><ToastProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<PublicOnlyRoute><LoginPage mode="login" /></PublicOnlyRoute>} />
    <Route path="/register" element={<PublicOnlyRoute><LoginPage mode="register" /></PublicOnlyRoute>} />
    <Route element={<RequireAuth allowGuest><AppLayout /></RequireAuth>}><Route path="/home" element={<MyTripsPage />} /></Route>
  </Routes></MemoryRouter></ToastProvider></AuthProvider></QueryClientProvider>);
  return view;
}
beforeEach(() => {
  imported = false; failure = 0; statusFailure = false; release = null; held = false;
  session = { status: "authenticated", user: { id: "user-1", email: "account@example.com" } };
  migration = { status: "pending", tripCount: 2, expiresAt: "2030-06-02T12:15:00.000Z", busy: false };
  fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === "/api/auth/session?identity=1") return json(session);
    if (path === "/api/auth/login" || path === "/api/auth/register") {
      session = { status: "authenticated", user: { id: "user-1", email: "account@example.com" } }; return json({ user: session.user }, path.endsWith("register") ? 201 : 200);
    }
    if (path === "/api/auth/guest-migration/status") return statusFailure ? json({ error: "Raw database problem" }, 503) : json(migration);
    if (path === "/api/auth/guest-migration/confirm") {
      if (held) await new Promise<void>(resolve => { release = resolve; });
      if (failure) { const code = failure; failure = 0; if (code === 410) migration = { status: "expired" }; return json({ error: "Raw driver detail must stay hidden" }, code); }
      imported = true; migration = { status: "completed", importedCount: 2 }; return json({ importedCount: 2, alreadyImported: false });
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
  it.each(["login", "register"] as const)("offers import after %s with authenticated navigation and accurate count", async mode => {
    session = { status: "guest", guest: { id: "guest-1", expiresAt: "2030-06-09T00:00:00Z" } }; mount(`/${mode}`);
    await authenticate(mode);
    const dialog = await screen.findByRole("dialog", { name: "Save your guest trips" });
    expect(dialog.textContent).toContain("You created 2 trips while browsing as a guest");
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Import trips" }));
    const importing = await screen.findByRole("button", { name: "Importing…" });
    expect((importing as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(importing);
    await waitFor(() => expect(release).not.toBeNull());
    release!();
    expect(await screen.findByText("Paris", { exact: true })).toBeTruthy();
    expect(await screen.findByText(/2 guest trips are saved to your account/)).toBeTruthy();
    expect(client.getQueryData(["guest", "usage"])).toBeUndefined();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/confirm"))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/auth/session?identity=1").length).toBeGreaterThan(1);
  });
  it("shows a safe import error and retries without exposing raw details", async () => {
    failure = 503; mount();
    fireEvent.click(await screen.findByRole("button", { name: "Import trips" }));
    expect(await screen.findByText(/We couldn't finish the import safely/)).toBeTruthy();
    expect(screen.queryByText(/Raw driver/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import trips" }));
    expect(await screen.findByText("Paris", { exact: true })).toBeTruthy();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/confirm"))).toHaveLength(2);
  });
  it("explains expired contexts and closes the prompt after checking status", async () => {
    failure = 410; mount();
    fireEvent.click(await screen.findByRole("button", { name: "Import trips" }));
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
    expect(await screen.findByRole("dialog", { name: "Save your guest trips" })).toBeTruthy();
  });
  it("discards only after explicit confirmation and keeps the account signed in", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard pending import" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard this pending import?" });
    expect(dialog.textContent).toContain("without deleting the guest trips");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard import" }));
    await waitFor(() => expect(screen.queryByLabelText("Pending guest import")).toBeNull());
    expect(screen.getByText("account@example.com")).toBeTruthy();
    expect(imported).toBe(false);
  });
  it("waits for guest work instead of importing a stale trip snapshot", async () => {
    migration = { ...migration, status: "pending", tripCount: 2, expiresAt: "2030-06-02T12:15:00Z", busy: true }; mount();
    expect((await screen.findByRole("button", { name: "Import trips" }) as HTMLButtonElement).disabled).toBe(true);
    migration.busy = false;
    await client.invalidateQueries({ queryKey: ["guest-migration"] });
    await waitFor(() => expect((screen.getByRole("button", { name: "Import trips" }) as HTMLButtonElement).disabled).toBe(false));
  });
  it("shows an already-imported receipt without prompting for another transfer", async () => {
    migration = { status: "completed", importedCount: 6 }; mount();
    expect(await screen.findByText(/6 guest trips are saved/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("reports status lookup failure safely and allows retry", async () => {
    statusFailure = true; mount();
    expect(await screen.findByText(/We couldn't check for guest trips/)).toBeTruthy();
    expect(screen.queryByText(/Raw database/)).toBeNull();
    statusFailure = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry import status" }));
    expect(await screen.findByRole("dialog", { name: "Save your guest trips" })).toBeTruthy();
  });
});
