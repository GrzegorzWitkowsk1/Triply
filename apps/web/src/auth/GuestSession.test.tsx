import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { IdentitySession } from "@triply/shared";
import { AuthProvider, useAuth } from "./AuthProvider";
import { RequireAuth, PublicOnlyRoute } from "./RouteGuards";
import LoginPage from "../components/LoginPage";
import Header from "../components/layout/Header";
import BottomNav from "../components/layout/BottomNav";
import { GuestAwarePage } from "../pages/GuestPage";

vi.mock("../hooks/useNotifications", () => ({ useNotifications: () => ({ data: [] }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const guest: IdentitySession = { status: "guest", guest: { id: "guest-1", expiresAt: "2030-01-01T00:00:00.000Z" } };
function mount(initial: IdentitySession, path = "/home", pending = false) {
  let session = initial;
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/auth/guest") session = guest;
    if (url === "/api/auth/guest/end") session = { status: "anonymous" };
    return new Response(JSON.stringify(session), { status: 200 });
  });
  vi.stubGlobal("fetch", pending ? vi.fn(() => new Promise(() => {})) : fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  function Shell() { const { status } = useAuth(); return <><span data-testid="status">{status}</span><Header /><BottomNav /><GuestAwarePage><h1>Private planner</h1></GuestAwarePage></>; }
  const view = render(<QueryClientProvider client={client}><AuthProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<PublicOnlyRoute><LoginPage mode="login" /></PublicOnlyRoute>} />
    <Route path="/register" element={<PublicOnlyRoute><LoginPage mode="register" /></PublicOnlyRoute>} />
    <Route path="/home" element={<RequireAuth allowGuest><Shell /></RequireAuth>} />
    <Route path="/trips" element={<RequireAuth allowGuest><Shell /></RequireAuth>} />
    <Route path="/shared/:token" element={<p>Public shared trip</p>} />
  </Routes></MemoryRouter></AuthProvider></QueryClientProvider>);
  return { ...view, client, fetcher };
}
describe("guest session UI", () => {
  it("explains an expired guest session on initial restoration without creating a replacement", async () => {
    const { fetcher } = mount({ status: "anonymous", reason: "GUEST_SESSION_EXPIRED" }, "/login");
    expect(await screen.findByText(/Trips from the expired session will not be reassigned/)).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/auth/session?identity=1");
  });
  it("enters Guest Mode explicitly and exposes a distinct identity", async () => {
    const { fetcher } = mount({ status: "anonymous" }, "/login");
    fireEvent.click(await screen.findByRole("button", { name: "Continue as guest" }));
    expect(await screen.findByText("Guest", { exact: true })).toBeTruthy();
    expect(screen.getByTestId("status").textContent).toBe("guest");
    expect(fetcher.mock.calls.some(([url]) => url === "/api/auth/guest")).toBe(true);
  });
  it("shows loading without private content", () => {
    mount(guest, "/home", true);
    expect(screen.getByRole("status").textContent).toContain("Checking your session");
    expect(screen.queryByText("Private planner")).toBeNull();
  });
  it("restores guest identity and supports guest navigation without private forms", async () => {
    const { fetcher } = mount(guest);
    expect(await screen.findByText("Guest", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "My Trips" }));
    expect(screen.getByText(/Account settings and notifications require an account/)).toBeTruthy();
    expect(screen.queryByText("Private planner")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/auth/session?identity=1");
  });
  it("hides account controls while offering login and registration", async () => {
    mount(guest);
    await screen.findByText("Guest", { exact: true });
    expect(screen.queryByRole("link", { name: "Notifications" })).toBeNull();
    expect(screen.queryByRole("link", { name: "profile" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Create account" }).length).toBe(2);
    fireEvent.click(screen.getAllByRole("link", { name: "Log in" })[0]);
    expect(await screen.findByLabelText(/^Email address/)).toBeTruthy();
  });
  it("ends the guest session, clears cached resources, and returns to login", async () => {
    const { client } = mount(guest);
    client.setQueryData(["trips"], ["private"]);
    fireEvent.click(await screen.findByRole("button", { name: "End guest session" }));
    expect(await screen.findByRole("button", { name: "Continue as guest" })).toBeTruthy();
    expect(client.getQueryData(["trips"])).toBeUndefined();
    expect(client.getQueryData(["auth", "session"])).toEqual({ status: "anonymous" });
  });
  it("preserves authenticated navigation and planner", async () => {
    mount({ status: "authenticated", user: { id: "user-1", email: "user@example.com" } });
    expect(await screen.findByText("user@example.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByText("Private planner")).toBeTruthy();
    expect(screen.queryByText("Guest", { exact: true })).toBeNull();
  });
  it("keeps anonymous shared pages public and never creates a guest", async () => {
    const { fetcher } = mount({ status: "anonymous" }, "/shared/token");
    expect(screen.getByText("Public shared trip")).toBeTruthy();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls[0][0]).toBe("/api/auth/session?identity=1");
  });
  it("reports guest creation failure and allows retry", async () => {
    const { fetcher } = mount({ status: "anonymous" }, "/login");
    const button = await screen.findByRole("button", { name: "Continue as guest" });
    const normal = fetcher.getMockImplementation()!;
    let failGuest = true;
    fetcher.mockImplementation(async url => {
      if (url === "/api/auth/guest" && failGuest) { failGuest = false; throw new Error("Guest service unavailable"); }
      return normal(url);
    });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Guest service unavailable");
    expect((screen.getByRole("button", { name: "Continue as guest" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
    expect(await screen.findByText("Guest", { exact: true })).toBeTruthy();
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/auth/guest")).toHaveLength(2);
  });
});
