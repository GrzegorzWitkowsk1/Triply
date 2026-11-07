import { QueryClient } from "@tanstack/react-query";
import type { TripDetail } from "@triply/shared";
import { expect, it, vi } from "vitest";
import { cacheConfirmedTrip } from "./confirmedTrip";
it("merges independent visit and itinerary revisions when responses arrive out of order", async () => {
  const client = new QueryClient();
  const current = { id: "t", itineraryVersion: 4, visitRevision: 7, visits: [{ itineraryItemId: "one", status: "visited" }] } as TripDetail;
  client.setQueryData(["trips", "t"], current);
  await cacheConfirmedTrip(client, { ...current, itineraryVersion: 5, visitRevision: 6, visits: [] });
  const saved = client.getQueryData<TripDetail>(["trips", "t"])!;
  expect(saved.itineraryVersion).toBe(5);
  expect(saved.visitRevision).toBe(7);
  expect(saved.visits).toEqual(current.visits);
  await cacheConfirmedTrip(client, { ...current, itineraryVersion: 3, visitRevision: 8, visits: [] });
  expect(client.getQueryData<TripDetail>(["trips", "t"])!.itineraryVersion).toBe(5);
  expect(client.getQueryData<TripDetail>(["trips", "t"])!.visits).toEqual([]);
  client.clear();
});
it("keeps newer confirmed state when an older mutation response arrives late", async () => {
  const client = new QueryClient();
  const newer = { id: "t", itineraryVersion: 7, itinerary: { days: ["newer schedule"] }, quality: { valid: true } } as unknown as TripDetail;
  client.setQueryData(["trips", "t"], newer);
  await cacheConfirmedTrip(client, { id: "t", itineraryVersion: 6 } as TripDetail);
  expect(client.getQueryData(["trips", "t"])).toEqual(newer);
  client.clear();
});

it("keeps newer Budget and resolved posting state when an older visit response arrives", async () => {
  const client = new QueryClient();
  const current = { id: "t", itineraryVersion: 4, visitRevision: 7, visits: [], budgetData: { revision: 5, expenses: [{ id: "posted" }] }, pendingVisitExpenseItemIds: [] } as unknown as TripDetail;
  client.setQueryData(["trips", "t"], current);
  await cacheConfirmedTrip(client, { ...current, budgetData: { ...current.budgetData!, revision: 4, expenses: [] }, pendingVisitExpenseItemIds: ["pending"] });
  expect(client.getQueryData<TripDetail>(["trips", "t"])!.budgetData).toEqual(current.budgetData);
  expect(client.getQueryData<TripDetail>(["trips", "t"])!.pendingVisitExpenseItemIds).toEqual([]);
  client.clear();
});
it("does not restore trip data if identity changes while cancelling an older fetch", async () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "a" } });
  let release!: () => void;
  vi.spyOn(client, "cancelQueries").mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = cacheConfirmedTrip(client, { id: "t", itineraryVersion: 8 } as TripDetail);
  client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "b" } });
  release(); expect(await pending).toBe(false);
  expect(client.getQueryData(["trips", "t"])).toBeUndefined();
  client.clear();
});
