import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DESTINATIONS } from "@triply/shared";
import ExplorePage from "./ExplorePage";
import SavedPage from "./SavedPage";
import { readExploreQuery } from "../hooks/useExploreState";

const auth = vi.hoisted(() => ({ value: { status: "guest", guest: { id: "a" }, user: null } as { status: string; guest: { id: string } | null; user: { id: string } | null } }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => auth.value }));
const clients: QueryClient[] = [];
let failed = false;
let empty = false;
let saved = false;
let deferred = false;
let release: (() => void) | undefined;
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client); client.setQueryData(["auth", "session"], auth.value);
  const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === "/api/destinations/filters") return new Response(JSON.stringify({ total: empty ? 0 : DESTINATIONS.length, countries: [], regions: [], interests: [] }));
    if (path.startsWith("/api/destinations")) {
      if (deferred) await new Promise<void>(resolve => { release = resolve; });
      if (failed) return new Response("{}", { status: 500 });
      const page = Number(new URL(path, "http://localhost").searchParams.get("page"));
      return new Response(JSON.stringify({ items: empty ? [] : DESTINATIONS.slice((page - 1) * 24, page * 24), total: empty ? 0 : DESTINATIONS.length, page, pageSize: 24 }));
    }
    if (path.includes("attractions")) return new Response(JSON.stringify({ attractions: [] }));
    if (options?.method === "POST") saved = true;
    if (options?.method === "DELETE") { saved = false; return new Response(null, { status: 204 }); }
    return new Response(JSON.stringify(path.endsWith("status") ? { destinationIds: saved ? ["city-001"] : [] }
      : { destinations: saved ? [{ destinationId: "city-001", destination: DESTINATIONS[0], createdAt: "2026-01-01" }] : [] }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/explore"]}><Routes>
    <Route path="/explore" element={<ExplorePage />} /><Route path="/login" element={<h1>Sign in or continue as guest</h1>} />
    <Route path="/home" element={<h1>Trip planning</h1>} />
  </Routes><SavedPage /></MemoryRouter></QueryClientProvider>);
  return { client, fetcher };
}
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); failed = false; empty = false; saved = false; deferred = false; release = undefined; auth.value = { status: "guest", guest: { id: "a" }, user: null }; });
const parisCard = () => screen.getAllByRole("article", { name: "Destination: Paris" }).find(card => card.hasAttribute("data-destination-id"))!;
it.each(["anonymous", "guest", "authenticated"])("loads API cities and countries as %s without mock statistics", async status => {
  auth.value = { status, guest: status === "guest" ? { id: "a" } : null, user: status === "authenticated" ? { id: "u" } : null };
  const { fetcher } = mount();
  await screen.findByRole("article", { name: "Destination: Paris" });
  expect(within(parisCard()).getByText("France")).toBeVisible();
  expect(within(screen.getByRole("article", { name: "Destination: Barcelona" })).getByText("Spain")).toBeVisible();
  expect(screen.queryByText(/activities|Trending this season/)).toBeNull();
  expect(fetcher.mock.calls.filter(([path]) => path.startsWith("/api/destinations?"))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith("/status"))).toHaveLength(status === "anonymous" ? 0 : 1);
});
it("shows loading skeletons, then real results", async () => {
  deferred = true; mount(); expect(screen.getAllByTestId("explore-skeleton")).toHaveLength(4);
  await waitFor(() => expect(release).toBeTypeOf("function")); await act(async () => release!());
  await screen.findByRole("article", { name: "Destination: Paris" }); expect(screen.queryByTestId("explore-skeleton")).toBeNull();
});
it("shows the empty catalog", async () => { empty = true; mount(); expect(await screen.findByText("No destinations available yet.")).toBeVisible(); });
it("shows an error and retries", async () => {
  failed = true; mount(); await screen.findByText("Could not load destinations. Please try again.");
  failed = false; fireEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByRole("article", { name: "Destination: Paris" });
});
it("paginates through disjoint canonical identities and returns to the first page", async () => {
  mount(); await screen.findByRole("article", { name: "Destination: Paris" });
  const first = screen.getAllByRole("article").map(card => card.getAttribute("data-destination-id")).filter(Boolean);
  fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
  await screen.findByRole("article", { name: `Destination: ${DESTINATIONS[24]!.city}` });
  expect(screen.getAllByRole("article").filter(card => card.hasAttribute("data-destination-id")).every(card => !first.includes(card.getAttribute("data-destination-id")))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Go to page 1" })); await screen.findByRole("article", { name: "Destination: Paris" });
});
it("handles broken images, uses lazy loading, and preserves source and license links", async () => {
  mount(); await screen.findByRole("article", { name: "Destination: Paris" });
  const image = within(parisCard()).getByAltText("Paris"); expect(image).toHaveAttribute("loading", "lazy");
  expect(within(parisCard()).getByRole("link", { name: "Wikimedia Commons" })).toHaveAttribute("href", DESTINATIONS[0]!.sourceUrl);
  fireEvent.error(image); expect(within(parisCard()).getByRole("img", { name: "Paris: image unavailable" })).toBeVisible();
});
it("falls back when image or country is missing", async () => {
  const { client } = mount(); await screen.findByRole("article", { name: "Destination: Paris" });
  act(() => { client.setQueryData(["destinations", "explore", readExploreQuery(new URLSearchParams())], { items: [{ ...DESTINATIONS[0], imageUrl: "", country: "" }], total: 1, page: 1, pageSize: 24 }); });
  await waitFor(() => expect(within(parisCard()).getByRole("img", { name: "Paris: image unavailable" })).toBeVisible());
  expect(within(parisCard()).getByText("Country unavailable")).toBeVisible();
});
it("saves into Saved and unsaves there with synchronized Explore state", async () => {
  mount(); await screen.findByRole("article", { name: "Destination: Paris" });
  const save = within(parisCard()).getByRole("button", { name: "Save Paris" });
  await waitFor(() => expect(save).toBeEnabled()); fireEvent.click(save);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Unsave Paris" })).toHaveLength(2));
  const savedCard = screen.getAllByRole("article", { name: "Destination: Paris" }).find(card => !card.hasAttribute("data-destination-id"))!;
  fireEvent.click(within(savedCard).getByRole("button", { name: "Unsave Paris" }));
  await waitFor(() => expect(within(parisCard()).getByRole("button", { name: "Save Paris" })).toHaveAttribute("aria-pressed", "false"));
});
it("opens the existing destination dialog and planning action", async () => {
  mount(); await screen.findByRole("article", { name: "Destination: Paris" });
  fireEvent.click(within(parisCard()).getByRole("button", { name: "Open destination" }));
  const dialog = await screen.findByRole("dialog"); expect(within(dialog).getByText("France")).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Plan a trip" }));
  expect(await screen.findByRole("heading", { name: "Trip planning" })).toBeVisible();
});
it("routes anonymous Save clicks into existing identity entry without creating a session", async () => {
  auth.value = { status: "anonymous", guest: null, user: null }; const { fetcher } = mount();
  await screen.findByRole("article", { name: "Destination: Paris" }); fireEvent.click(within(parisCard()).getByRole("button", { name: "Save Paris" }));
  expect(await screen.findByRole("heading", { name: "Sign in or continue as guest" })).toBeVisible();
  expect(fetcher.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
