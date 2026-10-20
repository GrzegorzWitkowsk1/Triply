import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { findDestinationByCity, type SavedAttraction, type SavedDestination } from "@triply/shared";
import SavedPage from "./SavedPage";
const auth = vi.hoisted(() => ({ value: { status: "guest", guest: { id: "a" }, user: null } as { status: string; guest: { id: string } | null; user: { id: string } | null } }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => auth.value }));
const paris: SavedDestination = { destinationId: "city-001", createdAt: "2026-01-01T12:00:00Z", destination: findDestinationByCity("Paris", "France") };
const lisbon: SavedDestination = { destinationId: findDestinationByCity("Lisbon", "Portugal")!.id, createdAt: "2026-03-01T12:00:00Z", destination: findDestinationByCity("Lisbon", "Portugal") };
const museum: SavedAttraction = { attractionKey: "osm:node:1", provider: "overpass", createdAt: "2026-04-01T12:00:00Z", snapshot: { name: "Musée d’Orsay", category: "culture", destinationName: "Paris", country: "France", coordinates: { lat: 48.86, lng: 2.32 }, description: "Art on the Seine" } };
const alfama: SavedAttraction = { attractionKey: "osm:way:2", provider: "overpass", createdAt: "2026-02-01T12:00:00Z", snapshot: { name: "Alfama", category: "architecture", destinationName: "Lisbon", country: "Portugal", coordinates: { lat: 38.71, lng: -9.12 } } };
let destinations: SavedDestination[];
let attractions: SavedAttraction[];
let failDestination = false;
let failAttraction = false;
let failMutation = false;
let expired = false;
let deferred = false;
let release: (() => void) | undefined;
const clients: QueryClient[] = [];
function Probe() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}</output><output data-testid="route-state">{JSON.stringify(location.state)}</output><button onClick={() => navigate(-1)}>Browser back</button></>;
}
function mount(path = "/saved", setup?: () => void) {
  destinations = [paris, lisbon]; attractions = [museum, alfama]; setup?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } } });
  client.setQueryData(["auth", "session"], { status: "guest", guest: { id: "a" } }); clients.push(client);
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    const isAttraction = String(path).includes("/attractions");
    if (deferred) await new Promise<void>(resolve => { const previous = release; release = () => { previous?.(); resolve(); }; });
    if (expired) return new Response(JSON.stringify({ error: "Expired", code: "GUEST_SESSION_EXPIRED" }), { status: 401 });
    if (options?.method === "DELETE") {
      if (failMutation) return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
      const id = decodeURIComponent(String(path).split("/").at(-1)!);
      if (isAttraction) attractions = attractions.filter(row => row.attractionKey !== id); else destinations = destinations.filter(row => row.destinationId !== id);
      return new Response(null, { status: 204 });
    }
    if (isAttraction ? failAttraction : failDestination) return new Response(JSON.stringify({ error: "database stack should not be displayed" }), { status: 500 });
    return new Response(JSON.stringify(isAttraction ? { attractions } : { destinations }));
  }));
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Probe /><Routes><Route path="/saved" element={<SavedPage />} /><Route path="/home" element={<h1>Trip planning</h1>} /></Routes></MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}
const ready = () => screen.findByRole("button", { name: "All (4)" });
const names = () => screen.queryAllByRole("article").map(article => article.getAttribute("aria-label"));
async function sortBy(label: string) { fireEvent.mouseDown(screen.getByRole("combobox", { name: "Sort saved places" })); fireEvent.click(await screen.findByRole("option", { name: label })); }
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); failDestination = false; failAttraction = false; failMutation = false; expired = false; deferred = false; release = undefined; auth.value = { status: "guest", guest: { id: "a" }, user: null }; });

