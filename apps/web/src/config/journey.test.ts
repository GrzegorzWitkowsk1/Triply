import { describe, expect, it } from "vitest";
import type { ItineraryDay, ItineraryStop } from "@triply/shared";
import { actualSpending, destinationDate, initialJourneyDay, journeyItems, navigationUrl, validCoordinates } from "./journey";

describe("Journey dates and destinations", () => {
  it("uses destination calendar dates across the date line and daylight saving boundaries", () => {
    const instant = new Date("2026-11-05T00:30:00Z");
    expect(destinationDate("America/Los_Angeles", instant)).toBe("2026-11-04");
    expect(destinationDate("Asia/Tokyo", instant)).toBe("2026-11-05");
    expect(destinationDate("Pacific/Kiritimati", new Date("2026-11-05T12:30:00Z"))).toBe("2026-11-06");
    expect(destinationDate("Europe/Warsaw", new Date("2026-03-29T01:30:00Z"))).toBe("2026-03-29");
    expect(destinationDate("Invalid/Zone", instant)).toBeNull();
    const days = ["2026-11-03", "2026-11-04", "2026-11-05"].map((date, index) => ({ date, dayIndex: index + 1, timeZone: "America/Los_Angeles" })) as ItineraryDay[];
    expect(initialJourneyDay(days, "UTC", instant)).toBe(1);
    expect(initialJourneyDay(days, "UTC", new Date("2027-01-01T00:00:00Z"))).toBe(0);
  });
  it("encodes only validated coordinates, including zero, in an external navigation link", () => {
    const url = navigationUrl({ lat: 0, lng: -73.5 } as ItineraryStop)!;
    expect(new URL(url).origin).toBe("https://www.google.com");
    expect(new URL(url).searchParams.get("destination")).toBe("0,-73.5");
    for (const point of [[NaN, 1], [91, 1], [1, 181], [undefined, 1], ["0", 1]]) expect(validCoordinates(...point as [unknown, unknown])).toBeNull();
    expect(navigationUrl(undefined)).toBeNull();
    expect(navigationUrl({ lat: Infinity, lng: 2 } as ItineraryStop)).toBeNull();
  });
  it("uses actual Budget amounts only, preserving separate currencies", () => {
    expect(actualSpending([{ currency: "EUR", actualMinor: 1250, plannedMinor: 9900, automaticMinor: 9900, manualPlannedMinor: 0 }], "EUR")).toBe("€12.50");
    expect(actualSpending([{ currency: "EUR", actualMinor: 0, plannedMinor: 9900, automaticMinor: 9900, manualPlannedMinor: 0 }], "EUR")).toBe("€0.00");
    expect(actualSpending([], null)).toBeNull();
  });
  it("matches repeated occurrences by UUID and ignores travel and breaks", () => {
    const day = { stops: [{ placeId: "same", itineraryItemId: "b" }, { placeId: "same", itineraryItemId: "a" }],
      activities: [{ type: "travel" }, { type: "attraction", placeId: "same", itineraryItemId: "a" }, { type: "break" }, { type: "attraction", placeId: "same", itineraryItemId: "b" }] } as ItineraryDay;
    expect(journeyItems(day).map(({ stopIndex }) => stopIndex)).toEqual([1, 0]);
    day.stops.forEach(stop => { delete stop.itineraryItemId; });
    expect(journeyItems(day).map(({ stopIndex }) => stopIndex)).toEqual([0, 1]);
  });
});
