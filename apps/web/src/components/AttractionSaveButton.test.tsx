import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AttractionSaveButton from "./AttractionSaveButton";
import SavedPage from "../pages/SavedPage";
import TripTimeline from "./trip/TripTimeline";
import type { TimelineAttraction } from "../config/itineraryAdapters";
const auth = vi.hoisted(() => ({ value: { status: "guest", guest: { id: "a" }, user: null } as { status: string; guest: { id: string } | null; user: { id: string } | null } }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => auth.value }));
let saved = false;
let fail = false;
let defer = false;
let expired = false;
let finish: (() => void) | undefined;
const clients: QueryClient[] = [];
const key = "osm:node:123";
const fixture = { attractionKey: key, provider: "overpass", createdAt: "2026-10-19", snapshot: { name: "Museum", category: "culture", destinationName: "Paris", country: "France", coordinates: { lat: 48.86, lng: 2.35 }, description: "A museum" } };
const heart = <AttractionSaveButton attractionKey={key} name="Museum" tripId="507f1f77bcf86cd799439011" />;
function mount(content: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client); client.setQueryData(["auth", "session"], { status: "guest", guest: { id: "a" } });
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    if (String(path).includes("/saved/destinations")) return new Response(JSON.stringify({ destinations: [], destinationIds: [] }));
    if (expired) return new Response(JSON.stringify({ error: "Your guest session has expired.", code: "GUEST_SESSION_EXPIRED" }), { status: 401 });
    if (options?.method) {
      if (defer) await new Promise<void>(resolve => { finish = resolve; });
      if (fail) return new Response(JSON.stringify({ error: "Save failed" }), { status: 500 });
      saved = options.method === "POST";
      return new Response(options.method === "DELETE" ? null : "{}", { status: options.method === "DELETE" ? 204 : 200 });
    }
    return new Response(JSON.stringify(String(path).endsWith("status") ? { attractionKeys: saved ? [key] : [] } : { attractions: saved ? [fixture] : [] }));
  }));
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={["/saved?type=attractions"]}>{children}</MemoryRouter></QueryClientProvider>;
  return { ...render(content, { wrapper }), client };
}
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); saved = false; fail = false; defer = false; expired = false; finish = undefined; auth.value = { status: "guest", guest: { id: "a" }, user: null }; });
it("renders unsaved and saved hearts and synchronizes repeated appearances with one status request", async () => {
  mount(<>{heart}{heart}</>);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Save attraction Museum" })[0]).toBeEnabled());
  expect(screen.getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "false");
  expect(vi.mocked(fetch).mock.calls.filter(call => String(call[0]).endsWith("status"))).toHaveLength(1);
  fireEvent.click(screen.getAllByRole("button")[0]);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Unsave attraction Museum" })).toHaveLength(2));
  fireEvent.click(screen.getAllByRole("button")[1]);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Save attraction Museum" })).toHaveLength(2));
});
it.each([false, true])("disables duplicate controls and retains correct state on mutation failure (saved=%s)", async initial => {
  saved = initial; fail = true; defer = true;
  mount(<>{heart}{heart}</>);
  await waitFor(() => expect(screen.getAllByRole("button")[0]).toBeEnabled());
  fireEvent.click(screen.getAllByRole("button")[0]);
  await waitFor(() => expect(screen.getAllByRole("button").every(button => button.hasAttribute("disabled"))).toBe(true));
  await waitFor(() => expect(finish).toBeTypeOf("function")); await act(async () => finish!());
  await screen.findByRole("alert");
  expect(screen.getAllByRole("button")[0]).toHaveAttribute("aria-pressed", String(initial));
  expect(vi.mocked(fetch).mock.calls.filter(call => call[1]?.method)).toHaveLength(1);
});
it("keeps saving outside navigation and drag activation while retaining edit controls", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const select = vi.fn(); const reorder = vi.fn(); const action = vi.fn(); const pointer = vi.fn();
  const entry: TimelineAttraction = { kind: "attraction", attractionKey: key, placeId: "node/123", key: "1-0", stopIndex: 0, time: "09:00", name: "Museum", category: "Culture", durationMinutes: 60 };
  mount(<div onPointerDown={pointer}><TripTimeline tripId="507f1f77bcf86cd799439011" entries={[entry]} activeStop={0} onSelectStop={select} onReorder={reorder} onAction={action} /></div>);
  const save = screen.getByRole("button", { name: "Save attraction Museum" });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.pointerDown(save); fireEvent.click(save);
  await screen.findByRole("button", { name: "Unsave attraction Museum" });
  expect(select).not.toHaveBeenCalled(); expect(reorder).not.toHaveBeenCalled(); expect(pointer).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Reorder Museum" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Edit Museum" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove attraction" }));
  expect(action).toHaveBeenCalledWith("remove", "node/123");
});
it("renders an empty Saved attractions state", async () => { mount(<SavedPage />); expect(await screen.findByText(/No saved attractions yet/)).toBeVisible(); });
it("renders retained snapshot details, links and direct removal without a source trip", async () => {
  saved = true; mount(<SavedPage />);
  expect(await screen.findByText("Museum")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "View details" }));
  expect(await screen.findByText("A museum")).toBeVisible();
  expect(screen.getByRole("link", { name: "View on OpenStreetMap" })).toHaveAttribute("href", "https://www.openstreetmap.org/node/123");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const remove = await screen.findByRole("button", { name: "Unsave attraction Museum" });
  await waitFor(() => expect(remove).toBeEnabled()); fireEvent.click(remove);
  expect(await screen.findByText(/No saved attractions yet/)).toBeVisible();
});
it("uses a native keyboard-focusable button", async () => {
  mount(heart); const button = screen.getByRole("button", { name: "Save attraction Museum" });
  await waitFor(() => expect(button).toBeEnabled()); button.focus(); expect(button).toHaveFocus(); expect(button.tagName).toBe("BUTTON");
});
it("hides old keys after switching identities and ignores a late mutation response", async () => {
  defer = true; const view = mount(heart);
  await waitFor(() => expect(screen.getByRole("button")).toBeEnabled()); fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  auth.value = { status: "authenticated", guest: null, user: { id: "b" } };
  view.client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "b" } });
  view.rerender(<AttractionSaveButton attractionKey={key} name="Museum" tripId="507f1f77bcf86cd799439011" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save attraction Museum" })).toBeEnabled());
  await act(async () => finish!());
  expect(view.client.getQueryData(["saved", "user:b", "attractions", "keys"])).toEqual({ attractionKeys: [] });
});
it("dispatches session expiration and shows a useful Saved error", async () => {
  const listener = vi.fn(); window.addEventListener("triply:session-expired", listener);
  try { expired = true; mount(<SavedPage />); await screen.findByRole("alert"); expect(listener).toHaveBeenCalled(); expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe("GUEST_SESSION_EXPIRED"); } finally { window.removeEventListener("triply:session-expired", listener); }
});