it("loads both real query datasets and unique category counts", async () => {
  mount("/saved", () => { destinations = [paris, lisbon, paris]; }); await ready();
  expect(screen.getByRole("button", { name: "Destinations (2)" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Attractions (2)" })).toBeVisible();
  expect(screen.getAllByRole("article")).toHaveLength(4);
  expect(screen.getByText("4 saved places")).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each(["Destinations", "Attractions"])("filters %s and keeps category counts independent of search", async label => {
  mount(); await ready(); fireEvent.click(screen.getByRole("button", { name: `${label} (2)` }));
  expect(names()).toHaveLength(2); expect(names().every(name => name!.startsWith(label === "Destinations" ? "Destination:" : "Attraction:"))).toBe(true);
  expect(screen.getByRole("button", { name: `${label} (2)` })).toHaveAttribute("aria-pressed", "true");
});
it.each([
  ["Paris", ["Attraction: Musée d’Orsay", "Destination: Paris"]],
  ["Portugal", ["Destination: Lisbon", "Attraction: Alfama"]],
  ["mUsEe", ["Attraction: Musée d’Orsay"]],
  ["  FRANCE   culture ", ["Attraction: Musée d’Orsay"]],
  ["ALFAMA", ["Attraction: Alfama"]],
  ["architecture", ["Attraction: Alfama"]],
])("searches loaded data for %s without another request", async (query, expected) => {
  mount(); await ready(); fireEvent.change(screen.getByRole("searchbox", { name: "Search saved places" }), { target: { value: query } });
  expect(names()).toEqual(expected); expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([
  ["Recently saved", ["Attraction: Musée d’Orsay", "Destination: Lisbon", "Attraction: Alfama", "Destination: Paris"]],
  ["Oldest saved", ["Destination: Paris", "Attraction: Alfama", "Destination: Lisbon", "Attraction: Musée d’Orsay"]],
  ["Name A–Z", ["Attraction: Alfama", "Destination: Lisbon", "Attraction: Musée d’Orsay", "Destination: Paris"]],
  ["Name Z–A", ["Destination: Paris", "Attraction: Musée d’Orsay", "Destination: Lisbon", "Attraction: Alfama"]],
])("sorts the combined collection by %s", async (label, expected) => { mount(); await ready(); await sortBy(label); expect(names()).toEqual(expected); });
it.each(["destinations", "attractions"])("removes a %s record and updates counts while preserving filters", async type => {
  mount(`/saved?type=${type}&sort=oldest`); await ready();
  fireEvent.click(screen.getByRole("button", { name: type === "destinations" ? "Unsave Paris" : "Unsave attraction Alfama" }));
  await screen.findByRole("button", { name: "All (3)" });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByTestId("location")).toHaveTextContent(`type=${type}&sort=oldest`);
});
it.each(["Unsave Paris", "Unsave attraction Alfama"])("preserves the card and count if %s fails", async label => {
  mount(); await ready(); failMutation = true;
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove this place");
  expect(screen.getByRole("button", { name: "All (4)" })).toBeVisible(); expect(names()).toHaveLength(4);
});
it("provides immediate accessible loading feedback and blocks repeated removal", async () => {
  mount(); await ready(); deferred = true;
  const button = screen.getByRole("button", { name: "Unsave Paris" }); fireEvent.click(button);
  await waitFor(() => expect(button).toBeDisabled()); expect(button).toHaveAttribute("aria-busy", "true");
  fireEvent.click(button); expect(vi.mocked(fetch).mock.calls.filter(call => call[1]?.method === "DELETE")).toHaveLength(1);
  deferred = false; await act(async () => release!()); await screen.findByRole("button", { name: "All (3)" });
});
it.each([
  ["/saved", "No saved places yet", "Explore destinations", "/explore"],
  ["/saved?type=destinations", "No saved destinations yet", "Explore destinations", "/explore"],
  ["/saved?type=attractions", "No saved attractions yet", "View my trips", "/trips"],
])("shows the right empty state at %s", async (path, title, action, href) => {
  mount(path, () => { destinations = []; attractions = []; });
  expect(await screen.findByRole("heading", { name: title })).toBeVisible(); expect(screen.getByRole("link", { name: action })).toHaveAttribute("href", href);
});
it("distinguishes no search results and clears the search", async () => {
  mount("/saved?q=missing"); await ready(); expect(screen.getByText("No places match your search")).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(1);
  expect(screen.getByRole("searchbox")).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" })); expect(names()).toHaveLength(4); expect(screen.getByRole("searchbox")).toHaveValue("");
});
it("offers exactly one clear button for a filled search with matches", async () => {
  mount("/saved?q=Paris"); await ready();
  expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(1);
  expect(screen.getByRole("searchbox")).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveFocus();
  expect(names()).toHaveLength(4);
});
it("shows card skeletons without flashing empty states", async () => {
  mount("/saved", () => { deferred = true; });
  expect(screen.getAllByTestId("saved-skeleton")).toHaveLength(4); expect(screen.queryByText("No saved places yet")).not.toBeInTheDocument();
  deferred = false; await act(async () => release!()); await ready(); expect(screen.queryByTestId("saved-skeleton")).not.toBeInTheDocument();
});
it.each(["destinations", "attractions"])("preserves working cards when %s fail and retries just that source", async type => {
  mount("/saved", () => { if (type === "destinations") failDestination = true; else failAttraction = true; });
  await screen.findByRole("alert"); expect(names()).toHaveLength(2); expect(screen.queryByText(/database stack/)).not.toBeInTheDocument();
  failDestination = false; failAttraction = false; fireEvent.click(screen.getByRole("button", { name: `Retry ${type}` }));
  await ready(); expect(names()).toHaveLength(4); expect(fetch).toHaveBeenCalledTimes(3);
});
it("handles a full API failure without showing an empty collection", async () => {
  mount("/saved", () => { failDestination = true; failAttraction = true; });
  expect(await screen.findAllByRole("alert")).toHaveLength(2); expect(screen.queryByText("No saved places yet")).not.toBeInTheDocument();
});
it("handles expired guest sessions using existing session expiration events", async () => {
  const listener = vi.fn(); window.addEventListener("triply:session-expired", listener);
  try { mount("/saved", () => { expired = true; }); await screen.findAllByRole("alert"); expect(listener).toHaveBeenCalled(); expect(screen.getAllByText(/Your session has expired/)).toHaveLength(2); } finally { window.removeEventListener("triply:session-expired", listener); }
});
it("isolates page data when the identity changes", async () => {
  const view = mount(); await ready(); destinations = []; attractions = [];
  auth.value = { status: "authenticated", guest: null, user: { id: "b" } };
  view.client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "b" } });
  await act(async () => { await view.client.invalidateQueries({ queryKey: ["saved"] }); });
  view.rerender(<QueryClientProvider client={view.client}><MemoryRouter><SavedPage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText("No saved places yet")).toBeVisible(); expect(screen.queryByText("Paris")).not.toBeInTheDocument();
});
it("opens destination details and navigates to planning with the canonical ID", async () => {
  mount("/saved?type=destinations&q=Paris"); await ready(); fireEvent.click(screen.getByRole("button", { name: "Open destination" }));
  const dialog = await screen.findByRole("dialog", { name: "Paris" }); expect(within(dialog).getByText("France")).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Plan a trip" }));
  expect(await screen.findByText("Trip planning")).toBeVisible(); expect(screen.getByTestId("location")).toHaveTextContent('/home?destinationId=city-001');
});
it("opens retained attraction details without linking to its source trip", async () => {
  mount("/saved?type=attractions&q=musee"); await ready(); fireEvent.click(screen.getByRole("button", { name: "View details" }));
  const dialog = await screen.findByRole("dialog"); expect(within(dialog).getByText("Art on the Seine")).toBeVisible();
  expect(within(dialog).getByRole("link", { name: "View on OpenStreetMap" })).toHaveAttribute("href", "https://www.openstreetmap.org/node/1");
});
it("shares saved status with an attraction detail dialog and closes it after unsaving", async () => {
  mount("/saved?type=attractions&q=musee"); await ready();
  fireEvent.click(screen.getByRole("button", { name: "View details" }));
  const dialog = await screen.findByRole("dialog");
  const button = within(dialog).getByRole("button", { name: "Unsave attraction Musée d’Orsay" });
  expect(button).toHaveAttribute("aria-pressed", "true"); fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "All (3)" })).toBeVisible();
});
it("renders missing destination and snapshot metadata safely and permits removal", async () => {
  mount("/saved", () => { destinations = [{ ...paris, destination: null }]; attractions = [{ ...museum, snapshot: undefined } as unknown as SavedAttraction]; });
  await screen.findByText("Unavailable destination"); expect(screen.getByText("Unavailable attraction")).toBeVisible();
  expect(screen.getByRole("button", { name: "Open destination" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "View details" }));
  const dialog = await screen.findByRole("dialog"); expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" })); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Unsave Unavailable destination" })); await waitFor(() => expect(names()).toHaveLength(1));
});
it("restores URL filters, supports browser back, and ignores invalid options", async () => {
  mount("/saved?type=invalid&sort=invalid"); await ready(); expect(screen.getByRole("button", { name: "All (4)" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Attractions (2)" })); expect(names()).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Browser back" })); await waitFor(() => expect(names()).toHaveLength(4));
});
it("exposes labeled native category buttons and focusable search and sorting controls", async () => {
  mount(); await ready(); const group = screen.getByRole("group", { name: "Saved place categories" });
  expect(within(group).getAllByRole("button")).toHaveLength(3);
  const search = screen.getByRole("searchbox", { name: "Search saved places" }); search.focus(); expect(search).toHaveFocus();
  expect(screen.getByRole("combobox", { name: "Sort saved places" })).toBeVisible();
});
