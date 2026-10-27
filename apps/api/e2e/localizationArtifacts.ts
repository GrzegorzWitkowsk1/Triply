import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import ICAL from "ical.js";
import { expect, openExportMenu } from "./fixtures.ts";

/** Exercise browser downloads and inspect the actual exported files. */
export async function localizedArtifacts(page: Page, locale: "en" | "pl") {
  await openExportMenu(page);
  const pdfDownload = page.waitForEvent("download");
  const pdfResponse = page.waitForResponse(response => response.url().includes(`/export/pdf?locale=${locale}`));
  await page.getByRole("menuitem", { name: locale === "pl" ? "Pobierz PDF" : "Download PDF", exact: true }).click();
  expect((await pdfResponse).headers()["content-language"]).toBe(locale);
  const pdf = await pdfDownload;
  const task = getDocument({ data: new Uint8Array(await readFile((await pdf.path())!)), useSystemFonts: false });
  let text = "";
  try {
    const document = await task.promise;
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      // A subset font may split diacritics into separate runs; preserve PDF text runs.
      text += content.items.filter(item => "str" in item).map(item => item.str).join("");
    }
  } finally { await task.destroy(); }
  expect(text).toContain(locale === "pl" ? "PLAN PODRÓŻY" : "TRAVEL ITINERARY");
  expect(text).toContain(locale === "pl" ? "Dzień 1" : "Day 1");
  expect(text).not.toContain("�");
  await openExportMenu(page);
  const calendarDownload = page.waitForEvent("download");
  const calendarResponse = page.waitForResponse(response => response.url().includes(`/export/calendar?locale=${locale}`));
  await page.getByRole("menuitem", { name: locale === "pl" ? "Eksportuj do kalendarza" : "Export to Calendar", exact: true }).click();
  expect((await calendarResponse).headers()["content-language"]).toBe(locale);
  const file = await calendarDownload;
  const calendar = new ICAL.Component(ICAL.parse(await readFile((await file.path())!, "utf8")));
  const events = calendar.getAllSubcomponents("vevent");
  expect(events.length).toBeGreaterThan(0);
  expect(events[0]!.getFirstPropertyValue("description")).toContain(locale === "pl" ? "Dzień 1" : "Day 1");
  return { text, events: events.map(event => ({ uid: event.getFirstPropertyValue("uid"), start: String(event.getFirstPropertyValue("dtstart")), end: String(event.getFirstPropertyValue("dtend")) })) };
}
