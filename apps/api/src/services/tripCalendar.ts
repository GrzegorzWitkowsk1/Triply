import ical from "ical-generator";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { isIsoDate, type CalendarErrorCode, type CalendarExportStats, type PublicTrip } from "@triply/shared";
import { isValidTimeZone, offsetMinutes } from "./timeZone.js";
import { pdfFilename } from "./tripPdf.js";

export class CalendarExportError extends Error {
  constructor(public readonly status: number, public readonly code: CalendarErrorCode, message: string) { super(message); }
}
const MAX_ACTIVITIES = 2000, MAX_CHARACTERS = 300_000, MAX_BYTES = 2 * 1024 * 1024;
type Activity = PublicTrip["days"][number]["activities"][number];
export const calendarFilename = (trip: Pick<PublicTrip, "destination" | "startDate">) => pdfFilename(trip).replace(/\.pdf$/, ".ics");

/** Resolve saved wall-clock fields with the authoritative day timezone, never host/browser timezone. */
export function calendarInstant(value: string, timeZone: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !isIsoDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return null;
  if (!isValidTimeZone(timeZone)) throw new CalendarExportError(422, "invalid-timezone", "Calendar export needs a valid destination timezone. Review the trip schedule.");
  const naive = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}Z`);
  const suffix = match[5];
  if (suffix) {
    if (suffix !== "Z" && (Number(suffix.slice(1, 3)) > 23 || Number(suffix.slice(4)) > 59)) return null;
    const instant = Date.parse(value);
    // Validate supplied offsets against the saved destination wall-clock time.
    return Number.isFinite(instant) && instant + offsetMinutes(timeZone, instant) * 60_000 === naive ? new Date(instant) : null;
  }
  const offsets = new Set([-36, -12, 0, 12, 36].map(hours => offsetMinutes(timeZone, naive + hours * 3_600_000)));
  const candidates = [...offsets].map(offset => naive - offset * 60_000)
    .filter(instant => instant + offsetMinutes(timeZone, instant) * 60_000 === naive);
  if (!candidates.length) throw new CalendarExportError(422, "nonexistent-time", "A scheduled local time falls in a daylight-saving gap. Correct the schedule before exporting.");
  if (candidates.length > 1) throw new CalendarExportError(422, "ambiguous-time", "A scheduled local time is ambiguous during a clock change. Save an explicit valid offset before exporting.");
  return new Date(candidates[0]);
}
const clean = (value: string) => value.normalize("NFC").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
function description(trip: PublicTrip, day: PublicTrip["days"][number], activity: Activity): string {
  const stop = activity.type === "attraction" && activity.stopIndex !== null ? day.stops[activity.stopIndex] : undefined;
  const notes: string[] = [];
  if (stop?.description) notes.push([...clean(stop.description)].slice(0, 600).join(""));
  if (activity.durationMinutes > 0) notes.push(`${activity.durationSource === "estimated" ? "Estimated visit duration" : "Saved duration"}: ${activity.durationMinutes} minutes.`);
  if (activity.type === "attraction") notes.push(activity.openingHoursStatus === "closed" ? "Opening-hours conflict: verify before visiting."
    : activity.openingHoursStatus === "open" ? "Opening-hours check applies to the saved schedule; verify before visiting." : "Opening hours are unknown; verify before visiting.");
  notes.push(`Destination local time: ${activity.startTime} — ${activity.endTime} (${day.timeZone}).`);
  notes.push(`Triply · ${trip.destination ?? "Travel itinerary"}. Manual calendar export; no automatic synchronization.`);
  return clean(notes.join("\n"));
}
export async function renderTripCalendar(trip: PublicTrip, now = new Date()): Promise<{ content: string; stats: CalendarExportStats }> {
  if (!trip.days.length) throw new CalendarExportError(422, "empty-itinerary", "There is no saved itinerary to export.");
  if (trip.days.length > 365 || trip.days.reduce((sum, d) => sum + d.activities.length, 0) > MAX_ACTIVITIES || JSON.stringify(trip).length > MAX_CHARACTERS)
    throw new CalendarExportError(413, "too-large", "This itinerary is too large to export as one calendar.");
  const stats: CalendarExportStats = { exported: 0, excluded: trip.unscheduledCount ?? 0, unscheduled: trip.unscheduledCount ?? 0, invalid: 0 };
  const events: { day: PublicTrip["days"][number]; activity: Activity; start: Date; end: Date }[] = [];
  for (const day of trip.days) {
    for (const activity of day.activities) {
      if (activity.type === "travel") continue;
      if (activity.schedulingStatus === "unresolved" || !activity.startTime || !activity.endTime) { stats.unscheduled++; stats.excluded++; continue; }
      if (!isIsoDate(day.date) || activity.startTime.slice(0, 10) !== day.date) { stats.invalid++; stats.excluded++; continue; }
      const start = calendarInstant(activity.startTime, day.timeZone), end = calendarInstant(activity.endTime, day.timeZone);
      if (!start || !end || end <= start || end.getTime() - start.getTime() > 48 * 3_600_000) { stats.invalid++; stats.excluded++; continue; }
      if (!activity.calendarUid || !/^[a-f0-9]{64}@calendar\.triply\.invalid$/.test(activity.calendarUid))
        throw new CalendarExportError(422, "invalid-identity", "Calendar export could not identify a saved activity. Reload the trip and try again.");
      events.push({ day, activity, start, end });
    }
    await yieldToLoop();
  }
  if (!events.length) throw new CalendarExportError(422, "no-events", `No scheduled activities could be exported. ${stats.excluded} items need valid start/end times and dates.`);
  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  const calendar = ical({ prodId: { company: "Triply", product: "Travel Itinerary", language: "EN" }, scale: "GREGORIAN", name: clean(`Triply — ${trip.destination ?? "Travel itinerary"}`) });
  calendar.x("X-TRIPLY-EXCLUDED-ITEMS", String(stats.excluded));
  for (const { day, activity, start, end } of events) {
    const stop = activity.type === "attraction" && activity.stopIndex !== null ? day.stops[activity.stopIndex] : undefined;
    calendar.createEvent({ id: activity.calendarUid, stamp: now, start, end, summary: clean(activity.title),
      description: description(trip, day, activity), location: clean(stop?.address ?? "Location unavailable") });
  }
  stats.exported = events.length;
  const content = calendar.toString();
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw new CalendarExportError(413, "too-large", "The generated calendar is too large.");
  return { content: content.endsWith("\r\n") ? content : `${content}\r\n`, stats };
}
