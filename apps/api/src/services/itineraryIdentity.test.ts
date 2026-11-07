import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ItineraryDay } from "@triply/shared";
import { carryStopIdentities, ensureItemIdentities, retainRegeneratedIdentities } from "./itineraryIdentity.js";

const day = (ids: (string | undefined)[]): ItineraryDay => ({
  activities: ids.map(placeId => ({ type: "attraction", placeId, title: "Identical name", startTime: "", endTime: "", durationMinutes: 30 })),
  stops: ids.filter(Boolean).map(placeId => ({ placeId })),
}) as ItineraryDay;

it("allocates unique identities for repeated attractions and legacy visits without provider IDs", () => {
  const days = [day(["same", "same", undefined]), day(["same"])];
  expect(ensureItemIdentities(days)).toBe(true);
  const ids = days.flatMap(day => day.activities.map(item => item.itineraryItemId));
  expect(new Set(ids).size).toBe(4);
  expect(ids.every(id => /^[a-f\d-]{36}$/.test(id!))).toBe(true);
  expect(ensureItemIdentities(days)).toBe(false);
  expect(days.flatMap(day => day.activities.map(item => item.itineraryItemId))).toEqual(ids);
});
it("retains only exact unambiguous provider visits and never matches by title", () => {
  const original = day(["retained", "removed", undefined, "duplicate", "duplicate"]);
  const proposed = day(["retained", "replacement", undefined, "duplicate"]);
  ensureItemIdentities([original]); ensureItemIdentities([proposed]);
  retainRegeneratedIdentities(original, proposed);
  expect(proposed.activities[0].itineraryItemId).toBe(original.activities[0].itineraryItemId);
  const old = new Set(original.activities.map(item => item.itineraryItemId));
  expect(proposed.activities.slice(1).some(item => old.has(item.itineraryItemId))).toBe(false);
});
it("carries explicit editing stop identity after a scheduling time change", () => {
  const original = day(["one"]); ensureItemIdentities([original]);
  const proposed = day(["one"]);
  proposed.activities[0].startTime = "2026-11-05T10:00:00Z";
  carryStopIdentities(proposed, original.stops);
  expect(proposed.activities[0].itineraryItemId).toBe(original.activities[0].itineraryItemId);
});
it("repairs duplicate occurrence IDs within the trip", () => {
  const days = [day(["a"]), day(["b"])];
  const id = randomUUID(); days.forEach(day => { day.activities[0].itineraryItemId = id; });
  ensureItemIdentities(days);
  expect(days[0].activities[0].itineraryItemId).toBe(id);
  expect(days[1].activities[0].itineraryItemId).not.toBe(id);
});
