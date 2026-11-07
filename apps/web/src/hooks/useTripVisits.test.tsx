import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { VisitMutationResponse, TripBudgetData } from "@triply/shared";
import { updateTripVisit } from "../api/trips";
import { useTripVisits } from "./useTripVisits";
vi.mock("../api/trips", () => ({ updateTripVisit: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const result = { id: "trip", visitRevision: 1, itineraryVersion: 1, expensePromptItemId: "item", visits: [{ itineraryItemId: "item", status: "visited", visitedAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z" }] } as VisitMutationResponse;
const budget = (revision: number): TripBudgetData => ({ revision, expenses: [], summary: {
  currency: null, totalBudgetMinor: null, allocations: {}, allocationCurrency: null, totals: [], categories: [], days: [],
  plannedSpendingMinor: null, actualSpendingMinor: null, plannedRemainingMinor: null, actualRemainingMinor: null,
  unknownAdmissionPriceCount: 0, hasIncompletePricing: false, comparisonAvailable: false, plannedOverBudget: false, actualOverBudget: false, warnings: [],
} });

it("never prompts for an older response and never caches the ephemeral prompt signal", async () => {
  const client = new QueryClient(); const prompt = vi.fn(); let release!: (value: VisitMutationResponse) => void;
  vi.mocked(updateTripVisit).mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useTripVisits("trip", prompt), { wrapper });
  act(() => { void hook.result.current.change("item", "visited"); });
  await waitFor(() => expect(release).toBeTypeOf("function"));
  client.setQueryData(["trips", "trip"], { ...result, expensePromptItemId: undefined, visitRevision: 2, visits: [] });
  act(() => release(result)); await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(prompt).not.toHaveBeenCalled();
  expect(client.getQueryData<VisitMutationResponse>(["trips", "trip"])!.visitRevision).toBe(2);
  expect(client.getQueryData<VisitMutationResponse>(["trips", "trip"])!.expensePromptItemId).toBeUndefined(); client.clear();
});

it("suppresses a late response after navigating to a different trip", async () => {
  const client = new QueryClient(); const prompt = vi.fn(); let release!: (value: VisitMutationResponse) => void;
  vi.mocked(updateTripVisit).mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ id }) => useTripVisits(id, prompt), { wrapper, initialProps: { id: "trip" } });
  act(() => { void hook.result.current.change("item", "visited"); }); await waitFor(() => expect(release).toBeTypeOf("function"));
  hook.rerender({ id: "other" }); act(() => release(result)); await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(prompt).not.toHaveBeenCalled(); client.clear();
});

it("does not repeat the prompt for an already visited cached item", async () => {
  const client = new QueryClient(); const prompt = vi.fn();
  client.setQueryData(["trips", "trip"], { ...result, expensePromptItemId: undefined });
  vi.mocked(updateTripVisit).mockResolvedValue(result);
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useTripVisits("trip", prompt), { wrapper });
  await act(async () => { await hook.result.current.change("item", "visited"); });
  expect(prompt).not.toHaveBeenCalled(); client.clear();
});

it("does not restore Budget data after identity changes during cache cancellation", async () => {
  const client = new QueryClient(); let release!: () => void;
  client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "a" } });
  vi.mocked(updateTripVisit).mockResolvedValue({ ...result, budgetData: budget(1) });
  vi.spyOn(client, "cancelQueries").mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useTripVisits("trip"), { wrapper });
  act(() => { void hook.result.current.change("item", "visited"); });
  await waitFor(() => expect(release).toBeTypeOf("function"));
  client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "b" } });
  act(() => release()); await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(client.getQueryData(["trips", "trip", "budget"])).toBeUndefined();
  expect(hook.result.current.expenseFeedback).toBeNull(); client.clear();
});

it("suppresses stale expense confirmations and never caches their transient signal", async () => {
  const client = new QueryClient();
  client.setQueryData(["trips", "trip", "budget"], budget(3));
  vi.mocked(updateTripVisit).mockResolvedValue({ ...result, expensePromptItemId: undefined,
    automaticExpense: { itemId: "item", status: "posted", amountMinor: 6000, currency: "EUR" }, budgetData: budget(2) });
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useTripVisits("trip"), { wrapper });
  await act(async () => { await hook.result.current.change("item", "visited"); });
  expect(hook.result.current.expenseFeedback).toBeNull();
  expect(client.getQueryData<{ revision: number }>(["trips", "trip", "budget"])!.revision).toBe(3);
  expect(client.getQueryData<VisitMutationResponse>(["trips", "trip"])!.automaticExpense).toBeUndefined(); client.clear();
});
