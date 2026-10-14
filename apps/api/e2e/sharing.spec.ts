import { test, expect, login, openTrip, openExportMenu } from "./fixtures.ts";

test.use({ scenario: "editing" });
test("owner shares itinerary with anonymous visitor and revokes access", async ({ page, user, browser }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  // Fixture itinerary generation uses only the existing deterministic providers.
  const generate = page.getByRole("button", { name: "Generate my trip", exact: true });
  if (await generate.isVisible()) { await generate.click(); await expect(page.getByText(/Day 1 of/)).toBeVisible(); }
  await openExportMenu(page); await page.getByRole("menuitem", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Enable sharing", exact: true }).click();
  const link = await page.getByLabel("Share link").inputValue();
  const anonymous = await browser.newContext(); const visitor = await anonymous.newPage();
  const tileReferrers: (string | undefined)[] = [];
  // Verify real browser headers while keeping the test offline.
  await visitor.route("https://tile.openstreetmap.org/**", async route => {
    tileReferrers.push((await route.request().allHeaders()).referer);
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" />' });
  });
  try {
    await visitor.goto(link); await expect(visitor.getByRole("heading", { level: 1 })).toContainText("Barcelona");
    await expect(visitor.locator(".activity-name").first()).toBeVisible();
    await expect.poll(() => tileReferrers.length).toBeGreaterThan(0);
    expect(tileReferrers.every(referrer => referrer === `${new URL(link).origin}/`)).toBe(true);
    const viewportHeight = visitor.viewportSize()!.height;
    const sharedPage = visitor.locator(".shared-trip-page");
    expect((await sharedPage.boundingBox())!.y).toBe(0);
    expect((await sharedPage.boundingBox())!.height).toBeGreaterThanOrEqual(viewportHeight);
    await expect(visitor.getByRole("button", { name: /^Reorder / })).toHaveCount(0);
    await expect(visitor.getByRole("button", { name: /Regenerate|Add Attraction|Ask Triply/ })).toHaveCount(0);
    expect((await anonymous.cookies()).some(c => c.name === "triply.sid")).toBe(false);
    await page.getByRole("button", { name: "Disable sharing", exact: true }).click();
    await page.getByRole("button", { name: "Confirm disable", exact: true }).click();
    await expect(page.getByText("Sharing disabled", { exact: true })).toBeVisible();
    await visitor.reload(); await expect(visitor.getByRole("alert")).toContainText("unavailable");
    await expect(visitor.locator(".activity-name")).toHaveCount(0);
    expect((await sharedPage.boundingBox())!.height).toBeGreaterThanOrEqual(viewportHeight);
  } finally { await anonymous.close(); }
});
