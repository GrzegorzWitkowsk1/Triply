import type { Page } from "@playwright/test";
import { test, expect, login, openExploreDestination } from "./fixtures.ts";

async function verifyCollection(page: Page, destination: string, attraction: string) {
  await page.goto("/saved");
  await expect(page.getByRole("button", { name: "All (2)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article", { name: `Destination: ${destination}`, exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: `Attraction: ${attraction}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Destinations (1)", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: `Destination: ${destination}`, exact: true })).toBeVisible();
  const category = page.getByRole("button", { name: "Attractions (1)", exact: true });
  await category.focus(); await page.keyboard.press("Space");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: `Attraction: ${attraction}`, exact: true })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search saved places" });
  await search.fill(attraction.toUpperCase());
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Clear search", exact: true })).toHaveCount(1);
  await expect(search).toHaveAttribute("type", "text");
  await search.fill("no such saved place");
  await expect(page.getByText("No places match your search", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear search", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toBeFocused();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Sort saved places" }).click();
  await page.getByRole("option", { name: "Name A–Z", exact: true }).click();
  await expect(page).toHaveURL(/type=attractions.*sort=name-asc/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Attractions (1)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Sort saved places" })).toHaveText("Name A–Z");
  await expect(page.getByRole("article", { name: `Attraction: ${attraction}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View details", exact: true }).click();
  await expect(page.getByRole("dialog", { name: attraction, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View on OpenStreetMap" })).toHaveAttribute("href", /^https:\/\/www.openstreetmap.org\//);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Destinations (1)", exact: true }).click();
  await page.getByRole("button", { name: `Unsave ${destination}`, exact: true }).click();
  await expect(page.getByRole("button", { name: "All (1)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Destinations (0)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("No saved destinations yet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Attractions (1)", exact: true }).click();
  await page.getByRole("button", { name: `Unsave attraction ${attraction}`, exact: true }).click();
  await expect(page.getByRole("button", { name: "All (0)", exact: true })).toBeVisible();
  await expect(page.getByText("No saved attractions yet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All (0)", exact: true }).click();
  await expect(page.getByText("No saved places yet", { exact: true })).toBeVisible();
}

test("guest mixed collection supports filtering, search, sorting, reload and removal", async ({ page, harness }, testInfo) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/explore"); await page.getByRole("button", { name: "Save Barcelona", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave Barcelona", exact: true })).toBeEnabled();
  const session = await page.evaluate(async () => (await fetch("/api/auth/session?identity=1")).json());
  const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId: session.guest.id });
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: "Save attraction Barcelona Cathedral", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave attraction Barcelona Cathedral", exact: true })).toBeEnabled();
  await page.goto("/saved"); await expect(page.getByRole("article")).toHaveCount(2);
  for (const width of [320, 390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("searchbox", { name: "Search saved places" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Sort saved places" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const box of await page.locator(".saved-card").all()) { const bounds = await box.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width); }
    if (width === 320) {
      await page.getByRole("button", { name: "View details", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: "Unsave attraction Barcelona Cathedral", exact: true })).toBeVisible();
      const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    }
    if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`saved-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await verifyCollection(page, "Barcelona", "Barcelona Cathedral");
});

test.describe("authenticated mixed collection", () => {
  test.use({ scenario: "future" });
  test("supports the same Saved controls and actions for an account", async ({ page, user }) => {
    await login(page, user); const card = await openExploreDestination(page, "city-005");
    await card.getByRole("button", { name: "Save Rome", exact: true }).click();
    await expect(card.getByRole("button", { name: "Unsave Rome", exact: true })).toBeEnabled();
    await page.goto(`/trips/${user.tripId}`); await page.getByRole("button", { name: "Save attraction Colosseum", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unsave attraction Colosseum", exact: true })).toBeEnabled();
    await verifyCollection(page, "Rome", "Colosseum");
  });
});
