import { describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { localPdfTime, PDF_LIMITS, PdfExportError, pdfFilename, renderTripPdf, reservePdfExport } from "./tripPdf.js";
import { pdfFixture } from "./tripPdf.fixtures.js";

export async function readPdf(bytes: Buffer) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i), text = await page.getTextContent();
      pages.push({ text: text.items.filter(item => "str" in item).map(item => item.str).join(""),
        items: text.items.filter(item => "str" in item), view: page.view });
    }
    return pages;
  } finally { await task.destroy(); }
}
describe("Triply A4 PDF renderer", () => {
  it.each(["en", "pl"] as const)("renders real %s PDFs with Unicode, localized labels, bounded layout and unchanged saved prose", async locale => {
    const trip = pdfFixture(3, 7, true);
    trip.destination = "Łódź — Sagrada Família " .repeat(8);
    trip.days[0].stops[0].description = "Saved English description. ą ć ę ł ń ó ś ź ż. Park Güell.";
    const before = structuredClone(trip);
    const pages = await readPdf(await renderTripPdf(trip, locale));
    const text = pages.map(page => page.text).join(" ");
    for (const value of ["Saved English description.", "ą ć ę ł ń ó ś ź ż", "Park Güell", "09:15", "Europe/Warsaw"])
      expect(text).toContain(value);
    expect(text).toContain(locale === "pl" ? "PLAN PODRÓŻY" : "TRAVEL ITINERARY");
    expect(text).toContain(locale === "pl" ? "Dzień 1" : "Day 1");
    expect(text).toContain(locale === "pl" ? "Strona 1 z" : "Page 1 of");
    expect(text).not.toContain("�");
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages) {
      expect(page.text.length).toBeGreaterThan(100);
      for (const item of page.items) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(43);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(553);
        expect(item.transform[5]).toBeGreaterThan(18);
        expect(item.transform[5]).toBeLessThan(800);
      }
    }
    expect(trip).toEqual(before);
  });
  it("embeds diacritics, preserves local time and saved order across multiple days", async () => {
    const bytes = await renderTripPdf(pdfFixture()); expect(bytes.subarray(0, 5).toString()).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(1000);
    const pages = await readPdf(bytes); const text = pages.map(p => p.text).join(" ");
    for (const value of ["Łódź", "Zażółć gęślą jaźń", "09:15", "10:30", "Europe/Warsaw", "Day 1", "Day 2", "Opening hours unknown", "Saved forecast", "Page 1 of"]) expect(text).toContain(value);
    expect(text.indexOf("Visit 1.1")).toBeLessThan(text.indexOf("Visit 1.2")); expect(text.indexOf("Visit 1.3")).toBeLessThan(text.indexOf("Visit 2.1"));
    expect(pages[0].view[2]).toBeCloseTo(595.28, 1); expect(pages[0].view[3]).toBeCloseTo(841.89, 1);
    expect(text).not.toContain("Coordinates:"); expect(text).not.toContain("51.76000"); expect(text).not.toContain("19.46000");
  });
  it("paginates long descriptions and long unbroken names without clipped text", async () => {
    const trip = pdfFixture(5, 8, true); trip.days[0].activities[0].title = "Ł".repeat(350);
    const pages = await readPdf(await renderTripPdf(trip)); expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) for (const item of page.items) {
      expect(item.transform[4]).toBeGreaterThanOrEqual(43);
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(553);
      expect(item.transform[5]).toBeGreaterThan(18);
      expect(item.transform[5]).toBeLessThan(800);
    }
    const text = pages.map(p => p.text).join(" "); expect(text).toContain("Visit 5.8"); expect(text).toContain(`Page ${pages.length} of ${pages.length}`);
    for (let day = 2; day <= 5; day++) {
      const page = pages.find(p => p.text.includes(`Day ${day}`)); expect(page?.text).toContain(`Visit ${day}.1`);
    }
  });
  it("handles missing dates, times, timezone and itinerary without fabrication", async () => {
    const trip = pdfFixture(1, 1); Object.assign(trip, { destination: null, country: null, startDate: null, endDate: null, durationDays: null, weather: [] });
    Object.assign(trip.days[0], { date: "", timeZone: "", travelMode: null, warnings: [] });
    Object.assign(trip.days[0].activities[0], { startTime: "", endTime: "", openingHoursStatus: null });
    Object.assign(trip.days[0].stops[0], { description: null, address: null });
    const text = (await readPdf(await renderTripPdf(trip))).map(p => p.text).join(" ");
    expect(text).toContain("Trip dates unavailable"); expect(text).toContain("Timezone unavailable"); expect(text).toContain("Time unavailable"); expect(text).not.toContain("Saved forecast");
    trip.days = []; expect((await readPdf(await renderTripPdf(trip)))[0].text).toContain("No saved itinerary");
  });
  it("renders untrusted HTML as inert text, performs no network calls and leaves input untouched", async () => {
    const trip = pdfFixture(1, 1); trip.days[0].stops[0].description = '<script>alert("secret")</script> https://127.0.0.1/internal';
    const before = structuredClone(trip); const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    try { const text = (await readPdf(await renderTripPdf(trip)))[0].text; expect(text).toContain("<script>"); expect(fetch).not.toHaveBeenCalled(); expect(trip).toEqual(before); } finally { fetch.mockRestore(); }
  });
  it("bounds document size and concurrent exports", async () => {
    const trip = pdfFixture(); trip.days[0].stops[0].description = "X".repeat(PDF_LIMITS.characters + 1);
    await expect(renderTripPdf(trip)).rejects.toMatchObject({ status: 413 });
    const releaseA = reservePdfExport(), releaseB = reservePdfExport();
    expect(() => reservePdfExport()).toThrow(PdfExportError); releaseA(); releaseA(); const releaseC = reservePdfExport(); releaseB(); releaseC();
  });
  it("sanitizes filenames and never converts local timestamps through browser timezones", () => {
    expect(pdfFilename({ destination: "../../Łódź\r\n<script>", startDate: "2030-10-27" })).toBe("triply-lodz-script-2030-10-27.pdf");
    expect(pdfFilename({ destination: "", startDate: "../../" })).toBe("triply-itinerary.pdf");
    expect(localPdfTime("2030-10-27T02:30:00+02:00")).toBe("02:30"); expect(localPdfTime("2030-10-27T02:30:00+01:00")).toBe("02:30");
  });
});
