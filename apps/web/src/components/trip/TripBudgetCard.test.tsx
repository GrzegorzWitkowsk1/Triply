import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expenseInputSchema, EXPENSE_CATEGORIES, type ItineraryDay, type TripBudgetData, type TripExpense } from "@triply/shared";
import { request } from "../../api/client";
import TripBudgetCard from "./TripBudgetCard";

vi.mock("../../api/client", () => ({ request: vi.fn() }));
const lunch: TripExpense = {
  ...expenseInputSchema.parse({ title: "Lunch", amountMinor: 2500, currency: "EUR", category: "food_drinks", type: "planned", dayId: "1" }),
  id: "00000000-0000-4000-8000-000000000001", createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z",
};
function fixture(): TripBudgetData {
  const totals = [{ currency: "EUR", plannedMinor: 2500, actualMinor: 1000, automaticMinor: 0, manualPlannedMinor: 2500 }];
  const categories = EXPENSE_CATEGORIES.map(category => ({ category, totals: category === "food_drinks" ? totals : [] }));
  return { revision: 0, expenses: [lunch], summary: {
    currency: "EUR", totalBudgetMinor: 10000, allocations: {}, allocationCurrency: "EUR", totals, categories,
    days: [{ dayId: "1", totals, categories }],
    plannedSpendingMinor: 2500, actualSpendingMinor: 1000, plannedRemainingMinor: 7500, actualRemainingMinor: 9000,
    unknownAdmissionPriceCount: 0, hasIncompletePricing: false, comparisonAvailable: true,
    plannedOverBudget: false, actualOverBudget: false, warnings: [],
  } };
}
const days = [1, 2, 3].map(dayIndex => ({ dayIndex, date: `2026-10-${10 + dayIndex}` })) as ItineraryDay[];
function mount(activeDayIndex = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const card = (activeDay: number) => <QueryClientProvider client={client}><TripBudgetCard whole={100} tripId="trip-1" days={days} activeDayIndex={activeDay} /></QueryClientProvider>;
  const view = render(card(activeDayIndex));
  return { ...view, changeActiveDay: (activeDay: number) => view.rerender(card(activeDay)) };
}
function fill(title = "Taxi", amount = "12.29") {
  fireEvent.change(screen.getByLabelText("Expense name"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: amount } });
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(request).mockResolvedValue(fixture()); });
afterEach(cleanup);

