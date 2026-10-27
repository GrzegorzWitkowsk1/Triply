import { readFile } from "node:fs/promises";
import ICAL from "ical.js";
import { test, expect, login, openTrip, openExportMenu } from "./fixtures.ts";

test.use({ scenario: "editing" });
test("owner and anonymous visitor export valid calendars, show toast counts and enforce revocation", async ({ page, user, browser, harness }) => {
  await page.addInitScript(() => localStorage.setItem("triply.language", "en"));
  await login(page, user); await openTrip(page, user.tripId!);
  await expect(page.getByRole("button", { name: "What should I take?" })).toBeVisible();
  const order = await page.locator(".trip-hero-actions").evaluate(element => [...element.querySelectorAll("button")].map(button => button.textContent?.trim() || button.getAttribute("aria-label")));
  expect(order.at(-2)).toBe("Regenerate Day"); expect(order.at(-1)).toBe("More export options");
  const before = await harness.trip(user.tripId!); await openExportMenu(page);
  const ownerDownload = page.waitForEvent("download"); await page.getByRole("menuitem", { name: "Export to Calendar", exact: true }).click();
  const file = await ownerDownload; expect(file.suggestedFilename()).toMatch(/^triply-barcelona-.*\.ics$/);
  const content = await readFile((await file.path())!, "utf8"), parsed = new ICAL.Component(ICAL.parse(content));
  const expectedCount = before.itinerary!.days.flatMap(d => d.activities).filter(a => a.type !== "travel" && a.schedulingStatus !== "unresolved" && a.startTime && a.endTime).length;
  expect(parsed.getAllSubcomponents("vevent")).toHaveLength(expectedCount); await expect(page.locator(".MuiSnackbar-root").getByRole("alert")).toContainText("1 item excluded");
  expect(await page.locator(".trip-export-actions").getByText(/events exported/).count()).toBe(0);
  const after = await harness.trip(user.tripId!); expect(after.itinerary).toEqual(before.itinerary); expect(after.itineraryVersion).toBe(before.itineraryVersion);
  await openExportMenu(page); await page.getByRole("menuitem", { name: "Share", exact: true }).click(); await page.getByRole("button", { name: "Enable sharing", exact: true }).click();
  const link = await page.getByLabel("Share link").inputValue(), anonymous = await browser.newContext();
  await anonymous.addInitScript(() => localStorage.setItem("triply.language", "en")); const visitor = await anonymous.newPage();
  try {
    await visitor.goto(link); await expect(visitor.getByRole("heading", { level: 1 })).toContainText("Barcelona");
    await expect(visitor.locator(".trip-export-buttons").getByRole("button")).toHaveCount(2);
    await expect(visitor.getByRole("button", { name: "Language: English" })).toBeVisible();
    await visitor.setViewportSize({ width: 375, height: 812 });
    expect(await visitor.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(375);
    const download = visitor.waitForEvent("download"); await visitor.getByRole("button", { name: "Export to Calendar", exact: true }).click();
    const shared = await download; expect(shared.suggestedFilename()).toMatch(/\.ics$/);
    const sharedCalendar = new ICAL.Component(ICAL.parse(await readFile((await shared.path())!, "utf8")));
    expect(sharedCalendar.getAllSubcomponents("vevent").map(e => e.getFirstPropertyValue("uid"))).toEqual(parsed.getAllSubcomponents("vevent").map(e => e.getFirstPropertyValue("uid")));
    expect((await anonymous.cookies()).some(c => c.name === "triply.sid")).toBe(false);
    await expect(visitor.getByRole("alert")).toContainText("events exported");
    await page.getByRole("button", { name: "Disable sharing", exact: true }).click(); await page.getByRole("button", { name: "Confirm disable", exact: true }).click(); await expect(page.getByText("Sharing disabled", { exact: true })).toBeVisible();
    await visitor.getByRole("button", { name: "Export to Calendar", exact: true }).click(); await expect(visitor.getByText("This trip or sharing link is unavailable.")).toBeVisible();
    await visitor.reload(); await expect(visitor.getByRole("alert")).toContainText("unavailable"); await expect(visitor.getByRole("button", { name: "Export to Calendar" })).toHaveCount(0);
  } finally { await anonymous.close(); }
});
