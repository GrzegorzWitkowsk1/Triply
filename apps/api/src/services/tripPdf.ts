import PDFDocument from "pdfkit";
import { createRequire } from "node:module";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { contentLocale, exportText, exportActivityTitle, formatDate, formatDateRange, formatNumber, formatInteger, formatDistance, formatLocalTime, type SupportedLocale, type PublicTrip } from "@triply/shared";

const require = createRequire(import.meta.url);
const unicode = require("@fontsource/noto-sans/unicode.json") as Record<string, string>;
const subsets = Object.entries(unicode).sort(([a], [b]) => Number(b === "latin") - Number(a === "latin"));
const ranges = subsets.map(([name, value]) => ({ name, ranges: value.split(",").map(range => {
  const [start, end = start] = range.replace("U+", "").split("-"); return [parseInt(start, 16), parseInt(end, 16)];
}) }));
const MARGIN = 44, BODY_BOTTOM = 765, LINE_HEIGHT = 16;
const TEXT = "#1c1c1c", MUTED = "#626262", PRIMARY = "#f2664b";
export const PDF_LIMITS = { days: 365, activities: 1500, characters: 200_000, pages: 120, bytes: 8 * 1024 * 1024, concurrent: 2 } as const;
export class PdfExportError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
let active = 0;
export function reservePdfExport(): () => void {
  if (active >= PDF_LIMITS.concurrent) throw new PdfExportError(503, "PDF export is busy. Please try again shortly.");
  active++;
  let released = false;
  return () => { if (!released) { released = true; active--; } };
}
export function pdfFilename(trip: Pick<PublicTrip, "destination" | "startDate">): string {
  const city = (trip.destination ?? "itinerary").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ł/gi, "l")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "itinerary";
  const date = trip.startDate && /^\d{4}-\d{2}-\d{2}$/.test(trip.startDate) ? `-${trip.startDate}` : "";
  return `triply-${city}${date}.pdf`;
}
export function localPdfTime(value: string, locale: SupportedLocale = "en"): string {
  try { return formatLocalTime(value, locale); } catch { return exportText(locale, "exports/pdf")("timeUnknown"); }
}
function weatherSummary(code: number, locale: SupportedLocale): string | null {
  const key = code === 0 ? "clear" : code === 1 ? "mainlyClear" : code === 2 ? "partlyCloudy" : code === 3 ? "overcast"
    : [45,48].includes(code) ? "fog" : [51,53,55,56,57].includes(code) ? "drizzle"
    : [61,63,65,66,67,80,81,82].includes(code) ? "rain" : [71,73,75,77,85,86].includes(code) ? "snow"
    : [95,96,99].includes(code) ? "thunderstorms" : null;
  return key ? exportText(locale, "exports/pdf")(key) : null;
}
const minutes = (value: number, locale: SupportedLocale) => Number.isFinite(value) && value >= 0
  ? exportText(locale, "exports/pdf")("minutes", { value: formatInteger(Math.round(value), locale) }) : exportText(locale, "exports/pdf")("durationUnknown");
function pdfDate(value: string, locale: SupportedLocale): string {
  try { return formatDate(value, { dateStyle: "long" }, locale); } catch { return exportText(locale, "exports/pdf")("dateUnknown"); }
}
function pdfDateRange(start: string, end: string, locale: SupportedLocale): string {
  try { return formatDateRange(start, end, { dateStyle: "long" }, locale); }
  catch { return `${pdfDate(start, locale)} — ${pdfDate(end, locale)}`; }
}
const clean = (value: string) => value.normalize("NFC").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

function entryContent(day: PublicTrip["days"][number], activity: PublicTrip["days"][number]["activities"][number], locale: SupportedLocale) {
  const t = exportText(locale, "exports/pdf");
  const stop = activity.type === "attraction" && activity.stopIndex !== null ? day.stops[activity.stopIndex] : undefined;
  const heading = `${activity.schedulingStatus === "unresolved" ? t("timeUnresolved") : `${localPdfTime(activity.startTime, locale)} — ${localPdfTime(activity.endTime, locale)}`}  |  ${exportActivityTitle(activity.title, activity.type, locale)}`;
  const details: string[] = [];
  if (activity.type === "attraction") {
    details.push(`${t(activity.durationSource === "estimated" ? "estimatedVisit" : "visit")}: ${minutes(activity.durationMinutes, locale)}`);
    details.push(t(activity.openingHoursStatus === "closed" ? "hoursClosed" : activity.openingHoursStatus === "open" ? "hoursOpen" : "hoursUnknown"));
    if (stop?.address) details.push(t("address", { address: stop.address }));
    if (stop?.description) details.push(stop.description);
  } else if (activity.type === "travel") {
    details.push(activity.travelDurationSource === "unavailable" ? t("travelUnknown") : `${t(activity.travelDurationSource === "provider" ? "savedTravel" : "estimatedTravel")}: ${minutes(activity.durationMinutes, locale)}`);
    if (activity.distanceMeters !== null) details.push(t("distance", { distance: formatDistance(activity.distanceMeters, 2, locale) }));
  } else details.push(t("break", { duration: minutes(activity.durationMinutes, locale) }));
  return { heading, details };
}

