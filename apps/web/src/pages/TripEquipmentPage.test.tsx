import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";
import type { TripEquipmentItem } from "@triply/shared";
import { bulkPacking, getPackingContext } from "../api/packing";
vi.mock("../api/packing", () => ({ getPackingContext: vi.fn(async () => ({ contextFingerprint: "version", generation: null, outdated: false })), bulkPacking: vi.fn(), generatePackingPreview: vi.fn(), applyPackingPreview: vi.fn() }));
import TripEquipmentPage from "./TripEquipmentPage";
import { getEquipment, createEquipmentItem, updateEquipmentItem, deleteEquipmentItem } from "../api/equipment";
vi.mock("../api/equipment", () => ({ getEquipment: vi.fn(), createEquipmentItem: vi.fn(), updateEquipmentItem: vi.fn(), deleteEquipmentItem: vi.fn() }));
vi.mock("../hooks/useTrips", async original => ({ ...await original<typeof import("../hooks/useTrips")>(), useTrip: () => ({ data: { analysis: { destination: "Paris", country: "France", durationDays: 3 } } }) }));
let records: TripEquipmentItem[];
let client: QueryClient;
const jacket = (): TripEquipmentItem => ({ id: "jacket", name: "Rain jacket", category: "clothing", count: 3, packed: false });
const passport = (): TripEquipmentItem => ({ id: "passport", name: "Passport", category: "documents", count: 1, packed: true });
beforeEach(() => {
  vi.mocked(getPackingContext).mockResolvedValue({ contextFingerprint: "version", generation: null, outdated: false });
  records = [jacket(), passport()];
  vi.mocked(bulkPacking).mockImplementation(async (_trip, input) => { records = records.map(item => input.itemIds.includes(item.id) ? { ...item, packed: input.packed } : item); return { equipment: records, updatedCount: input.itemIds.length }; });
  vi.mocked(getEquipment).mockImplementation(async () => ({ equipment: records.map(item => ({ ...item })) }));
  vi.mocked(createEquipmentItem).mockImplementation(async (_id, input) => { const item = { ...input, category: input.category ?? "other", id: String(records.length), packed: false }; records.push(item); return item; });
  vi.mocked(updateEquipmentItem).mockImplementation(async (_trip, id, input) => { records = records.map(item => item.id === id ? { ...item, ...input } : item); return records.find(item => item.id === id)!; });
  vi.mocked(deleteEquipmentItem).mockImplementation(async (_trip, id) => { records = records.filter(item => item.id !== id); });
});
afterEach(() => { cleanup(); client?.clear(); vi.resetAllMocks(); });
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/trips/a/equipment"]}><Link to="/trips/b/equipment">Switch trip</Link><Routes><Route path="/trips/:id/equipment" element={<TripEquipmentPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
async function ready() { mount(); await screen.findByRole("progressbar"); }
const addForm = () => within(screen.getByRole("form", { name: "Add packing item" }));
const progress = () => screen.getByRole("progressbar", { hidden: true }).getAttribute("aria-valuenow");
it.each([[0, 0], [1, 50], [2, 100]])("calculates progress by items for %s packed", async (packed, percentage) => {
  records = [jacket(), passport()].map((item, index) => ({ ...item, packed: index < packed }));
  await ready(); expect(progress()).toBe(String(percentage)); expect(screen.getByText(`${packed} of 2 items packed`)).toBeTruthy();
});
it("shows an empty list at zero progress and an enabled review-first AI action", async () => {
  records = []; await ready(); expect(progress()).toBe("0"); expect(screen.getByText("Your packing list is empty")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Generate packing list" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText(/Review AI suggestions/)).toBeTruthy();
});
it("groups categories, retains full counts with filters and preserves collapsed state after mutations", async () => {
  await ready();
  const clothing = screen.getByRole("region", { name: "Clothing" });
  expect(within(clothing).getByText("0/1")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Documents" })).getByText("1/1")).toBeTruthy();
  const toggle = within(clothing).getByRole("button", { name: /Clothing/ });
  fireEvent.click(toggle); expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("checkbox", { name: "Passport" }));
  await waitFor(() => expect(progress()).toBe("0"));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle); expect(toggle.getAttribute("aria-expanded")).toBe("true");
});
it("filters All, To pack and Packed and reports filtered empty results", async () => {
  await ready(); fireEvent.click(screen.getByRole("button", { name: "To pack" }));
  expect(screen.queryByRole("checkbox", { name: "Passport" })).toBeNull(); expect(screen.getByRole("checkbox", { name: "Rain jacket" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Packed" }));
  expect(screen.queryByRole("checkbox", { name: "Rain jacket" })).toBeNull(); expect(screen.getByRole("checkbox", { name: "Passport" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All" })); expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  fireEvent.click(screen.getByRole("checkbox", { name: "Rain jacket" }));
  await waitFor(() => expect(progress()).toBe("100"));
  fireEvent.click(screen.getByRole("button", { name: "To pack" })); expect(screen.getByText("Everything is packed!")).toBeTruthy();
});
it("adds trimmed names with selected category and quantity and resets only after success", async () => {
  await ready(); const form = addForm();
  fireEvent.change(form.getByLabelText("Item name"), { target: { value: "  Socks  " } });
  fireEvent.change(form.getByLabelText("Category"), { target: { value: "clothing" } });
  fireEvent.change(form.getByLabelText("Quantity"), { target: { value: "2" } });
  fireEvent.submit(screen.getByRole("form", { name: "Add packing item" }));
  await screen.findByRole("checkbox", { name: "Socks" });
  expect(createEquipmentItem).toHaveBeenCalledWith("a", { name: "Socks", category: "clothing", count: 2 });
  expect((form.getByLabelText("Item name") as HTMLInputElement).value).toBe("");
});
it.each(["", "0", "-1", "1.5", "1000"])("rejects invalid quantity %s", async value => {
  await ready(); const form = addForm(); fireEvent.change(form.getByLabelText("Item name"), { target: { value: "Socks" } });
  fireEvent.change(form.getByLabelText("Quantity"), { target: { value } }); fireEvent.click(form.getByRole("button", { name: "Add item" }));
  expect(await screen.findByRole("alert")).toBeTruthy(); expect(createEquipmentItem).not.toHaveBeenCalled();
});
it("validates whitespace names and preserves failed add input", async () => {
  await ready(); const form = addForm(); fireEvent.change(form.getByLabelText("Item name"), { target: { value: "   " } }); fireEvent.click(form.getByRole("button", { name: "Add item" }));
  expect(await screen.findByRole("alert")).toBeTruthy(); expect(createEquipmentItem).not.toHaveBeenCalled();
  vi.mocked(createEquipmentItem).mockRejectedValueOnce(new Error("Save failed"));
  fireEvent.change(form.getByLabelText("Item name"), { target: { value: "Socks" } }); fireEvent.click(form.getByRole("button", { name: "Add item" }));
  await screen.findByText("Save failed"); expect((form.getByLabelText("Item name") as HTMLInputElement).value).toBe("Socks");
});
it("edits all fields, cancels without saving, and preserves failed edit input", async () => {
  await ready(); fireEvent.click(screen.getByRole("button", { name: "Edit Rain jacket" }));
  let form = within(screen.getByRole("form", { name: "Edit Rain jacket" }));
  expect((form.getByLabelText("Quantity") as HTMLInputElement).value).toBe("3");
  fireEvent.change(form.getByLabelText("Item name"), { target: { value: "Discard" } }); fireEvent.click(form.getByRole("button", { name: "Cancel" })); expect(updateEquipmentItem).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Edit Rain jacket" })); form = within(screen.getByRole("form", { name: "Edit Rain jacket" }));
  vi.mocked(updateEquipmentItem).mockRejectedValueOnce(new Error("Edit failed"));
  fireEvent.change(form.getByLabelText("Quantity"), { target: { value: "5" } }); fireEvent.click(form.getByRole("button", { name: "Save changes" }));
  await screen.findAllByText("Edit failed"); expect((form.getByLabelText("Quantity") as HTMLInputElement).value).toBe("5");
  fireEvent.change(form.getByLabelText("Item name"), { target: { value: "Jacket" } }); fireEvent.change(form.getByLabelText("Category"), { target: { value: "other" } });
  fireEvent.click(form.getByRole("button", { name: "Save changes" })); await screen.findByRole("checkbox", { name: "Jacket" });
  expect(records.find(item => item.id === "jacket")).toMatchObject({ name: "Jacket", category: "other", count: 5 });
});
it("updates progress after deletion and rolls back failed deletion and toggles", async () => {
  await ready(); vi.mocked(deleteEquipmentItem).mockRejectedValueOnce(new Error("Delete failed"));
  fireEvent.click(screen.getByRole("button", { name: "Delete Passport" })); await screen.findByText("Delete failed"); await screen.findByRole("checkbox", { name: "Passport" }); expect(progress()).toBe("50");
  fireEvent.click(screen.getByRole("button", { name: "Delete Passport" })); await waitFor(() => expect(progress()).toBe("0"));
  await waitFor(() => expect((screen.getByRole("checkbox", { name: "Rain jacket" }) as HTMLInputElement).disabled).toBe(false));
  vi.mocked(updateEquipmentItem).mockRejectedValueOnce(new Error("Toggle failed")); fireEvent.click(screen.getByRole("checkbox", { name: "Rain jacket" }));
  await screen.findByText("Toggle failed"); await waitFor(() => expect(progress()).toBe("0"));
});
it("shows loading without an empty flash, then API error and retry", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(getEquipment).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  mount(); expect(screen.getByText("Loading packing checklist...")).toBeTruthy(); expect(screen.queryByText("Your packing list is empty")).toBeNull();
  reject(new Error("Load failed")); await screen.findByText("Load failed"); fireEvent.click(screen.getByRole("button", { name: "Retry packing list" })); await screen.findByRole("progressbar");
});
it("resets form and filters for a different trip and fetches its list", async () => {
  await ready(); fireEvent.change(addForm().getByLabelText("Item name"), { target: { value: "Private draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Packed" })); records = [];
  fireEvent.click(screen.getByRole("link", { name: "Switch trip" })); await screen.findByText("Your packing list is empty");
  expect(getEquipment).toHaveBeenCalledWith("b"); expect((addForm().getByLabelText("Item name") as HTMLInputElement).value).toBe("");
});

it("keeps category totals from the complete list while filtering", async () => {
  records = [jacket(), { ...passport(), category: "clothing" }]; await ready();
  fireEvent.click(screen.getByRole("button", { name: "To pack" }));
  expect(within(screen.getByRole("region", { name: "Clothing" })).getByText("1/2")).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
});
it("prevents duplicate adds and announces pending saves", async () => {
  let finish!: (item: TripEquipmentItem) => void;
  vi.mocked(createEquipmentItem).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await ready(); const form = addForm();
  fireEvent.change(form.getByLabelText("Item name"), { target: { value: "Socks" } });
  const element = screen.getByRole("form", { name: "Add packing item" });
  fireEvent.submit(element); fireEvent.submit(element);
  await waitFor(() => expect(createEquipmentItem).toHaveBeenCalledTimes(1));
  expect((form.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Saving packing checklist...")).toBeTruthy();
  finish({ id: "socks", name: "Socks", count: 1, category: "other", packed: false });
  await waitFor(() => expect((form.getByLabelText("Item name") as HTMLInputElement).value).toBe(""));
});
it("confirms filter-aware bulk actions and updates packing progress", async () => {
  await ready(); fireEvent.click(screen.getByRole("button", { name: "To pack" }));
  fireEvent.click(screen.getByRole("button", { name: "Pack visible unpacked items" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm packing change" }));
  await waitFor(() => expect(progress()).toBe("100")); expect(bulkPacking).toHaveBeenCalledWith("a", { itemIds: ["jacket"], packed: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Packed" })); fireEvent.click(screen.getByRole("button", { name: "Unpack visible packed items" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm packing change" })); await waitFor(() => expect(progress()).toBe("0"));
});
it("excludes collapsed category items from bulk scope and cancels without mutation", async () => {
  records = [jacket(), { ...passport(), packed: false }]; await ready();
  fireEvent.click(within(screen.getByRole("region", { name: "Clothing" })).getByRole("button", { name: /Clothing/ }));
  fireEvent.click(screen.getByRole("button", { name: "Pack visible unpacked items" }));
  expect(screen.getByRole("dialog").textContent).toMatch(/Pack\s*1\s*visible items/);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })); expect(bulkPacking).not.toHaveBeenCalled();
});
it("rolls back failed bulk actions and retains the confirmation for retry", async () => {
  await ready(); vi.mocked(bulkPacking).mockRejectedValueOnce(new Error("Bulk failed"));
  fireEvent.click(screen.getByRole("button", { name: "Pack visible unpacked items" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm packing change" }));
  await screen.findAllByText("Bulk failed"); await waitFor(() => expect(progress()).toBe("50")); expect(screen.getByRole("dialog")).toBeTruthy();
});
it("shows verified AI provenance and reasons without giving manual items fake badges", async () => {
  records = [{ ...jacket(), source: "ai", reason: "A general layer for travel." }, passport()]; await ready();
  expect(screen.getAllByText("AI suggested")).toHaveLength(1); fireEvent.click(screen.getByText("Why Rain jacket?"));
  expect(screen.getByText("A general layer for travel.")).toBeTruthy(); expect(screen.queryByText("Why Passport?")).toBeNull();
});
it("sorts unpacked items first and keeps stable ordering within each state", async () => {
  records = [{ ...jacket(), id: "packed", name: "Packed shirt", packed: true }, { ...jacket(), id: "one", name: "First" }, { ...jacket(), id: "two", name: "Second" }]; await ready();
  const region = within(screen.getByRole("region", { name: "Clothing" })); expect(region.getAllByRole("checkbox").map(item => item.parentElement?.textContent)).toEqual(["First", "Second", "Packed shirt"]);
});
it("holds item order while editing and disables bulk actions until editing ends", async () => {
  records = [{ ...jacket(), id: "first", name: "First" }, { ...jacket(), id: "second", name: "Second" }]; await ready();
  fireEvent.click(screen.getByRole("button", { name: "Edit First" }));
  expect((screen.getByRole("button", { name: "Pack visible unpacked items" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "First" }));
  await waitFor(() => expect(progress()).toBe("50"));
  expect(within(screen.getByRole("region", { name: "Clothing" })).getAllByRole("checkbox").map(item => item.parentElement?.textContent)).toEqual(["First", "Second"]);
  fireEvent.click(within(screen.getByRole("form", { name: "Edit First" })).getByRole("button", { name: "Cancel" }));
  expect(within(screen.getByRole("region", { name: "Clothing" })).getAllByRole("checkbox").map(item => item.parentElement?.textContent)).toEqual(["Second", "First"]);
});