describe("Trip budget & expenses", () => {
  it("renders combined planned/actual spending, category colors and a single inline form", async () => {
    const view = mount(); await screen.findByText("Lunch");
    expect(screen.getByRole("heading", { name: "Trip budget & expenses" })).toBeTruthy();
    expect(screen.getByLabelText("Total expenses and budget").textContent).toBe("€35.00 / €100.00");
    expect(view.container.querySelectorAll(".budget-card")).toHaveLength(1);
    expect(view.container.querySelectorAll("form")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Edit allocations" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toBe("Attractions");
    expect(screen.getByRole("combobox", { name: "Trip day" }).textContent).toBe("Day 2");
    expect(screen.getByPlaceholderText("Amount (EUR)")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Expenses" });
    expect(within(list).getByText("Food & Drinks")).toBeTruthy();
    expect(list.querySelector(".budget-dot")).toBeTruthy();
  });
  it("shows a tooltip above a category segment with its amount", async () => {
    mount(); await screen.findByText("Lunch");
    fireEvent.mouseOver(screen.getByLabelText("Food & Drinks: €35.00"));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Food & Drinks · €35.00");
  });
  it("disables adding until both title and amount are entered", async () => {
    mount(); await screen.findByText("Lunch");
    expect((screen.getByRole("button", { name: "Add expense" }) as HTMLButtonElement).disabled).toBe(true);
    fill("Taxi", "");
    expect((screen.getByRole("button", { name: "Add expense" }) as HTMLButtonElement).disabled).toBe(true);
    fill(" ", "12");
    expect((screen.getByRole("button", { name: "Add expense" }) as HTMLButtonElement).disabled).toBe(true);
    fill();
    expect((screen.getByRole("button", { name: "Add expense" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("adds through the API, resets all fields and puts the new record first", async () => {
    mount(); await screen.findByText("Lunch"); fill();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Trip day" }));
    const dayOptions = await screen.findByRole("listbox");
    expect(within(dayOptions).getAllByRole("option").map(option => option.textContent)).toEqual(["Day 1", "Day 2", "Day 3"]);
    fireEvent.click(within(dayOptions).getByText("Day 3"));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByText("Transport"));
    const updated = fixture();
    updated.revision = 1;
    updated.expenses.push({ ...lunch, title: "Taxi", category: "transport", type: "actual", amountMinor: 1229,
      id: "00000000-0000-4000-8000-000000000002", createdAt: "2026-10-12T00:00:00Z" });
    vi.mocked(request).mockResolvedValue(updated);
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    await screen.findByText("Taxi");
    const call = vi.mocked(request).mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(call[0]).toBe("/api/trips/trip-1/expenses");
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ expense: { title: "Taxi", category: "transport", amountMinor: 1229, currency: "EUR", type: "actual", dayId: "3" }, expectedRevision: 0 });
    expect(within(screen.getByRole("list", { name: "Expenses" })).getAllByRole("listitem")[0].textContent).toContain("Taxi");
    expect((screen.getByLabelText("Expense name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toBe("Attractions");
    expect(screen.getByRole("combobox", { name: "Trip day" }).textContent).toBe("Day 2");
  });
  it("follows the active day when navigating without clearing other form inputs", async () => {
    const view = mount(); await screen.findByText("Lunch"); fill();
    view.changeActiveDay(1);
    expect(screen.getByRole("combobox", { name: "Trip day" }).textContent).toBe("Day 1");
    expect((screen.getByLabelText("Expense name") as HTMLInputElement).value).toBe("Taxi");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("12.29");
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    await waitFor(() => expect(vi.mocked(request).mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    const call = vi.mocked(request).mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(JSON.parse(String(call[1]?.body)).expense.dayId).toBe("1");
  });
  it("waits for persistence before adding or clearing and prevents duplicate submissions", async () => {
    mount(); await screen.findByText("Lunch"); fill();
    vi.mocked(request).mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    fireEvent.submit(screen.getByLabelText("Expense name").closest("form")!);
    await waitFor(() => expect(vi.mocked(request).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1));
    expect(screen.queryByText("Taxi")).toBeNull();
    expect((screen.getByLabelText("Expense name") as HTMLInputElement).value).toBe("Taxi");
    expect((screen.getByRole("button", { name: "Adding expense…" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("deletes through the backend using the trash icon and refreshes the list", async () => {
    mount(); await screen.findByText("Lunch");
    const updated = fixture(); updated.expenses = []; vi.mocked(request).mockResolvedValue(updated);
    fireEvent.click(screen.getByRole("button", { name: "Delete Lunch" }));
    await screen.findByText("No expenses yet.");
    const call = vi.mocked(request).mock.calls.find(([, options]) => options?.method === "DELETE")!;
    expect(call[0]).toBe(`/api/trips/trip-1/expenses/${lunch.id}`);
    expect(JSON.parse(String(call[1]?.body))).toEqual({ expectedRevision: 0 });
  });
  it("retains draft inputs after validation or API errors", async () => {
    mount(); await screen.findByText("Lunch"); fill("Taxi", "1.111");
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(screen.getByRole("alert").textContent).toContain("precision");
    expect(vi.mocked(request).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
    fill(); vi.mocked(request).mockRejectedValue(new Error("Could not save"));
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    await screen.findByText("Could not save");
    expect((screen.getByLabelText("Expense name") as HTMLInputElement).value).toBe("Taxi");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("12.29");
  });
  it("keeps Per day spending collapsed until clicked, then shows day/category totals", async () => {
    const view = mount(); await screen.findByText("Lunch");
    const toggle = screen.getByRole("button", { name: "Per day spending" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Day 1")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Day 1")).toBeTruthy();
    expect(view.container.querySelector(".budget-day-category")?.textContent).toBe("Food & Drinks€35.00");
    fireEvent.click(toggle); expect(screen.queryByText("Day 1")).toBeNull();
  });
  it("shows loading/errors and supports retry", async () => {
    vi.mocked(request).mockImplementationOnce(() => new Promise(() => {})); const view = mount();
    expect(screen.getByRole("status").textContent).toContain("Loading expenses"); view.unmount();
    vi.mocked(request).mockRejectedValueOnce(new Error("Offline")); mount();
    await screen.findByText("Could not load expenses.");
    fireEvent.click(screen.getByRole("button", { name: "Retry expenses" })); await screen.findByText("Lunch");
  });
  it("uses the trip currency precision and does not combine mixed currencies", async () => {
    const data = fixture(); data.summary.currency = "JPY"; data.summary.totalBudgetMinor = 10000;
    data.summary.totals = [{ currency: "JPY", plannedMinor: 100, actualMinor: 200, automaticMinor: 0, manualPlannedMinor: 100 }, ...data.summary.totals];
    vi.mocked(request).mockResolvedValue(data); mount(); await screen.findByText("Lunch");
    expect(screen.getByPlaceholderText("Amount (JPY)")).toBeTruthy();
    expect(screen.getByLabelText("Total expenses and budget").textContent).toContain("¥300 · €35.00");
    expect(screen.getByText("Expenses in different currencies are shown separately.")).toBeTruthy();
    fill("Taxi", "1.1"); fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(screen.getByRole("alert").textContent).toContain("precision");
  });
});
