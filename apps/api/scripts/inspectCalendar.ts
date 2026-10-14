import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import ICAL from "ical.js";
import { renderTripCalendar } from "../src/services/tripCalendar.ts";
import { calendarFixture } from "../src/services/tripCalendar.fixtures.ts";

const output = resolve(process.argv[2] ?? resolve(tmpdir(), "triply-calendar-samples")); await mkdir(output, { recursive: true });
for (const [name, zone, date] of [
  ["barcelona", "Europe/Madrid", "2030-06-02"], ["prague", "Europe/Prague", "2030-06-02"],
  ["tokyo", "Asia/Tokyo", "2030-06-02"], ["dst-transition", "Europe/Madrid", "2030-03-30"],
] as const) {
  const trip = calendarFixture(zone, date); trip.destination = name === "dst-transition" ? "Barcelona" : name[0].toUpperCase() + name.slice(1);
  trip.country = name === "prague" ? "Czech Republic" : name === "tokyo" ? "Japan" : "Spain";
  if (name === "prague" || name === "tokyo") {
    const attraction = name === "prague" ? "Charles Bridge" : "Sensō-ji";
    for (const day of trip.days) {
      day.activities[0].title = attraction;
      Object.assign(day.stops[0], { name: attraction, address: `${trip.destination}, ${trip.country}`, description: "Sample public attraction details for calendar validation." });
    }
  }
  const result = await renderTripCalendar(trip, new Date("2026-10-14T12:00:00Z"));
  const parsed = new ICAL.Component(ICAL.parse(result.content)), events = parsed.getAllSubcomponents("vevent").map(component => new ICAL.Event(component));
  if (events.length !== result.stats.exported) throw new Error("Calendar validation failed");
  await writeFile(resolve(output, `${name}.ics`), result.content, "utf8");
  console.log(`${name}: ${events.length} parsed events; first UTC start ${events[0].startDate.toJSDate().toISOString()} → ${output}`);
}
