import { afterEach, expect, it, vi } from "vitest";
import { getTrip, generateTrip, updateTripVisit, editTripItinerary } from "./trips";
import { request } from "./client";
import { budgetResponseSchema } from "./responses";
import { ITEM_ID, recoveryBudget, recoveryTrip } from "../query/recoveryFixtures";

afterEach(() => vi.unstubAllGlobals());
it("accepts valid legacy details, generation and visits without inventing optional revisions", async () => {
  const trip = recoveryTrip(); delete trip.itineraryVersion; delete trip.visitRevision;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(trip)));
  expect(await getTrip("trip")).toEqual(trip);
  expect(await generateTrip("trip")).toEqual(trip);
  expect(await updateTripVisit("trip", ITEM_ID, "visited")).toEqual(trip);
});
it.each([null, {}, { ...recoveryTrip(), itinerary: { days: [] } },
  { ...recoveryTrip(), visits: [{ itineraryItemId: ITEM_ID, status: "visited" }] },
  { ...recoveryTrip(), budgetData: { revision: 1, expenses: [], summary: {} } },
])("rejects malformed trip state with a controlled code (%#)", async payload => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
  await expect(getTrip("trip")).rejects.toMatchObject({ status: 502, code: "invalid-response" });
});
it("validates nested budget totals, expenses and mutation envelopes", async () => {
  const budget = recoveryBudget(2, 2500);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(budget)));
  expect(await request("/budget", {}, budgetResponseSchema)).toEqual(budget);
  budget.summary.totals[0].actualMinor = -1;
  await expect(request("/budget", { method: "PATCH" }, budgetResponseSchema)).rejects.toMatchObject({ code: "invalid-response" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ trip: recoveryTrip(), itineraryVersion: "wrong" })));
  await expect(editTripItinerary("trip", { expectedVersion: 1, operation: { type: "reroute", dayIndex: 1 } })).rejects.toMatchObject({ code: "invalid-response" });
});
it("rejects invalid JSON without leaking the response in error details", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("sensitive invalid JSON")));
  await expect(getTrip("trip")).rejects.toMatchObject({ details: { code: "invalid-response" } });
});
it("rejects a well-formed response belonging to another trip", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...recoveryTrip(), id: "another-trip" })));
  await expect(getTrip("trip")).rejects.toMatchObject({ code: "invalid-response" });
});
it("passes an abort signal and snapshot mode while preserving coded HTTP errors", async () => {
  const fetch = vi.fn(async () => Response.json({ error: "Changed", code: "ITINERARY_VERSION_CONFLICT" }, { status: 409 }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await expect(getTrip("trip", { snapshot: true, signal: controller.signal })).rejects.toMatchObject({ status: 409, code: "ITINERARY_VERSION_CONFLICT" });
  expect(fetch).toHaveBeenCalledWith("/api/trips/trip?snapshot=true", expect.objectContaining({ signal: controller.signal }));
});
