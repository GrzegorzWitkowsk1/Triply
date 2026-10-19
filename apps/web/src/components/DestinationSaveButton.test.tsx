import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DestinationSaveButton from "./DestinationSaveButton";
import SavedPage from "../pages/SavedPage";
import { findDestination } from "@triply/shared";
const auth = vi.hoisted(() => ({ value: { status: "guest", guest: { id: "a" }, user: null } as { status: string; guest: { id: string } | null; user: { id: string } | null } }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => auth.value }));
let saved = false;
let fail = false;
let finish: (() => void) | undefined;
let defer = false;
const clients: QueryClient[] = [];
function mount(content: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(["auth", "session"], { status: "guest", guest: { id: "a" } });
  vi.stubGlobal("fetch", vi.fn(async (_path: string, options?: RequestInit) => {
    if (String(_path).includes("/saved/attractions")) return new Response(JSON.stringify({ attractions: [], attractionKeys: [] }));
    if (options?.method) {
      if (defer) await new Promise<void>(resolve => { finish = resolve; });
      if (fail) return new Response(JSON.stringify({ error: "Save failed" }), { status: 500 });
      saved = options.method === "POST";
      return new Response(options.method === "DELETE" ? null : "{}", { status: options.method === "DELETE" ? 204 : 200 });
    }
    const body = String(_path).endsWith("status") ? { destinationIds: saved ? ["city-001"] : [] } : { destinations: saved ? [{ destinationId: "city-001", createdAt: "2026-10-19", destination: findDestination("city-001") }] : [] };
    return new Response(JSON.stringify(body));
  }));
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  return { ...render(content, { wrapper }), client };
}
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); saved = false; fail = false; defer = false; finish = undefined; auth.value = { status: "guest", guest: { id: "a" }, user: null }; });
it("renders outline/filled hearts, prevents parent navigation and synchronizes all cards", async () => {
  const navigate = vi.fn();
  mount(<div onClick={navigate}><DestinationSaveButton destinationId="city-001" name="Paris" /><DestinationSaveButton destinationId="city-001" name="Paris" /></div>);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Save Paris" })[0]).toBeEnabled());
  expect(screen.getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getAllByRole("button", { name: "Save Paris" })[0]);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Unsave Paris" })).toHaveLength(2));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Unsave Paris" })[1]);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Save Paris" })).toHaveLength(2));
});
it("disables every copy during mutation, and preserves state after failure", async () => {
  defer = true; fail = true;
  mount(<><DestinationSaveButton destinationId="city-001" name="Paris" /><DestinationSaveButton destinationId="city-001" name="Paris" /></>);
  await waitFor(() => expect(screen.getAllByRole("button")[0]).toBeEnabled());
  fireEvent.click(screen.getAllByRole("button")[0]);
  await waitFor(() => expect(screen.getAllByRole("button").every(button => button.hasAttribute("disabled"))).toBe(true));
  await waitFor(() => expect(finish).toBeTypeOf("function")); finish!();
  await screen.findByRole("alert");
  expect(screen.getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "false");
});
it("shows empty Saved state", async () => { mount(<SavedPage />); expect(await screen.findByText(/No saved places yet/)).toBeVisible(); });
it("lists real destinations and removes them immediately", async () => {
  saved = true; mount(<SavedPage />);
  expect(await screen.findByText("Paris")).toBeVisible();
  expect(screen.getByRole("button", { name: /Plan a trip/ })).toBeVisible();
  const remove = await screen.findByRole("button", { name: "Unsave Paris" });
  await waitFor(() => expect(remove).toBeEnabled()); fireEvent.click(remove);
  expect(await screen.findByText(/No saved places yet/)).toBeVisible();
});
it("uses a native keyboard-focusable button with a changing accessible label", async () => {
  saved = true; mount(<DestinationSaveButton destinationId="city-001" name="Paris" />);
  const button = await screen.findByRole("button", { name: "Unsave Paris" });
  await waitFor(() => expect(button).toBeEnabled()); button.focus(); expect(button).toHaveFocus(); expect(button.tagName).toBe("BUTTON");
});
it("does not expose old cached IDs after identity changes", async () => {
  saved = true; const view = mount(<DestinationSaveButton destinationId="city-001" name="Paris" />);
  await screen.findByRole("button", { name: "Unsave Paris" });
  saved = false; auth.value = { status: "guest", guest: { id: "b" }, user: null };
  view.client.setQueryData(["auth", "session"], { status: "guest", guest: { id: "b" } });
  view.rerender(<DestinationSaveButton destinationId="city-001" name="Paris" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save Paris" })).toBeEnabled());
});
import "@testing-library/jest-dom/vitest";
