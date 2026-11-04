import { describe, expect, it } from "vitest";
import { assistantFixture } from "./assistantFixtures.js";
import { buildConversationContext, localDate } from "./assistantTripContext.js";
import { assistantHistory } from "./assistantHistory.js";
const input = { message: "Day 2?", history: [] };
describe("assistant context fixtures", () => {
  it("projects real day facts, stable IDs, route estimates and scheduling warnings", () => {
    const trip = assistantFixture(); trip.itinerary!.days[1].warnings.push("Travel time is estimated");
    const ctx = buildConversationContext(trip, input);
    expect(ctx.referents.dayIndex).toBe(2);
    expect(ctx.days[1].activities[0]).toMatchObject({ id: "node/2", title: "Retiro Park", openingHours: null, admission: null });
    expect(ctx.days[1].warnings).toContain("Travel time is estimated");
    expect(ctx.days[1].route).toMatchObject({ estimated: true, travelMinutes: 20 });
    expect(JSON.stringify(ctx)).not.toMatch(/userId|guestId|sharing|_id|prompt/);
  });
  it("includes financial summaries for day-cost follow-ups without expense titles or notes", () => {
    const trip = assistantFixture();
    trip.expenses.push({ id: "expense", title: "PRIVATE TITLE", category: "food_drinks", type: "actual", amountMinor: 1800, currency: "EUR", dayId: "2", date: "2026-10-13", note: "private note", attractionId: null, replacesAdmission: false, createdAt: "", updatedAt: "" });
    const ctx = buildConversationContext(trip, { message: "How much will that day cost?", history: [], lastDay: 2 });
    expect(ctx.budget).toMatchObject({ totalBudgetMinor: 50000, actualSpendingMinor: 1800, actualRemainingMinor: 48200, hasIncompletePricing: true });
    expect(ctx.budget!.days[0].dayId).toBe("2");
    expect(JSON.stringify(ctx)).not.toContain("PRIVATE TITLE");
  });
  it("includes saved weather without exposing separate packing data", () => {
    const trip = assistantFixture(); trip.weather = [{ date: "2026-10-13", weatherCode: 61, temperatureMax: 18 }];
    trip.equipment.push({ name: "Rain coat", count: 1, category: "clothing", packed: false, reason: "Private reason" });
    const ctx = buildConversationContext(trip, { ...input, message: "What should I pack?" });
    expect(ctx).not.toHaveProperty("packing");
    expect(ctx.days[1].weather).toMatchObject({ weatherCode: 61, temperatureMax: 18 });
    expect(JSON.stringify(ctx)).not.toContain("Rain coat");
  });
  it("keeps unknown hours unknown, evaluates saved hours and handles missing legacy data", () => {
    const trip = assistantFixture(); trip.attractions[0].openingHours = { raw: "Mo off", source: "osm", checkedAt: null };
    const ctx = buildConversationContext(trip, { ...input, message: "Is Prado Museum open?" });
    expect(ctx.days[0].activities[0]).toMatchObject({ openingHours: { raw: "Mo off" }, availability: { status: "closed" } });
    trip.itinerary!.timeZone = "Invalid/Zone"; trip.itinerary!.days.forEach(d => { d.timeZone = ""; });
    expect(buildConversationContext(trip, input).clock.destinationToday).toBeNull();
    trip.itinerary!.days = trip.itinerary!.days.slice(0, 1);
    expect(buildConversationContext(trip, input).overview).toHaveLength(1);
  });
  it("resolves destination tomorrow across midnight and DST without changing date-only values", () => {
    const ctx = buildConversationContext(assistantFixture(), { ...input, message: "Co mam jutro?", now: new Date("2026-10-11T22:30:00Z"), timeZone: "America/New_York" });
    expect(ctx.clock.destinationToday).toBe("2026-10-12"); expect(ctx.clock.relativeDate).toBe("2026-10-13"); expect(ctx.referents.dayIndex).toBe(2);
    expect(localDate(new Date("2026-03-29T00:30:00Z"), "Europe/Warsaw")).toBe("2026-03-29");
    expect(localDate(new Date("2026-10-25T01:30:00Z"), "Europe/Warsaw")).toBe("2026-10-25");
  });
  it("checks a requested 8 PM visit using saved hours and never treats unresolved arrival as midnight", () => {
    const trip = assistantFixture();
    trip.attractions[0].openingHours = { raw: "Mo-Su 09:00-18:00", source: "osm", checkedAt: null };
    trip.itinerary!.days[0].activities[0].startTime = "";
    trip.itinerary!.days[0].activities[0].schedulingStatus = "unresolved";
    const ctx = buildConversationContext(trip, { ...input, message: "Is Prado Museum open at 8 PM?" });
    expect(ctx.days[0].activities[0]).toMatchObject({ availability: null, requestedVisit: { startMinutes: 1200, availability: { status: "closed" } } });
  });
  it("budgets a large trip with selected day priority and explicit omissions", () => {
    const trip = assistantFixture(); const day = trip.itinerary!.days[0];
    trip.attractions[0].description = "Long description ".repeat(500);
    trip.itinerary!.days = Array.from({ length: 200 }, (_, i) => ({ ...day, dayIndex: i + 1, activities: Array.from({ length: 20 }, () => ({ ...day.activities[0] })) }));
    const ctx = buildConversationContext(trip, { ...input, message: "Day 180?", selectedDayId: "1" });
    expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(28000);
    expect(ctx.days.some(d => d.dayIndex === 180)).toBe(true);
    expect(ctx.coverage.omittedDayDetails.length).toBeGreaterThan(0);
    expect(ctx.days.map(d => d.dayIndex)).toEqual(ctx.days.map(d => d.dayIndex).sort((a, b) => a - b));
    expect(() => buildConversationContext(trip, input, 10)).toThrow(RangeError);
  });
  it("honors explicit selected-day, ordinal and date references over older conversation referents", () => {
    const trip = assistantFixture();
    expect(buildConversationContext(trip, { ...input, message: "What is on the selected day?", lastDay: 2, selectedDayId: "1" }).referents.dayIndex).toBe(1);
    expect(buildConversationContext(trip, { ...input, message: "Co mam drugiego dnia?", lastDay: 1 }).referents.dayIndex).toBe(2);
    expect(buildConversationContext(trip, { ...input, message: "What is planned on 2026-10-13?", lastDay: 1 }).referents.dayIndex).toBe(2);
  });
});
it("bounds history by whole recent pairs and excludes failed turns without truncating instructions", () => {
  const history = Array.from({ length: 100 }, (_, i) => ({ id: String(i), role: i % 2 ? "ai" as const : "user" as const, text: "long".repeat(1000), ...(i > 97 ? { failed: true } : {}) }));
  const selected = assistantHistory(history);
  expect(JSON.stringify(selected).length).toBeLessThan(16000);
  expect(selected[0].role).toBe("user"); expect(selected.at(-1)!.role).toBe("assistant");
});
