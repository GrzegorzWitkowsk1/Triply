import { describe, expect, it, vi } from "vitest";
import ICAL from "ical.js";
import { Types } from "mongoose";
import { calendarFilename, calendarInstant, renderTripCalendar } from "./tripCalendar.js";
import { calendarFixture } from "./tripCalendar.fixtures.js";
import { toPublicTrip } from "../routes/sharing.js";
import { TripModel } from "../models/Trip.js";

const now = new Date("2026-10-14T12:34:56Z");
const parse = (content: string) => new ICAL.Component(ICAL.parse(content));
const events = (content: string) => parse(content).getAllSubcomponents("vevent").map(component => new ICAL.Event(component));
describe("standards-compliant calendar export", () => {
  it("localizes calendar text while retaining IDs, times, Unicode and persisted descriptions across DST", async () => {
    const trip = calendarFixture("Europe/Warsaw", "2030-10-26", 2);
    trip.days.forEach(day => { day.activities.find(a => a.type === "break")!.title = "Lunch break"; });
    trip.days[0].stops[0].description = "Saved English prose: Łódź, ą ć ę ł ń ó ś ź ż; Park Güell.";
    const before = structuredClone(trip);
    const en = events((await renderTripCalendar(trip, now, "en")).content);
    const result = await renderTripCalendar(trip, now, "pl"), pl = events(result.content);
    expect(pl.map(e => [e.uid, e.startDate.toJSDate().toISOString(), e.endDate.toJSDate().toISOString()]))
      .toEqual(en.map(e => [e.uid, e.startDate.toJSDate().toISOString(), e.endDate.toJSDate().toISOString()]));
    expect(pl[0].summary).toBe(en[0].summary);
    expect(pl[0].description).toContain(trip.days[0].stops[0].description);
    expect(pl[0].description).toContain("Czas lokalny miejsca docelowego");
    expect(pl[0].description).toContain("26 października 2030");
    expect(pl[1].summary).toBe("Przerwa na obiad");
    for (const line of result.content.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(trip).toEqual(before);
  });
  it("exports attractions and explicit breaks, skips travel and preserves multi-day event order", async () => {
    const trip = calendarFixture(); trip.days.forEach(day => day.activities.reverse());
    const result = await renderTripCalendar(trip, now), parsed = parse(result.content), list = events(result.content);
    expect(parsed.getFirstPropertyValue("version")).toBe("2.0"); expect(parsed.getFirstPropertyValue("calscale")).toBe("GREGORIAN");
    expect(parsed.getFirstPropertyValue("prodid")).toContain("Triply"); expect(result.stats).toEqual({ exported: 4, excluded: 0, unscheduled: 0, invalid: 0 });
    expect(list.map(e => e.summary)).toEqual(["Sagrada Família", "Lunch", "Sagrada Família", "Lunch"]);
    expect(list[0].startDate.toJSDate().toISOString()).toBe("2030-06-02T07:00:00.000Z"); expect(list[0].endDate.toJSDate().toISOString()).toBe("2030-06-02T08:00:00.000Z");
    expect(String(parsed.getFirstSubcomponent("vevent")!.getFirstPropertyValue("dtstamp"))).toBe("2026-10-14T12:34:56Z");
    expect(list.every(e => e.startDate.zone.tzid === "UTC")).toBe(true);
  });
  it.each([
    ["Europe/Prague", "2030-01-02", "2030-01-02T08:00:00.000Z"],
    ["Asia/Tokyo", "2030-06-02", "2030-06-02T00:00:00.000Z"],
    ["America/New_York", "2030-06-02", "2030-06-02T13:00:00.000Z"],
    ["Asia/Kathmandu", "2030-06-02", "2030-06-02T03:15:00.000Z"],
  ])("resolves %s independently of browser or host timezone", async (zone, date, expected) => {
    const result = await renderTripCalendar(calendarFixture(zone, date, 1), now); expect(events(result.content)[0].startDate.toJSDate().toISOString()).toBe(expected);
  });
  it("uses the correct offsets on both sides of spring DST", async () => {
    const result = await renderTripCalendar(calendarFixture("Europe/Madrid", "2030-03-30", 2), now), list = events(result.content);
    expect(list[0].startDate.toJSDate().toISOString()).toBe("2030-03-30T08:00:00.000Z"); expect(list[2].startDate.toJSDate().toISOString()).toBe("2030-03-31T07:00:00.000Z");
  });
  it("uses the correct offsets across autumn DST, including explicitly disambiguated repeated hours", async () => {
    const result = await renderTripCalendar(calendarFixture("Europe/Madrid", "2030-10-26", 2), now), list = events(result.content);
    expect(list[0].startDate.toJSDate().toISOString()).toBe("2030-10-26T07:00:00.000Z"); expect(list[2].startDate.toJSDate().toISOString()).toBe("2030-10-27T08:00:00.000Z");
    expect(calendarInstant("2030-10-27T02:30:00+02:00", "Europe/Madrid")?.toISOString()).toBe("2030-10-27T00:30:00.000Z");
    expect(calendarInstant("2030-10-27T02:30:00+01:00", "Europe/Madrid")?.toISOString()).toBe("2030-10-27T01:30:00.000Z");
    expect(() => calendarInstant("2030-10-27T02:30:00", "Europe/Madrid")).toThrow(/ambiguous/);
    expect(() => calendarInstant("2030-03-31T02:30:00", "Europe/Madrid")).toThrow(/gap/);
  });
  it("supports southern-hemisphere half-hour DST without hardcoded offsets", () => {
    expect(calendarInstant("2030-04-06T09:00:00", "Australia/Lord_Howe")?.toISOString()).toBe("2030-04-05T22:00:00.000Z");
    expect(calendarInstant("2030-04-07T09:00:00", "Australia/Lord_Howe")?.toISOString()).toBe("2030-04-06T22:30:00.000Z");
  });
  it("round-trips Unicode and all RFC text escapes with UTF-8-safe folding and CRLF", async () => {
    const trip = calendarFixture("Europe/Warsaw", "2030-06-02", 1);
    const title = 'Łódź, muzeum; ścieżka\\park\nNowa linia 🎒 '.repeat(8); trip.days[0].activities[0].title = title;
    trip.days[0].stops[0].address = 'Ulica, 1; wejście\\B\nDrugie piętro';
    trip.days[0].stops[0].description = 'Tekst, średnik; slash\\nowa\nBEGIN:VEVENT\nSUMMARY:Injected';
    const result = await renderTripCalendar(trip, now), list = events(result.content);
    expect(list).toHaveLength(2); expect(list[0].summary).toBe(title); expect(list[0].location).toBe(trip.days[0].stops[0].address);
    expect(list[0].description).toContain(trip.days[0].stops[0].description);
    expect(result.content).toContain("\r\n "); expect(result.content.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(result.content.endsWith("\r\n")).toBe(true);
    for (const line of result.content.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(result.content).not.toContain("�");
  });
  it("reports unresolved, missing and invalid schedules without fabricating events", async () => {
    const trip = calendarFixture(); trip.unscheduledCount = 3;
    Object.assign(trip.days[0].activities[0], { schedulingStatus: "unresolved", startTime: "", endTime: "" });
    trip.days[0].activities[2].endTime = ""; trip.days[1].activities[0].startTime = "2030-02-30T09:00:00";
    const result = await renderTripCalendar(trip, now); expect(result.stats).toEqual({ exported: 1, excluded: 6, unscheduled: 5, invalid: 1 });
    expect(events(result.content)[0].summary).toBe("Lunch"); expect(result.content).not.toContain("VALUE=DATE");
  });
  it("handles optional descriptions and addresses and explicitly marks unknown opening hours", async () => {
    const trip = calendarFixture(undefined, undefined, 1); Object.assign(trip.days[0].stops[0], { description: null, address: null });
    const list = events((await renderTripCalendar(trip, now)).content); expect(list[0].location).toBe("Location unavailable"); expect(list[0].description).toContain("Opening hours are unknown");
    expect(list[0].description).toContain("Manual calendar export");
  });
  it("rejects empty itineraries, schedules without events and missing destination timezones", async () => {
    const trip = calendarFixture(); trip.days = []; await expect(renderTripCalendar(trip)).rejects.toMatchObject({ code: "empty-itinerary", status: 422 });
    trip.days = calendarFixture().days; trip.days.forEach(day => day.activities = []); await expect(renderTripCalendar(trip)).rejects.toMatchObject({ code: "no-events" });
    trip.days = calendarFixture().days; trip.days[0].timeZone = ""; await expect(renderTripCalendar(trip)).rejects.toMatchObject({ code: "invalid-timezone" });
  });
  it("excludes malformed dates, offset mismatches and nonpositive durations", async () => {
    const trip = calendarFixture(undefined, undefined, 1); trip.days[0].activities[0].startTime = "2030-06-02T09:00:00+09:00";
    trip.days[0].activities[2].endTime = trip.days[0].activities[2].startTime;
    await expect(renderTripCalendar(trip)).rejects.toMatchObject({ code: "no-events" });
    expect(calendarInstant("2030-06-02T25:00:00", "Europe/Madrid")).toBeNull(); expect(calendarInstant("not-a-date", "Europe/Madrid")).toBeNull();
  });
  it("keeps UIDs stable and globally distinct without exposing trip IDs or share tokens", async () => {
    const source = calendarFixture(undefined, undefined, 1), id = new Types.ObjectId();
    const record = new TripModel({ _id: id, analysis: { destination: "Barcelona", country: "Spain", startDate: source.startDate, endDate: source.endDate, durationDays: 1 },
      itinerary: { timeZone: "Europe/Madrid", routingSource: "provider", unscheduled: [], days: source.days.map(day => ({ ...day, stops: day.stops.map(s => ({ ...s, placeId: "provider/stable", score: null })), activities: day.activities.map(a => ({ ...a, placeId: a.type === "attraction" ? "provider/stable" : undefined })) })) },
    });
    const first = toPublicTrip(record, { calendarMetadata: true }); const uid = first.days[0].activities[0].calendarUid;
    record.itinerary!.unscheduled = ["provider/stable", "provider/unscheduled"].map(placeId => ({ place: { ...source.days[0].stops[0], placeId, score: null }, dayIndex: 1, reason: "insufficient-time", detail: "PRIVATE DIAGNOSTIC" }));
    expect(toPublicTrip(record, { calendarMetadata: true }).unscheduledCount).toBe(1);
    expect(toPublicTrip(record)).not.toHaveProperty("unscheduledCount"); expect(toPublicTrip(record).days[0].activities[0]).not.toHaveProperty("calendarUid");
    record.itinerary!.days[0].activities[0].title = "Renamed attraction"; record.itinerary!.days[0].activities.reverse();
    expect(toPublicTrip(record, { calendarMetadata: true }).days[0].activities.find(a => a.type === "attraction")?.calendarUid).toBe(uid);
    const outputA = await renderTripCalendar(first, now), outputB = await renderTripCalendar(first, new Date("2026-10-15T12:00:00Z"));
    expect(events(outputA.content).map(e => e.uid)).toEqual(events(outputB.content).map(e => e.uid));
    expect(outputA.content).not.toContain(String(id)); expect(outputA.content).not.toContain("provider/stable");
    const another = new TripModel({ ...record.toObject(), _id: new Types.ObjectId() });
    expect(toPublicTrip(another, { calendarMetadata: true }).days[0].activities.find(a => a.type === "attraction")?.calendarUid).not.toBe(uid);
  });
  it("bounds resource usage and performs no external requests or input mutation", async () => {
    const trip = calendarFixture(); const before = structuredClone(trip), fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Forbidden"));
    try { await renderTripCalendar(trip, now); expect(trip).toEqual(before); expect(fetch).not.toHaveBeenCalled(); } finally { fetch.mockRestore(); }
    trip.days[0].activities[0].title = "X".repeat(310_000); await expect(renderTripCalendar(trip)).rejects.toMatchObject({ status: 413 });
    expect(calendarFilename({ destination: '../../Łódź\r\n<script>', startDate: '2030-06-02' })).toBe("triply-lodz-script-2030-06-02.ics");
  });
});
