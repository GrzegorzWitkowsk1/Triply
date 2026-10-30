import { test, expect } from "./fixtures.ts";

test("anonymous editorial collection links, focused chips, history and responsive keyboard navigation", async ({ page, harness }) => {
  await page.goto("/explore?q=barce&country=spain&sort=name-desc");
  const collection = page.getByRole("link", { name: /^Food-first weekends/ });
  await expect(collection).toBeVisible(); await collection.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/explore\/collections\/food-first-weekends$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Food-first weekends");
  await expect(page.getByText("Cities where every meal is the highlight — tapas bars, markets, and hidden trattorias.")).toBeVisible();
  await expect(page.locator("[data-destination-id]")).toHaveCount(2);
  await expect(page.getByRole("article", { name: "Destination: Barcelona" })).toContainText("Spain");
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `collection overflow at ${width}`).toBe(true);
    const heart = await page.getByRole("button", { name: "Save Barcelona" }).boundingBox(); expect(heart!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("article", { name: "Destination: Barcelona" }).getByRole("button", { name: "Plan a trip" })).toBeVisible();
  }
  await page.reload(); await expect(page.locator("[data-destination-id]")).toHaveCount(2);
  expect((await harness.state()).sessions).toBe(0); expect((await harness.state()).calls).toEqual([]);
  await page.goBack(); await expect(page).toHaveURL(/q=barce&country=spain&sort=name-desc/);
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Explore overflow at ${width}`).toBe(true);
  }
  await page.getByRole("link", { name: "Explore Barcelona in Food-first weekends" }).click();
  await expect(page.locator("#collection-city-003")).toBeFocused();
  await page.getByRole("link", { name: "Back to Explore" }).click(); await expect(page).toHaveURL(/q=barce&country=spain&sort=name-desc/);
});

test("collection suggestions survive Guest entry, remain editable and use the existing generation pipeline", async ({ page, harness }) => {
  await page.goto("/explore/collections/architecture-and-icons");
  await page.getByRole("article", { name: "Destination: Barcelona" }).getByRole("button", { name: "Plan a trip" }).click();
  await expect(page).toHaveURL(/\/login$/); expect((await harness.state()).sessions).toBe(0);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/destinationId=city-003&collection=architecture-and-icons/);
  await expect(page.getByRole("textbox", { name: "Describe your trip" })).toHaveValue("Plan a trip to Barcelona, Spain");
  await expect(page.getByRole("button", { name: "Architecture weekend" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Culture & museums" })).toHaveAttribute("aria-pressed", "true");
  expect((await harness.state()).calls).toEqual([]);
  expect(await page.evaluate(async () => (await (await fetch("/api/trips")).json()).length)).toBe(0);
  await page.getByRole("button", { name: "Plan my trip", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Where are you going?")).toHaveValue("Barcelona");
  await expect(dialog.getByRole("button", { name: "Architecture", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Culture", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Balanced", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Culture", exact: true }).click();
  await dialog.getByRole("button", { name: "Food", exact: true }).click();
  await dialog.getByRole("button", { name: "Relaxed", exact: true }).click();
  await dialog.getByLabel("When does the trip start?").fill("2030-06-02"); await dialog.getByLabel("When does the trip end?").fill("2030-06-02");
  await dialog.getByLabel("How many people will travel?").fill("1");
  await dialog.getByRole("button", { name: "€400–700", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(async () => (await (await fetch("/api/guest/usage")).json()).aiGenerationsRemaining)).toBe(2);
  await page.getByRole("button", { name: "Generate my trip", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9]{24}$/); await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reorder / }).first()).toBeVisible();
  expect((await harness.trip(page.url().split("/").at(-1)!)).analysis).toMatchObject({ destinationId: "city-003", destination: "Barcelona", country: "Spain", interests: ["architecture", "food"], pace: "relaxed", budget: { amount: 700 } });
});

test("guest collection saves synchronize with Saved, Explore and reloads", async ({ page, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/home$/);
  await page.goto("/explore/collections/culture-deep-dives");
  await page.getByRole("button", { name: "Save Rome" }).click(); await expect(page.getByRole("button", { name: "Unsave Rome" })).toBeEnabled();
  await page.goto("/saved"); await expect(page.getByRole("article", { name: "Destination: Rome" })).toBeVisible();
  await page.goBack(); await page.reload(); await expect(page.getByRole("button", { name: "Unsave Rome" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Unsave Rome" }).click(); await expect(page.getByRole("button", { name: "Save Rome" })).toBeEnabled();
  await page.goto("/explore?q=rome"); await expect(page.getByRole("button", { name: "Save Rome" })).toHaveAttribute("aria-pressed", "false");
  await page.goto("/saved"); await expect(page.getByText("No saved places yet")).toBeVisible(); expect((await harness.state()).calls).toEqual([]);
});

test("guest collection destination migrates to an account once using existing import", async ({ page, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/home$/);
  await page.goto("/explore/collections/food-first-weekends"); await page.getByRole("button", { name: "Save Barcelona" }).click();
  await expect(page.getByRole("button", { name: "Unsave Barcelona" })).toBeEnabled();
  await page.goto("/register"); await page.getByLabel("Email address").fill("collection-import@example.test"); await page.getByLabel(/^Password/).fill("Password123!Aa");
  await page.locator("form").getByRole("button", { name: "Create account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save your guest data" }); await expect(dialog).toContainText("1 destination");
  await dialog.getByRole("button", { name: "Import to my account" }).click(); await expect(dialog).toBeHidden();
  await page.goto("/saved"); await expect(page.getByRole("article", { name: "Destination: Barcelona" })).toBeVisible();
  const saved = await page.evaluate(async () => (await (await fetch("/api/saved/destinations")).json()).destinations);
  expect(saved).toHaveLength(1); expect(saved[0].destinationId).toBe("city-003");
  await page.goto("/explore/collections/food-first-weekends"); await expect(page.getByRole("button", { name: "Unsave Barcelona" })).toHaveAttribute("aria-pressed", "true");
  expect((await harness.state()).calls).toEqual([]);
});

test("unknown collections and missing catalog destinations never substitute unrelated cities", async ({ page, harness }) => {
  await page.goto("/explore/collections/unknown"); await expect(page.getByRole("heading", { name: "Collection not found" })).toBeVisible();
  expect((await harness.state()).sessions).toBe(0); await page.getByRole("link", { name: "Back to Explore" }).click();
  await harness.command("/remove-collection-destination");
  await page.getByRole("link", { name: /^Food-first weekends/ }).click();
  await expect(page.locator("[data-destination-id]")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Destination: Bologna" })).toContainText("Italy");
  await expect(page.getByRole("article", { name: "Destination: Barcelona" })).toHaveCount(0); expect((await harness.state()).calls).toEqual([]);
});
