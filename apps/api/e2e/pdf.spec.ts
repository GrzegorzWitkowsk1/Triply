import { readFile } from "node:fs/promises";
import { test, expect, login, openTrip, openExportMenu } from "./fixtures.ts";

test.use({ scenario: "editing" });
test("owner and anonymous visitor download valid PDFs; revocation prevents further export", async ({ page, user, browser, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  // Finish existing owner-page weather backfill before snapshotting the export.
  await expect(page.getByRole("button", { name: /More export options|Więcej opcji eksportu/ })).toBeVisible();
  const before = await harness.trip(user.tripId!);
  await openExportMenu(page);
  const ownerDownload = page.waitForEvent("download"); await page.getByRole("menuitem", { name: "Download PDF", exact: true }).click();
  const ownerFile = await ownerDownload; expect(ownerFile.suggestedFilename()).toMatch(/^triply-barcelona-.*\.pdf$/);
  const ownerBytes = await readFile((await ownerFile.path())!); expect(ownerBytes.subarray(0, 5).toString()).toBe("%PDF-"); expect(ownerBytes.length).toBeGreaterThan(1000);
  const after = await harness.trip(user.tripId!); expect(after.itinerary).toEqual(before.itinerary); expect(after.itineraryVersion).toBe(before.itineraryVersion);
  await openExportMenu(page); await page.getByRole("menuitem", { name: "Share", exact: true }).click(); await page.getByRole("button", { name: "Enable sharing", exact: true }).click();
  const link = await page.getByLabel("Share link").inputValue();
  const anonymous = await browser.newContext(), visitor = await anonymous.newPage();
  try {
    await visitor.goto(link); await expect(visitor.getByRole("heading", { level: 1 })).toContainText("Barcelona");
    const download = visitor.waitForEvent("download"); await visitor.getByRole("button", { name: "Download PDF", exact: true }).click();
    const file = await download; expect(file.suggestedFilename()).toMatch(/\.pdf$/); expect((await readFile((await file.path())!)).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await anonymous.cookies()).some(c => c.name === "triply.sid")).toBe(false);
    await page.getByRole("button", { name: "Disable sharing", exact: true }).click(); await page.getByRole("button", { name: "Confirm disable", exact: true }).click();
    await expect(page.getByText("Sharing disabled", { exact: true })).toBeVisible();
    // A visitor with stale displayed data must still fail at the server.
    await visitor.getByRole("button", { name: "Download PDF", exact: true }).click(); await expect(visitor.getByRole("alert")).toContainText("Shared trip not found");
    await visitor.reload(); await expect(visitor.getByRole("alert")).toContainText("unavailable"); await expect(visitor.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  } finally { await anonymous.close(); }
});
