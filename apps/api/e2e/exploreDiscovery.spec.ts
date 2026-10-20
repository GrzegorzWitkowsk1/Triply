import { test, expect } from "./fixtures.ts";

test("search, filters, sorting, browser history and guest Saved use real catalog data", async ({ page, harness }) => {
  await page.goto("/explore");
  await expect(page.getByRole("status")).toContainText("212 destinations found");
  const search = page.getByRole("searchbox", { name: "Search destinations" });
  await search.fill("barce");
  await expect(page).toHaveURL(/q=barce/); await expect(page.locator("[data-destination-id]")).toHaveCount(1);
  await expect(page.locator("[data-destination-id]")).toContainText("Barcelona");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator("[data-destination-id]")).toHaveCount(24);
  await page.getByRole("combobox", { name: "Country", exact: true }).click();
  await page.getByRole("option", { name: "Spain", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("10 destinations found");
  await expect(page.locator("[data-destination-id]")).toHaveCount(10);
  expect(await page.locator("[data-destination-id] .trend-locale").allTextContents()).toEqual(Array(10).fill("Spain"));
  await page.getByRole("combobox", { name: "Sort destinations" }).click(); await page.getByRole("option", { name: "Name Z–A", exact: true }).click();
  await expect(page).toHaveURL(/country=spain&sort=name-desc/);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Country", exact: true })).toContainText("Spain");
  await expect(page.getByRole("combobox", { name: "Sort destinations" })).toContainText("Name Z–A");
  await page.goBack();
  await expect(page).toHaveURL(/country=spain$/);
  await expect(page.getByRole("combobox", { name: "Sort destinations" })).toContainText("Name A–Z");
  await page.goForward(); await expect(page).toHaveURL(/sort=name-desc/);
  const filteredURL = page.url();
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/home$/);
  await page.goto(filteredURL);
  const barcelona = page.locator('[data-destination-id="city-003"]');
  await barcelona.getByRole("button", { name: "Save Barcelona", exact: true }).click();
  await expect(barcelona.getByRole("button", { name: "Unsave Barcelona", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(filteredURL);
  await page.goto("/saved"); await expect(page.getByRole("article", { name: "Destination: Barcelona" })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(filteredURL);
  await expect(barcelona.getByRole("button", { name: "Unsave Barcelona", exact: true })).toBeEnabled();
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(search).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `overflow at ${width}px`).toBe(true);
    expect(await search.boundingBox()).toMatchObject({ width: expect.any(Number) });
  }
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page).toHaveURL(/\/explore$/); await expect(page.getByRole("status")).toContainText("212 destinations found");
  await page.getByRole("combobox", { name: "Sort destinations" }).click(); await page.getByRole("option", { name: "Country A–Z", exact: true }).click();
  await page.getByRole("button", { name: "Go to page 2" }).click(); await expect(page).toHaveURL(/sort=country-asc&page=2/);
  await page.reload(); await expect(page).toHaveURL(/sort=country-asc&page=2/);
  await expect(page.getByRole("button", { name: "page 2", exact: true })).toHaveAttribute("aria-current", "page");
  expect((await harness.state()).calls).toEqual([]);
});
