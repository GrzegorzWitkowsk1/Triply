import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { DESTINATIONS, destinationQuerySchema, normalizeDestinationText } from "@triply/shared";
import ExplorePage from "./ExplorePage";
import SavedPage from "./SavedPage";

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ status: "guest", guest: { id: "test" }, user: null }) }));
const clients: QueryClient[] = [];
let enriched = false;
let metadataFailed = false;
let listFailed = false;
let delayedQuery = "";
let release: (() => void) | undefined;
let releasePage: (() => void) | undefined;
let deferPage = false;
let failStatus = false;
let malformedList = false;
let malformedStatus = false;
function Probe() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output data-testid="url">{location.pathname}{location.search}</output>
    <button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button>
    <button onClick={() => navigate("/saved")}>Go to Saved</button></>;
}
function mount(path = "/explore") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client); client.setQueryData(["auth", "session"], { status: "guest", guest: { id: "test" } });
  const saved = new Set<string>();
  const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === "/api/destinations/filters") {
      if (metadataFailed) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ total: 212,
        countries: [...new Set(DESTINATIONS.map(row => row.country))].map(country => ({ id: normalizeDestinationText(country), name: country, count: DESTINATIONS.filter(row => row.country === country).length })),
        regions: enriched ? [{ id: "spain:test region", countryId: "spain", name: "Test Region", count: 1 }] : [],
        interests: enriched ? [{ id: "culture", label: "Culture", count: 1 }, { id: "food", label: "Food", count: 1 }] : [],
      }));
    }
    if (path.startsWith("/api/destinations?")) {
      if (malformedList) return new Response(JSON.stringify({ items: "invalid" }));
      if (listFailed) return new Response("{}", { status: 500 });
      const query = destinationQuerySchema.parse(Object.fromEntries(new URL(path, "http://localhost").searchParams));
      if (deferPage && query.page > 1) await new Promise<void>(resolve => { releasePage = resolve; });
      if (query.q && query.q === delayedQuery) await new Promise<void>(resolve => { release = resolve; });
      const rows = DESTINATIONS.filter(row => {
        if (query.country && normalizeDestinationText(row.country) !== query.country) return false;
        if (query.region && row.id !== "city-003") return false;
        if (query.interests.length && row.id !== "city-003") return false;
        return normalizeDestinationText(query.q).split(" ").every(word => normalizeDestinationText(`${row.city} ${row.country}`).includes(word));
      }).sort((a, b) => {
        const left = normalizeDestinationText(query.sort === "country-asc" ? `${a.country}|${a.city}` : a.city);
        const right = normalizeDestinationText(query.sort === "country-asc" ? `${b.country}|${b.city}` : b.city);
        return (left < right ? -1 : left > right ? 1 : 0) * (query.sort === "name-desc" ? -1 : 1) || a.id.localeCompare(b.id);
      });
      const page = Math.min(query.page, Math.max(1, Math.ceil(rows.length / 24)));
      return new Response(JSON.stringify({ items: rows.slice((page - 1) * 24, page * 24), total: rows.length, page, pageSize: 24 }));
    }
    if (path.endsWith("/status") && failStatus) return new Response("{}", { status: 503 });
    if (path.endsWith("/status") && malformedStatus) return new Response(JSON.stringify({ destinationIds: {} }));
    if (path.includes("attractions")) return new Response(JSON.stringify({ attractions: [] }));
    if (options?.method === "POST") saved.add(JSON.parse(options.body as string).destinationId);
    if (options?.method === "DELETE") { saved.delete(path.split("/").at(-1)!); return new Response(null, { status: 204 }); }
    return new Response(JSON.stringify(path.endsWith("/status") ? { destinationIds: [...saved] } : { destinations: [...saved].map(id => ({ destinationId: id, destination: DESTINATIONS.find(row => row.id === id), createdAt: "2026-01-01" })) }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Probe /><Routes>
    <Route path="/explore" element={<ExplorePage />} /><Route path="/saved" element={<SavedPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return { client, fetcher };
}
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); enriched = false; metadataFailed = false; listFailed = false; delayedQuery = ""; release = undefined; deferPage = false; releasePage = undefined; failStatus = false; malformedList = false; malformedStatus = false; });
const url = () => screen.getByTestId("url").textContent!;
const listings = (fetcher: ReturnType<typeof mount>["fetcher"]) => fetcher.mock.calls.filter(([path]) => path.startsWith("/api/destinations?"));
async function select(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
it("labels discovery controls and hides filters with no stored classifications", async () => {
  mount(); await screen.findByText("212 destinations found");
  expect(screen.getByRole("searchbox", { name: "Search destinations" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Country" })).toBeEnabled();
  expect(screen.getByRole("combobox", { name: "Sort destinations" })).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Region" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Destination interests" })).toBeNull();
});
it("debounces rapid typing and replaces the URL without a request per key", async () => {
  const { fetcher } = mount(); await screen.findByText("212 destinations found");
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "b" } }); fireEvent.change(input, { target: { value: "bar" } }); fireEvent.change(input, { target: { value: "barce" } });
  expect(listings(fetcher)).toHaveLength(1); expect(screen.getByText("Loading destinations…")).toBeVisible();
  await screen.findByText("1 destinations found"); expect(url()).toBe("/explore?q=barce"); expect(listings(fetcher)).toHaveLength(2);
});
it("clears search immediately", async () => {
  mount("/explore?q=barce"); await screen.findByText("1 destinations found");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByRole("searchbox")).toHaveValue(""); expect(url()).toBe("/explore"); await screen.findByText("212 destinations found");
  expect(screen.getByRole("searchbox")).toHaveFocus();
});
it("initializes combined filters and sort from a bookmarked URL", async () => {
  mount("/explore?q=barce&country=spain&sort=country-asc"); await screen.findByText("1 destinations found");
  expect(screen.getByRole("searchbox")).toHaveValue("barce");
  expect(screen.getByRole("combobox", { name: "Country" })).toHaveTextContent("Spain");
  expect(screen.getByRole("combobox", { name: "Sort destinations" })).toHaveTextContent("Country A–Z");
});
it("selects real countries, combines search and resets pagination", async () => {
  const { fetcher } = mount("/explore?page=3"); await screen.findByText("212 destinations found");
  await select("Country", "Spain"); await screen.findByText("10 destinations found");
  expect(url()).toBe("/explore?country=spain");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "barce" } }); await screen.findByText("1 destinations found");
  const request = new URL(listings(fetcher).at(-1)![0], "http://localhost"); expect(request.searchParams.get("country")).toBe("spain");
});
it("preserves all filters through pagination", async () => {
  mount("/explore?q=a&sort=name-desc"); await waitFor(() => expect(screen.queryByText("Loading destinations…")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
  await waitFor(() => expect(url()).toContain("page=2")); expect(url()).toContain("q=a"); expect(url()).toContain("sort=name-desc");
});
it("sorts on the server and resets the page", async () => {
  const { fetcher } = mount("/explore?page=2"); await screen.findByText("212 destinations found");
  await select("Sort destinations", "Name Z–A"); await waitFor(() => expect(url()).toBe("/explore?sort=name-desc"));
  await waitFor(() => expect(listings(fetcher).at(-1)![0]).toContain("sort=name-desc"));
});
it("restores country, sort and search through Back and Forward", async () => {
  mount(); await screen.findByText("212 destinations found");
  await select("Country", "Spain"); await screen.findByText("10 destinations found");
  await select("Sort destinations", "Name Z–A"); await waitFor(() => expect(url()).toContain("name-desc"));
  fireEvent.click(screen.getByRole("button", { name: "Back" })); await waitFor(() => expect(url()).toBe("/explore?country=spain"));
  expect(screen.getByRole("combobox", { name: "Sort destinations" })).toHaveTextContent("Name A–Z");
  fireEvent.click(screen.getByRole("button", { name: "Forward" })); await waitFor(() => expect(url()).toContain("name-desc"));
});
it("does not replay pending typing after browser navigation", async () => {
  mount(); await screen.findByText("212 destinations found"); await select("Country", "Spain"); await screen.findByText("10 destinations found");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "barce" } }); fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByText("212 destinations found"); await new Promise(resolve => setTimeout(resolve, 350));
  expect(url()).toBe("/explore"); expect(screen.getByRole("searchbox")).toHaveValue("");
});
it("safely falls back for invalid URL values while retaining valid search", async () => {
  const { fetcher } = mount("/explore?q=barce&page=-3&sort=popular&interests=unknown&region=invalid");
  await screen.findByText("1 destinations found");
  const request = new URL(listings(fetcher).at(-1)![0], "http://localhost");
  expect(request.searchParams.get("page")).toBe("1"); expect(request.searchParams.get("sort")).toBe("name-asc");
  expect(request.searchParams.has("region")).toBe(false); expect(request.searchParams.has("interests")).toBe(false);
});
it("canonicalizes an out-of-range page after filtering", async () => {
  mount("/explore?q=barce&page=999"); await screen.findByText("1 destinations found");
  await waitFor(() => expect(url()).toBe("/explore?q=barce"));
});
it("distinguishes no matches and clears all controls and URL state", async () => {
  mount("/explore?q=nomatch&country=spain&sort=name-desc");
  expect(await screen.findByText("No destinations found. Try another search or remove some filters.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" })); await screen.findByText("212 destinations found");
  expect(url()).toBe("/explore"); expect(screen.getByRole("searchbox")).toHaveValue("");
});
it("supports curated regions and interests only when metadata exists", async () => {
  enriched = true; mount("/explore?country=spain"); await screen.findByText("10 destinations found");
  await select("Region", "Test Region"); await screen.findByText("1 destinations found");
  const culture = within(screen.getByRole("group", { name: "Destination interests" })).getByRole("button", { name: "Culture" });
  fireEvent.click(culture); await waitFor(() => expect(culture).toHaveAttribute("aria-pressed", "true")); expect(url()).toContain("interests=culture");
  fireEvent.click(within(screen.getByRole("group", { name: "Destination interests" })).getByRole("button", { name: "Food" }));
  expect(url()).toContain("interests=culture%2Cfood");
  await select("Country", "France"); expect(url()).not.toContain("region=");
});
it("can retry filter metadata separately", async () => {
  metadataFailed = true; mount(); await screen.findByText("Could not load filter options. Search and sorting are still available.");
  metadataFailed = false; fireEvent.click(screen.getByRole("button", { name: "Retry filters" }));
  await waitFor(() => expect(screen.queryByText("Could not load filter options. Search and sorting are still available.")).toBeNull());
});
it("keeps the filtered URL and catalog cache while saving and unsaving", async () => {
  const { fetcher } = mount("/explore?q=barce&country=spain&sort=name-desc"); await screen.findByText("1 destinations found");
  const current = url(); const before = listings(fetcher).length;
  const save = screen.getByRole("button", { name: "Save Barcelona" }); await waitFor(() => expect(save).toBeEnabled()); fireEvent.click(save);
  await screen.findByRole("button", { name: "Unsave Barcelona" }); expect(url()).toBe(current);
  fireEvent.click(screen.getByRole("button", { name: "Unsave Barcelona" })); await screen.findByRole("button", { name: "Save Barcelona" });
  expect(url()).toBe(current); expect(listings(fetcher)).toHaveLength(before);
  expect(fetcher.mock.calls.filter(([path]) => path === "/api/destinations/filters")).toHaveLength(1);
});
it("passes an abort signal and keeps keyboard focus during search", async () => {
  const { fetcher } = mount(); await screen.findByText("212 destinations found");
  expect(listings(fetcher)[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  const input = screen.getByRole("searchbox"); input.focus(); expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "barce" } }); await screen.findByText("1 destinations found");
  expect(input).toHaveFocus();
});
it("aborts an obsolete search and ignores its response if it arrives late", async () => {
  delayedQuery = "paris";
  const { fetcher } = mount(); await screen.findByText("212 destinations found");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "paris" } });
  await waitFor(() => expect(release).toBeTypeOf("function"));
  const oldRequest = listings(fetcher).find(([path]) => path.includes("q=paris"))!;
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "barce" } });
  await screen.findByRole("article", { name: "Destination: Barcelona" });
  expect(oldRequest[1]?.signal?.aborted).toBe(true);
  await act(async () => release!());
  expect(screen.queryByRole("article", { name: "Destination: Paris" })).toBeNull();
  expect(screen.getByRole("article", { name: "Destination: Barcelona" })).toBeVisible();
});
it("does not discard pending typing when an older page response clamps the URL", async () => {
  deferPage = true; mount("/explore?page=999");
  await waitFor(() => expect(releasePage).toBeTypeOf("function"));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "barce" } });
  await act(async () => releasePage!());
  expect(screen.getByRole("searchbox")).toHaveValue("barce");
  await screen.findByText("1 destinations found"); expect(url()).toBe("/explore?q=barce");
});
it("retries failed Saved status once for the page and enables all hearts", async () => {
  failStatus = true; const { fetcher } = mount("/explore?q=barce");
  await screen.findByText("Could not load Saved status. Your collection has not changed.");
  expect(screen.getByRole("button", { name: "Save Barcelona" })).toBeDisabled();
  failStatus = false; fireEvent.click(screen.getByRole("button", { name: "Retry Saved status" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save Barcelona" })).toBeEnabled());
  expect(listings(fetcher)).toHaveLength(1);
});
it("recovers from malformed destination and Saved-status responses without rendering raw diagnostics", async () => {
  malformedList = true; malformedStatus = true; mount("/explore?q=barce");
  await screen.findByText("Could not load destinations. Please try again.");
  await screen.findByText("Could not load Saved status. Your collection has not changed.");
  malformedList = false; malformedStatus = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry Saved status" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save Barcelona" })).toBeEnabled());
  expect(screen.queryByText(/ZodError|invalid_type/)).toBeNull();
});
