import { QueryClient } from "@tanstack/react-query";
import type { TripDetail } from "@triply/shared";
import { expect, it, vi } from "vitest";
import { cacheConfirmedTrip } from "./confirmedTrip";
it("keeps newer confirmed state when an older mutation response arrives late", async () => {
  const client = new QueryClient();
  const newer = { id: "t", itineraryVersion: 7, itinerary: { days: ["newer schedule"] }, quality: { valid: true } } as unknown as TripDetail;
  client.setQueryData(["trips", "t"], newer);
  await cacheConfirmedTrip(client, { id: "t", itineraryVersion: 6 } as TripDetail);
  expect(client.getQueryData(["trips", "t"])).toEqual(newer);
  client.clear();
});
it("does not restore trip data if identity changes while cancelling an older fetch", async () => {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "a" } });
  let release!: () => void;
  vi.spyOn(client, "cancelQueries").mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = cacheConfirmedTrip(client, { id: "t", itineraryVersion: 8 } as TripDetail);
  client.setQueryData(["auth", "session"], { status: "authenticated", user: { id: "b" } });
  release(); await pending;
  expect(client.getQueryData(["trips", "t"])).toBeUndefined();
  client.clear();
});