/** Text-only A4 layout. No HTML, remote URLs, provider calls or database writes. */
export async function renderTripPdf(trip: PublicTrip, locale: SupportedLocale = "en"): Promise<Buffer> {
  locale = contentLocale(locale);
  const t = exportText(locale, "exports/pdf");
  const count = trip.days.reduce((sum, d) => sum + d.activities.length, 0);
  const charCount = JSON.stringify(trip).length;
  if (trip.days.length > PDF_LIMITS.days || count > PDF_LIMITS.activities || charCount > PDF_LIMITS.characters)
    throw new PdfExportError(413, "This itinerary is too large to export as one PDF.");
  const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 78 },
    bufferPages: true, autoFirstPage: false, info: { Title: `${t("title")} — ${clean(trip.destination ?? t("trip"))}`, Author: "Triply", Creator: "Triply" } });
  const chunks: Buffer[] = [];
  let byteCount = 0;
  let streamError: Error | undefined;
  doc.on("error", error => { streamError = error; });
  const completion = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => { byteCount += chunk.length;
      if (byteCount > PDF_LIMITS.bytes) doc.destroy(new PdfExportError(413, "The generated PDF is too large."));
      else chunks.push(chunk);
    });
    doc.once("end", () => resolve(Buffer.concat(chunks)));
    doc.once("error", reject);
  });
  // Attach a rejection handler immediately, before asynchronous layout begins.
  void completion.catch(() => {});
  const registered = new Set<string>();
  const widths = new Map<string, number>();
  const start = Date.now();
  let y = MARGIN;
  let pageCount = 0;
  const width = 595.28 - MARGIN * 2;
  function fontFor(character: string, bold: boolean): string {
    const code = character.codePointAt(0)!;
    const subset = ranges.find(s => s.ranges.some(([a, b]) => code >= a && code <= b))?.name ?? "latin";
    const name = `${subset}-${bold ? 700 : 400}`;
    if (!registered.has(name)) {
      doc.registerFont(name, require.resolve(`@fontsource/noto-sans/files/noto-sans-${name}-normal.woff`)); registered.add(name);
    }
    return name;
  }
  function charWidth(character: string, size: number, bold: boolean) {
    const font = fontFor(character, bold), key = `${font}:${size}:${character}`;
    if (!widths.has(key)) widths.set(key, doc.font(font).fontSize(size).widthOfString(character));
    return widths.get(key)!;
  }
  function wrap(value: string, size: number, bold: boolean): string[] {
    const lines: string[] = [];
    for (const paragraph of clean(value).split(/\r?\n/)) {
      let line = "", lineWidth = 0;
      for (const word of paragraph.split(/\s+/)) {
        const chars = [...word]; const wordWidth = chars.reduce((sum, c) => sum + charWidth(c, size, bold), 0);
        const spaceWidth = line ? charWidth(" ", size, bold) : 0;
        if (line && lineWidth + spaceWidth + wordWidth > width) { lines.push(line); line = ""; lineWidth = 0; }
        if (line) { line += " "; lineWidth += spaceWidth; }
        for (const c of chars) {
          const w = charWidth(c, size, bold);
          if (line && lineWidth + w > width) { lines.push(line); line = ""; lineWidth = 0; }
          line += c; lineWidth += w;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  function drawLine(line: string, atY: number, size: number, bold: boolean, color: string, x = MARGIN) {
    // Select fonts per run, so subset fonts preserve diacritics and extraction.
    let run = "", current = "", runX = x;
    const flush = () => { if (run) { doc.font(current).fontSize(size).fillColor(color).text(run, runX, atY, { lineBreak: false }); runX += doc.widthOfString(run); run = ""; } };
    for (const c of line) { const font = fontFor(c, bold); if (font !== current) { flush(); current = font; } run += c; }
    flush();
  }
  function newPage() {
    if (++pageCount > PDF_LIMITS.pages) throw new PdfExportError(413, "This itinerary requires too many PDF pages.");
    doc.addPage(); y = MARGIN;
    if (pageCount > 1) { drawLine(`Triply · ${t("title")}`, y, 10, true, PRIMARY); y += 28; }
  }
  function ensure(height: number) { if (y + height > BODY_BOTTOM) newPage(); }
  async function text(value: string, size = 10.5, bold = false, color = TEXT, after = 5) {
    const lines = wrap(value, size, bold), leading = size === 10.5 ? LINE_HEIGHT : size * 1.4;
    for (let i = 0; i < lines.length; i++) {
      ensure(leading); drawLine(lines[i], y, size, bold, color); y += leading;
      if (i % 20 === 19) await yieldToLoop();
    }
    y += after;
  }
  async function checkpoint() {
    await yieldToLoop();
    if (streamError) throw streamError;
    if (Date.now() - start > 15_000) throw new PdfExportError(503, "PDF export took too long. Please try again.");
  }
  function entryHeight(entry: ReturnType<typeof entryContent>) {
    return wrap(entry.heading, 11, true).length * 15.4 + 6 + 10 + entry.details.reduce((sum, d) => sum + wrap(d, 10.5, false).length * LINE_HEIGHT + 5, 0);
  }
  try {
    newPage();
    await text("Triply", 24, true, PRIMARY, 3);
    await text(t("banner"), 10.5, true, MUTED, 10);
    await text([trip.destination ?? t("destinationUnknown"), trip.country].filter(Boolean).join(", "), 22, true, TEXT, 8);
    await text(trip.startDate ? (trip.endDate ? pdfDateRange(trip.startDate, trip.endDate, locale) : `${pdfDate(trip.startDate, locale)} · ${t("endUnknown")}`) : t("datesUnknown"), 11, false, MUTED);
    await text(trip.durationDays ? t(`days_${new Intl.PluralRules(locale).select(trip.durationDays) as "one" | "few" | "many" | "other"}`, { count: formatInteger(trip.durationDays, locale) }) : t("durationUnknown"), 11, false, MUTED, 16);
    if (!trip.days.length) await text(t("noItinerary"));
    for (const day of trip.days) {
      const heading = t("day", { day: formatInteger(day.dayIndex, locale), date: day.date ? pdfDate(day.date, locale) : t("dateUnknown") });
      const weather = trip.weather.find(w => w.date === day.date);
      const information = [day.timeZone ? t("localTimes", { zone: day.timeZone }) : t("zoneUnknown"),
        ...(day.travelMode ? [t("travelMode", { mode: t(day.travelMode) })] : []),
        ...(weather && weatherSummary(weather.weatherCode, locale) ? [t("forecast", { condition: weatherSummary(weather.weatherCode, locale)!, temperature: formatNumber(weather.temperatureMax, {}, locale) })] : []),
        ...(day.warnings ?? []).map(w => t(w))];
      const headerHeight = 12 + wrap(heading, 16, true).length * 22.4 + 4 + information.reduce((sum, line) => sum + wrap(line, 9, false).length * 12.6 + 5, 0);
      const firstHeight = day.activities[0] ? entryHeight(entryContent(day, day.activities[0], locale)) : 30;
      const firstReserve = firstHeight + headerHeight <= BODY_BOTTOM - 80 ? firstHeight : 100;
      // Reserve room for the first visit as well as all day notices: no orphaned day headings.
      ensure(headerHeight + firstReserve);
      doc.moveTo(MARGIN, y).lineTo(MARGIN + width, y).strokeColor(PRIMARY).lineWidth(2).stroke(); y += 12;
      await text(heading, 16, true, TEXT, 4);
      for (const line of information) await text(line, 9, false, MUTED);
      if (!day.activities.length) await text(t("noActivities"));
      // Persisted order is authoritative, including manually ordered unresolved visits.
      for (const activity of day.activities) {
        const entry = entryContent(day, activity, locale), { heading, details } = entry;
        const height = entryHeight(entry);
        // Keep ordinary entries intact; long entries split at line boundaries.
        const firstNeedsSplit = activity === day.activities[0] && headerHeight + height > BODY_BOTTOM - 80;
        ensure(!firstNeedsSplit && height <= BODY_BOTTOM - 80 ? height : Math.min(100, height));
        await text(heading, 11, true, activity.type === "travel" ? MUTED : TEXT, 6);
        for (const detail of details) await text(detail, 10.5, false, MUTED);
        y += 10; await checkpoint();
      }
      y += 12; await checkpoint();
    }
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc.moveTo(MARGIN, 787).lineTo(MARGIN + width, 787).strokeColor("#dcdcdc").lineWidth(0.5).stroke();
      drawLine(t("page", { page: formatInteger(i + 1, locale), pages: formatInteger(pages.count, locale) }), 796, 8, true, MUTED);
      drawLine(t("footer"), 810, 8, false, MUTED);
    }
    doc.end(); return await completion;
  } catch (error) { doc.destroy(); throw error; }
}
