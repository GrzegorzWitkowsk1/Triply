import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { request } from "../../api/client";
import JourneyPreferencesCard from "./JourneyPreferencesCard";
import i18n from "../../i18n";

vi.mock("../../api/client", () => ({ request: vi.fn() }));
afterEach(async () => { cleanup(); vi.resetAllMocks(); await i18n.changeLanguage("en"); });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "account", email: "test@example.com" } });
  render(<QueryClientProvider client={client}><JourneyPreferencesCard /></QueryClientProvider>);
  return client;
}

it("shows the persisted default and saves the Settings toggle with a revision guard", async () => {
  let value = true; let revision = 0;
  vi.mocked(request).mockImplementation(async (_url, options) => {
    if (options?.method === "PATCH") { const body = JSON.parse(String(options.body)); expect(body.expectedRevision).toBe(0); value = body.promptForExpenseAfterVisit; revision++; }
    return { preferences: { promptForExpenseAfterVisit: value }, revision };
  });
  const client = mount();
  const toggle = await screen.findByLabelText("Ask to add expenses after visiting a place");
  await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
  expect((toggle as HTMLInputElement).checked).toBe(true);
  toggle.focus(); expect(document.activeElement).toBe(toggle);
  fireEvent.click(toggle);
  await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
  expect(client.getQueryData(["journey-preferences", "account"])).toEqual({ preferences: { promptForExpenseAfterVisit: false }, revision: 1 });
  client.clear();
});

it("keeps the persisted value and a visible error after a failed Settings save", async () => {
  vi.mocked(request).mockImplementation(async (_url, options) => {
    if (options?.method === "PATCH") throw new Error("Network failure");
    return { preferences: { promptForExpenseAfterVisit: true }, revision: 0 };
  });
  const client = mount(); const toggle = await screen.findByLabelText("Ask to add expenses after visiting a place");
  await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false)); fireEvent.click(toggle);
  expect(await screen.findByText(/Could not save or load your Journey preference/)).toBeTruthy();
  expect((toggle as HTMLInputElement).checked).toBe(true); client.clear();
});

it("ignores a delayed preference refetch with an older revision", async () => {
  let release!: (result: unknown) => void;
  vi.mocked(request).mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const client = mount(); await waitFor(() => expect(release).toBeTypeOf("function"));
  client.setQueryData(["journey-preferences", "account"], { preferences: { promptForExpenseAfterVisit: false }, revision: 8 });
  release({ preferences: { promptForExpenseAfterVisit: true }, revision: 2 });
  await waitFor(() => expect(client.getQueryState(["journey-preferences", "account"])?.fetchStatus).toBe("idle"));
  expect((screen.getByLabelText("Ask to add expenses after visiting a place") as HTMLInputElement).checked).toBe(false); client.clear();
});

it("uses Polish labels for the preference", async () => {
  await i18n.changeLanguage("pl");
  vi.mocked(request).mockResolvedValue({ preferences: { promptForExpenseAfterVisit: false }, revision: 1 });
  const client = mount();
  const toggle = await screen.findByLabelText("Pytaj o dodanie wydatku po odwiedzeniu miejsca");
  await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false)); client.clear();
});
