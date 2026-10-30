import type { Page } from "@playwright/test";
import type { RegenerateDayPreview } from "@triply/shared";
import { test, expect, login, openTrip } from "./fixtures.ts";

test.use({ scenario: "editing", locale: "en-US" });
const card = (page: Page, id: string) => page.locator(`.activity-card[data-place-id="${id}"]`);
const marker = (page: Page, id: string) => page.locator(`.trip-marker[data-place-id="${id}"]`);
async function preview(page: Page) {
  await page.getByRole("button", { name: "Regenerate Day", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("A relaxed day with less walking");
  const response = page.waitForResponse(r => r.url().endsWith("/days/1/regenerate"));
  await dialog.getByRole("button", { name: "Generate alternative" }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  await expect(dialog.getByText("Here's the new day")).toBeVisible();
  return result.json() as Promise<RegenerateDayPreview>;
}

test("overview, keyboard day navigation, reload and EN/PL layouts", async ({ page, user, harness }, info) => {
  await login(page, user); await openTrip(page, user.tripId!);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Barcelona");
  await expect(page.getByRole("link", { name: "View expenses" })).toBeVisible();
  await page.getByRole("tab").first().focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/day=2/);
  await expect(page.locator(".trip-marker")).toHaveCount(2);
  await expect(page.locator(".activity-name").first()).toHaveText("Roman Walls");
  await page.reload(); await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  const before = await harness.trip(user.tripId!); const calls = (await harness.state()).calls;
  for (const language of ["en", "pl"]) {
    if (language === "pl") {
      await page.getByRole("button", { name: /^Language:/ }).click();
      await page.getByRole("menuitemradio", { name: "Polski", exact: true }).click();
    }
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 375 || width === 1440) await page.screenshot({ path: info.outputPath(`trip-experience-${language}-${width}.png`), fullPage: true, animations: "disabled", mask: [page.locator(".user-email")] });
    }
  }
  await expect(page.locator(".activity-name").first()).toHaveText("Roman Walls");
  expect((await harness.trip(user.tripId!)).itinerary).toEqual(before.itinerary);
  expect((await harness.state()).calls).toEqual(calls);
});

test("timeline and keyboard map selection stay synchronized after deletion", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  await card(page, "node/1001").click();
  await expect(marker(page, "node/1001")).toHaveAttribute("aria-pressed", "true");
  await marker(page, "node/1000").focus(); await page.keyboard.press("Space");
  await expect(card(page, "node/1000")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Edit Barcelona Cathedral", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove attraction", exact: true }).click();
  await expect(card(page, "node/1000")).toHaveCount(0);
  await expect(marker(page, "node/1000")).toHaveCount(0);
  await expect(page.locator('.activity-card[aria-pressed="true"]')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  const calls = (await harness.state()).calls;
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await expect(page.locator(".assistant-panel")).toBeVisible();
  await card(page, "node/1001").click();
  await expect(card(page, "node/1001")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  expect((await harness.state()).calls).toEqual(calls);
});

test("manual add and move recover from a rejected change without losing confirmed data", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  await page.getByRole("button", { name: "Add Attraction", exact: true }).click();
  const picker = page.getByRole("dialog");
  await picker.getByLabel("Search attractions").fill("La Boqueria");
  await picker.getByRole("button", { name: /La Boqueria/ }).click();
  await picker.getByRole("button", { name: "Add attraction", exact: true }).click();
  await expect(picker).toBeHidden(); await expect(card(page, "node/1003")).toBeVisible();
  const confirmed = await harness.trip(user.tripId!);
  await page.route("**/itinerary/edit", route => route.fulfill({ status: 409, json: { error: "Rejected fixture move", code: "SCHEDULING_CONFLICT" } }));
  await page.getByRole("button", { name: "Edit La Boqueria", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to another day" }).click();
  const move = page.getByRole("dialog");
  await move.getByLabel("Destination day").click(); await page.getByRole("option", { name: /Day 3/ }).click();
  await move.getByRole("button", { name: "Move attraction", exact: true }).click();
  await expect(move.getByRole("alert")).toBeVisible();
  expect((await harness.trip(user.tripId!)).itinerary).toEqual(confirmed.itinerary);
  await page.unroute("**/itinerary/edit");
  await move.getByRole("button", { name: "Move attraction", exact: true }).click();
  await expect(move).toBeHidden(); await expect(card(page, "node/1003")).toHaveCount(0);
  await page.getByRole("tab").nth(2).click();
  await expect(card(page, "node/1003")).toBeVisible();
  await expect(marker(page, "node/1003")).toBeVisible();
});

test("AI day previews can be discarded then committed without changing other days", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  const before = await harness.trip(user.tripId!);
  const firstPreview = await preview(page);
  for (const stop of firstPreview.comparison.added) await expect(page.locator(".regenerate-diff-item.is-added").filter({ hasText: stop.name })).toBeVisible();
  for (const stop of firstPreview.comparison.removed) await expect(page.locator(".regenerate-diff-item.is-removed").filter({ hasText: stop.name })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await harness.trip(user.tripId!)).itinerary).toEqual(before.itinerary);
  const proposed = await preview(page);
  await page.getByRole("dialog").getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const after = await harness.trip(user.tripId!);
  expect(after.itinerary!.days[0]).toMatchObject({ ...proposed.day });
  expect(after.itinerary!.days.slice(1)).toEqual(before.itinerary!.days.slice(1));
});

test("a stale day preview cannot overwrite a separately confirmed edit", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  await preview(page);
  const status = await page.evaluate(async id => {
    const response = await fetch(`/api/trips/${id}/itinerary/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: 3, operation: { type: "remove", dayIndex: 1, attractionId: "node/1004" } }) });
    return response.status;
  }, user.tripId!);
  expect(status).toBe(200);
  const confirmed = await harness.trip(user.tripId!);
  await page.getByRole("dialog").getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/This preview is out of date/)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Apply changes", exact: true })).toBeDisabled();
  expect((await harness.trip(user.tripId!)).itinerary).toEqual(confirmed.itinerary);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
});
