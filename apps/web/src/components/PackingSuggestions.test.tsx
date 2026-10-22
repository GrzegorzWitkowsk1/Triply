import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PackingPreview, TripEquipmentItem } from "@triply/shared";
import PackingSuggestions from "./PackingSuggestions";
import { generatePackingPreview, applyPackingPreview, getPackingContext } from "../api/packing";
import { getEquipment } from "../api/equipment";
vi.mock("../api/packing", () => ({ generatePackingPreview: vi.fn(), applyPackingPreview: vi.fn(), getPackingContext: vi.fn() }));
vi.mock("../api/equipment", () => ({ getEquipment: vi.fn() }));
const fixture = (): PackingPreview => ({ token: "signed-preview", generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), contextVersion: "version", warnings: ["Forecast is unavailable; review seasonal guidance."], suggestions: [
  { id: "00000000-0000-4000-8000-000000000001", name: "Walking shoes", category: "clothing", count: 1, reason: "Your itinerary includes walking days." },
  { id: "00000000-0000-4000-8000-000000000002", name: "Phone charger", category: "electronics", count: 2, reason: "Keep devices charged." },
] });
let client: QueryClient;
let records: TripEquipmentItem[];
beforeEach(() => {
  vi.mocked(getPackingContext).mockResolvedValue({ contextFingerprint: "version", generation: null, outdated: false });
  records = [{ id: "passport", name: "Passport", category: "documents", count: 1, packed: true }];
  vi.mocked(getEquipment).mockImplementation(async () => ({ equipment: records }));
  vi.mocked(generatePackingPreview).mockResolvedValue(fixture());
  vi.mocked(applyPackingPreview).mockImplementation(async (_trip, input) => {
    const added = fixture().suggestions.filter(item => input.selectedIds.includes(item.id)).map(item => ({ ...item, packed: false }));
    records = [...records, ...added]; return { added, skipped: [], stale: false };
  });
});
afterEach(() => { cleanup(); client?.clear(); vi.resetAllMocks(); });
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const content = (trip = "a", identity = "owner") => <QueryClientProvider client={client}><PackingSuggestions key={`${identity}:${trip}`} tripId={trip} /></QueryClientProvider>;
  const result = render(content()); return { ...result, switchTo: (trip: string, identity?: string) => result.rerender(content(trip, identity)) };
}
async function open() {
  const button = screen.getByRole("button", { name: "Generate packing list" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button);
  await screen.findByText("Walking shoes"); return within(screen.getByRole("dialog", { name: "Packing suggestions" }));
}
it("generates and renders reviewable categories, quantities, reasons and warnings", async () => {
  mount(); const dialog = await open(); expect(generatePackingPreview).toHaveBeenCalledWith("a", expect.any(AbortSignal));
  expect(dialog.getByText(/Clothing.*Quantity/)).toBeTruthy(); expect(dialog.getByText(/Quantity 2/)).toBeTruthy(); expect(dialog.getByText("Keep devices charged.")).toBeTruthy();
  expect(dialog.getByText(/Forecast is unavailable/)).toBeTruthy(); expect(dialog.getByText("2 suggestions selected")).toBeTruthy(); expect(applyPackingPreview).not.toHaveBeenCalled();
});
it("supports individual selection, deselection, select all and no-selection disabled state", async () => {
  mount(); const dialog = await open();
  fireEvent.click(dialog.getByRole("checkbox", { name: /Walking shoes/ })); expect(dialog.getByText("1 suggestions selected")).toBeTruthy();
  fireEvent.click(dialog.getByRole("checkbox", { name: "Select all suggestions" })); expect(dialog.getByText("2 suggestions selected")).toBeTruthy();
  fireEvent.click(dialog.getByRole("checkbox", { name: "Select all suggestions" })); expect(dialog.getByText("0 suggestions selected")).toBeTruthy();
  expect((dialog.getByRole("button", { name: "Add 0 selected items" }) as HTMLButtonElement).disabled).toBe(true);
});
it("applies only selected references, preserves packed items and refreshes only the packing query", async () => {
  mount(); const dialog = await open(); const invalidate = vi.spyOn(client, "invalidateQueries");
  fireEvent.click(dialog.getByRole("checkbox", { name: /Phone charger/ })); fireEvent.click(dialog.getByRole("button", { name: "Add 1 selected items" }));
  await screen.findByText("1 items added. 0 duplicates skipped.");
  expect(applyPackingPreview).toHaveBeenCalledWith("a", { token: "signed-preview", selectedIds: [fixture().suggestions[0]!.id] });
  expect(records[0]!.packed).toBe(true); expect(records).toHaveLength(2);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["trips", "a", "equipment"], exact: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("announces loading and prevents duplicate generation", async () => {
  let resolve!: (preview: PackingPreview) => void;
  vi.mocked(generatePackingPreview).mockImplementationOnce(() => new Promise(finish => { resolve = finish; }));
  mount(); const button = screen.getByRole("button", { name: "Generate packing list" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button); fireEvent.click(button);
  expect(await screen.findByText("Generating suggestions from your saved trip...")).toBeTruthy(); expect(generatePackingPreview).toHaveBeenCalledTimes(1);
  resolve(fixture()); await screen.findByText("Walking shoes");
});
it.each(["AI timed out. Try again.", "Guest packing quota reached. Try tomorrow."])("shows actionable failure and retry: %s", async message => {
  vi.mocked(generatePackingPreview).mockRejectedValueOnce(new Error(message)); mount();
  const button = screen.getByRole("button", { name: "Generate packing list" }); await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button);
  await screen.findByText(message); expect(records).toHaveLength(1); fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByText("Walking shoes");
});
it("preserves a failed apply preview and retries without duplicate submissions", async () => {
  vi.mocked(applyPackingPreview).mockRejectedValueOnce(new Error("Could not add items")); mount(); const dialog = await open();
  fireEvent.click(dialog.getByRole("button", { name: "Add 2 selected items" })); await screen.findByText("Could not add items");
  expect(dialog.getByRole("checkbox", { name: /Walking shoes/ })).toBeTruthy();
  let finish!: () => void; vi.mocked(applyPackingPreview).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ added: [], skipped: ["duplicate"], stale: true }); }));
  const add = dialog.getByRole("button", { name: "Add 2 selected items" }); fireEvent.click(add); fireEvent.click(add);
  expect(await screen.findByText("Adding selected suggestions...")).toBeTruthy(); expect((dialog.getByRole("button", { name: "Adding..." }) as HTMLButtonElement).disabled).toBe(true);
  expect(applyPackingPreview).toHaveBeenCalledTimes(2); finish(); await screen.findByText(/0 items added. 1 duplicates skipped/);
});
it("marks exact items added manually while the preview is open", async () => {
  mount(); await open();
  client.setQueryData(["trips", "a", "equipment"], [...records, { id: "new", name: "PHONE charger", category: "electronics", count: 1, packed: false }]);
  await waitFor(() => expect((screen.getByRole("checkbox", { name: /Phone charger/ }) as HTMLInputElement).disabled).toBe(true)); expect(screen.getByText("1 suggestions selected")).toBeTruthy();
});
it("closes without applying and restores focus to Generate", async () => {
  mount(); const dialog = await open(); fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(applyPackingPreview).not.toHaveBeenCalled();
});
it.each(["trip", "identity"])("cancels generation and clears private preview on %s switching", async mode => {
  let finish!: (preview: PackingPreview) => void;
  vi.mocked(generatePackingPreview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = mount(); const button = screen.getByRole("button", { name: "Generate packing list" }); await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button);
  await screen.findByText("Generating suggestions from your saved trip..."); const signal = vi.mocked(generatePackingPreview).mock.calls[0]![1];
  view.switchTo(mode === "trip" ? "b" : "a", mode === "identity" ? "other-owner" : "owner"); expect(signal.aborted).toBe(true);
  finish(fixture()); await waitFor(() => expect(screen.queryByText("Walking shoes")).toBeNull()); expect(screen.queryByRole("dialog")).toBeNull();
});
it("handles empty or fully duplicate previews without enabling apply", async () => {
  vi.mocked(generatePackingPreview).mockResolvedValueOnce({ ...fixture(), suggestions: [] }); mount();
  const button = screen.getByRole("button", { name: "Generate packing list" }); await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button);
  await screen.findByText(/No packing suggestions were returned/); expect((screen.getByRole("button", { name: "Add 0 selected items" }) as HTMLButtonElement).disabled).toBe(true);
});
it("shows accurate new/exact/possible counts and lets users inspect, skip or add a possible duplicate", async () => {
  records = [
    { id: "shoe", name: "Comfortable walking shoes", category: "clothing", count: 2, packed: true },
    { id: "charger", name: "PHONE charger", category: "electronics", count: 3, packed: false },
  ]; mount(); const dialog = await open();
  expect(dialog.getByText("2 suggestions found: 0 new items, 1 already on your list, 1 possible duplicates.")).toBeTruthy();
  expect(dialog.getByText("Similar to an item already on your list.")).toBeTruthy();
  expect((dialog.getByRole("checkbox", { name: /Phone charger/ }) as HTMLInputElement).disabled).toBe(true);
  expect((dialog.getByRole("checkbox", { name: /Walking shoes/ }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(dialog.getByText("View matching Walking shoes items")); expect(dialog.getByText(/Comfortable walking shoes - Clothing, quantity 2, packed/)).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Add Walking shoes anyway" })); expect(dialog.getByText("1 suggestions selected")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Skip Walking shoes" })); expect(dialog.getByText("0 suggestions selected")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Add Walking shoes anyway" })); fireEvent.click(dialog.getByRole("button", { name: "Add 1 selected items" }));
  await waitFor(() => expect(applyPackingPreview).toHaveBeenCalledWith("a", { token: "signed-preview", selectedIds: [fixture().suggestions[0]!.id] }));
});
it("groups suggestions and keeps category selections across collapse/expand", async () => {
  mount(); const dialog = await open(); const clothing = within(dialog.getByRole("region", { name: "Clothing suggestions" }));
  fireEvent.click(clothing.getByRole("checkbox", { name: "Select all Clothing suggestions" }));
  expect(dialog.getByText("1 suggestions selected")).toBeTruthy();
  const toggle = clothing.getByRole("button", { name: "Clothing, 1 suggestions" }); fireEvent.click(toggle); expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle); expect((clothing.getByRole("checkbox", { name: /Walking shoes/ }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(clothing.getByRole("checkbox", { name: "Select all Clothing suggestions" })); expect(dialog.getByText("2 suggestions selected")).toBeTruthy();
});
it("uses refresh after generation and detects meaningful context changes without another AI call", async () => {
  mount(); const dialog = await open(); fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(screen.getByRole("button", { name: "Refresh suggestions" })).toBeTruthy();
  client.setQueryData(["trips", "a", "equipment", "context"], { contextFingerprint: "new-version", generation: { generatedAt: fixture().generatedAt, contextFingerprint: "version", suggestionCount: 2 }, outdated: true });
  await screen.findByText(/Your trip has changed since these suggestions were generated/); expect(generatePackingPreview).toHaveBeenCalledTimes(1);
});
it("requires confirmation before applying a stale preview", async () => {
  mount(); const dialog = await open();
  client.setQueryData(["trips", "a", "equipment", "context"], { contextFingerprint: "new-version", generation: null, outdated: true });
  await screen.findByText(/Your trip has changed since these suggestions were generated/);
  expect((dialog.getByRole("button", { name: "Add 2 selected items" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(dialog.getByRole("checkbox", { name: "Use these outdated suggestions anyway" })); fireEvent.click(dialog.getByRole("button", { name: "Add 2 selected items" }));
  await waitFor(() => expect(applyPackingPreview).toHaveBeenCalledWith("a", expect.objectContaining({ allowStale: true })));
});
it("does not warn about context staleness after harmless packing checkbox changes", async () => {
  mount(); await open(); client.setQueryData(["trips", "a", "equipment"], records.map(item => ({ ...item, packed: !item.packed })));
  await waitFor(() => expect(screen.queryByText(/Your trip has changed/)).toBeNull());
});
it("shows an accessible reason disclosure and gracefully renders a missing reason", async () => {
  const preview = fixture(); preview.suggestions[0]!.reason = ""; vi.mocked(generatePackingPreview).mockResolvedValueOnce(preview);
  mount(); const dialog = await open(); const summary = dialog.getByText("Why Walking shoes?"); fireEvent.click(summary);
  expect(summary.closest("details")?.open).toBe(true); expect(dialog.getByText(/No explanation was provided/)).toBeTruthy();
});
