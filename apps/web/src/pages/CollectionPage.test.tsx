import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { CURATED_COLLECTIONS, findDestination, findCuratedCollection } from "@triply/shared";
import CollectionPage from "./CollectionPage";
import ExplorePage from "./ExplorePage";
import SavedPage from "./SavedPage";

const auth = vi.hoisted(() => ({ status: "guest" }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ status: auth.status, guest: auth.status === "guest" ? { id: "g" } : null, user: auth.status === "authenticated" ? { id: "u" } : null }) }));
let client: QueryClient;
let failure = false, empty = false, missing = false, deferred = false, failSave = false;
let release: (() => void) | undefined;
function Probe() { const location = useLocation(), navigate = useNavigate(); return <><output data-testid="url">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate("/saved")}>Go Saved</button></>; }
function mount(path = "/explore/collections/food-first-weekends") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const saved = new Set<string>();
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/destinations/collections/")) {
      if (deferred) await new Promise<void>(resolve => { release = resolve; });
      if (failure) return new Response("{}", { status: 503 });
      const slug = path.split("/").at(-1)!;
      return new Response(JSON.stringify({ slug, items: empty ? [] : findCuratedCollection(slug)!.destinationIds.filter(id => !missing || id !== "city-003").map(id => findDestination(id)) }));
    }
    if (path === "/api/destinations/filters") return new Response(JSON.stringify({ total: 0, countries: [], regions: [], interests: [] }));
    if (path.startsWith("/api/destinations?")) return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 24 }));
    if (init?.method === "POST") { if (failSave) return new Response("{}", { status: 503 }); saved.add(JSON.parse(String(init.body)).destinationId); return new Response("{}"); }
    if (init?.method === "DELETE") { saved.delete(path.split("/").at(-1)!); return new Response(null, { status: 204 }); }
    if (path.includes("attractions")) return new Response(JSON.stringify({ attractions: [] }));
    if (path.endsWith("status")) return new Response(JSON.stringify({ destinationIds: [...saved] }));
    return new Response(JSON.stringify({ destinations: [...saved].map(id => ({ destinationId: id, destination: findDestination(id), createdAt: "2030-01-01" })) }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Probe /><Routes>
    <Route path="/explore" element={<ExplorePage />} /><Route path="/explore/collections/:slug" element={<CollectionPage />} />
    <Route path="/saved" element={<SavedPage />} /><Route path="/home" element={<h1>Existing wizard</h1>} /><Route path="/login" element={<h1>Enter Guest Mode or sign in</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return fetcher;
}
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); failure = empty = missing = deferred = failSave = false; release = undefined; auth.status = "guest"; });
it("keeps all four editorial titles and descriptions and actionable destination links", async () => {
  mount("/explore?q=barce&country=spain&sort=name-desc&page=2");
  for (const collection of CURATED_COLLECTIONS) {
    expect(screen.getByRole("heading", { name: collection.title }).closest("a")).toHaveAttribute("href", `/explore/collections/${collection.slug}`);
    expect(screen.getByText(collection.description)).toBeVisible();
  }
  const chip = screen.getByRole("link", { name: "Explore Barcelona in Food-first weekends" });
  fireEvent.click(chip);
  await screen.findByRole("article", { name: "Destination: Barcelona" });
  await waitFor(() => expect(document.getElementById("collection-city-003")).toHaveFocus());
  expect(screen.getByRole("link", { name: "Back to Explore" })).toHaveAttribute("href", "/explore?q=barce&country=spain&sort=name-desc&page=2");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByTestId("url")).toHaveTextContent("country=spain&sort=name-desc&page=2");
});
it.each(["anonymous", "guest", "authenticated"])("renders real catalog destinations and preferences as %s with one bounded lookup", async status => {
  auth.status = status; const fetcher = mount();
  const card = await screen.findByRole("article", { name: "Destination: Barcelona" });
  expect(within(card).getByText("Spain")).toBeVisible(); expect(screen.getByText("Bologna")).toBeVisible();
  expect(screen.getByText("Pace: Relaxed")).toBeVisible(); expect(screen.getByText("Culture")).toBeVisible();
  expect(fetcher.mock.calls.filter(([path]) => path.startsWith("/api/destinations"))).toHaveLength(1);
  expect(client.getQueryData(["destinations", "detail", "city-003"])).toMatchObject({ city: "Barcelona" });
  if (status === "anonymous") expect(fetcher).toHaveBeenCalledTimes(1);
});
it("supports unknown and malformed collection URLs without fetching unrelated data", () => {
  const fetcher = mount("/explore/collections/unknown"); expect(screen.getByRole("heading", { name: "Collection not found" })).toBeVisible();
  expect(fetcher.mock.calls.some(([path]) => path.startsWith("/api/destinations"))).toBe(false);
});
it("shows loading, then resolves without substituting a missing city", async () => {
  deferred = true; missing = true; mount(); expect(screen.getAllByTestId("collection-skeleton")).toHaveLength(2);
  await waitFor(() => expect(release).toBeTypeOf("function")); await act(async () => release!());
  await screen.findByRole("article", { name: "Destination: Bologna" }); expect(screen.queryByRole("article", { name: "Destination: Barcelona" })).toBeNull();
  expect(screen.getAllByRole("article")).toHaveLength(1);
});
it("distinguishes a truly empty collection from API failure and offers retry", async () => {
  failure = true; empty = true; mount(); await screen.findByText("Could not load collection destinations. Please try again.");
  expect(screen.queryByText("No destinations are currently available in this collection.")).toBeNull();
  failure = false; fireEvent.click(screen.getByRole("button", { name: "Retry collection" }));
  expect(await screen.findByText("No destinations are currently available in this collection.")).toBeVisible();
});
it("shares saved status with Saved, retains the collection URL and recovers from failed mutations", async () => {
  failSave = true; const fetcher = mount(); const save = await screen.findByRole("button", { name: "Save Barcelona" });
  await waitFor(() => expect(save).toBeEnabled()); fireEvent.click(save);
  await screen.findByText("Could not update Saved for Barcelona. Please try again."); expect(save).toHaveAttribute("aria-pressed", "false");
  failSave = false; fireEvent.click(save); await screen.findByRole("button", { name: "Unsave Barcelona" });
  expect(screen.getByTestId("url")).toHaveTextContent("/explore/collections/food-first-weekends");
  fireEvent.click(screen.getByRole("button", { name: "Go Saved" })); await screen.findByRole("article", { name: "Destination: Barcelona" });
  fireEvent.click(screen.getByRole("button", { name: "Unsave Barcelona" })); await screen.findByText("No saved places yet");
  fireEvent.click(screen.getByRole("button", { name: "Back" })); await screen.findByRole("button", { name: "Save Barcelona" });
  expect(fetcher.mock.calls.filter(([path]) => path.startsWith("/api/destinations/collections"))).toHaveLength(1);
});
it("uses existing image fallback, nested details, and canonical collection planning URL", async () => {
  mount(); const card = await screen.findByRole("article", { name: "Destination: Barcelona" });
  fireEvent.error(within(card).getByAltText("Barcelona")); expect(within(card).getByRole("img", { name: "Barcelona: image unavailable" })).toBeVisible();
  fireEvent.click(within(card).getByRole("button", { name: "Open destination" }));
  const dialog = screen.getByRole("dialog"); expect(dialog).toHaveTextContent("Spain");
  fireEvent.click(within(dialog).getByRole("button", { name: "Plan a trip" }));
  expect(screen.getByTestId("url")).toHaveTextContent("/home?destinationId=city-003&collection=food-first-weekends");
});
it("anonymous Save uses the existing identity entry flow", async () => {
  auth.status = "anonymous"; mount(); fireEvent.click(await screen.findByRole("button", { name: "Save Barcelona" }));
  expect(await screen.findByRole("heading", { name: "Enter Guest Mode or sign in" })).toBeVisible();
});
