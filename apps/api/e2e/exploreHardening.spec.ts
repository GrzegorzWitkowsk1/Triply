import { test, expect } from "./fixtures.ts";

test("real API recovery, broken image, failed Saved status and failed Save recover without corrupting data", async ({ page, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/home$/);
  await harness.command("/broken-destination-image");
  await harness.command("/fault", { target: "catalog", enabled: true });
  await harness.command("/fault", { target: "status", enabled: true });
  await page.goto("/explore?q=barce");
  await expect(page.getByText("Could not load destinations. Please try again.")).toBeVisible();
  await harness.command("/fault", { target: "catalog", enabled: false });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  const card = page.locator('[data-destination-id="city-003"]');
  await expect(card).toContainText("Barcelona");
  await expect(card.getByRole("img", { name: "Barcelona: image unavailable" })).toBeVisible();
  await expect(page.getByText("Could not load Saved status. Your collection has not changed.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Save Barcelona" })).toBeDisabled();
  await harness.command("/fault", { target: "status", enabled: false });
  await page.getByRole("button", { name: "Retry Saved status" }).click();
  await expect(card.getByRole("button", { name: "Save Barcelona" })).toBeEnabled();
  await harness.command("/fault", { target: "save", enabled: true });
  await card.getByRole("button", { name: "Save Barcelona" }).click();
  await expect(card.getByRole("alert")).toHaveText("Could not update Saved for Barcelona. Please try again.");
  await expect(card.getByRole("button", { name: "Save Barcelona" })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(async () => (await (await fetch("/api/saved/destinations")).json()).destinations)).toEqual([]);
  await harness.command("/fault", { target: "save", enabled: false });
  await card.getByRole("button", { name: "Save Barcelona" }).click();
  await expect(card.getByRole("button", { name: "Unsave Barcelona" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("alert")).toHaveCount(0);
  await page.goto("/saved"); await expect(page.getByRole("article", { name: "Destination: Barcelona" })).toBeVisible();
  await page.getByRole("button", { name: "Unsave Barcelona" }).click();
  await page.goto("/explore?q=barce"); await expect(card.getByRole("button", { name: "Save Barcelona" })).toBeEnabled();
  expect((await harness.state()).calls).toEqual([]);
});

test("guest contexts, account login and logout never share private Saved state", async ({ page, browser, harness, user }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/home$/);
  await page.goto("/explore?q=barce"); await page.getByRole("button", { name: "Save Barcelona" }).click(); await expect(page.getByRole("button", { name: "Unsave Barcelona" })).toBeEnabled();
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto("http://127.0.0.1:5174/login"); await other.getByRole("button", { name: "Continue as guest" }).click(); await expect(other).toHaveURL(/\/home$/);
    await other.goto("http://127.0.0.1:5174/explore?q=barce"); await expect(other.getByRole("button", { name: "Save Barcelona" })).toHaveAttribute("aria-pressed", "false");
    await page.goto("/login");
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel(/^Password/).fill(user.password);
    await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("dialog", { name: "Save your guest data" }).getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("dialog", { name: "Save your guest data" })).toBeHidden();
    // Protected pages share a layout; public Explore mounts its own import prompt.
    await page.getByRole("link", { name: "Saved", exact: true }).first().click(); await expect(page.getByText("No saved places yet")).toBeVisible();
    await page.getByRole("link", { name: "Explore", exact: true }).first().click();
    await page.getByRole("dialog", { name: "Save your guest data" }).getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("dialog", { name: "Save your guest data" })).toBeHidden();
    await page.getByRole("searchbox", { name: "Search destinations" }).fill("rome");
    await expect(page).toHaveURL(/q=rome/);
    await page.getByRole("button", { name: "Save Rome" }).click(); await expect(page.getByRole("button", { name: "Unsave Rome" })).toBeEnabled();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Save Rome" })).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(async () => (await fetch("/api/saved/destinations")).status)).toBe(401);
    await other.goto("http://127.0.0.1:5174/saved"); await expect(other.getByText("No saved places yet")).toBeVisible();
    expect((await harness.state()).calls).toEqual([]);
  } finally { await context.close(); }
});

test("Rome discovery uses the existing generation flow and renders itinerary and map", async ({ page, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/home$/);
  await page.goto("/explore?q=rome&country=italy"); await page.getByRole("button", { name: "Plan a trip", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe your trip" })).toHaveValue("Plan a trip to Rome, Italy");
  expect((await harness.state()).calls).toEqual([]);
  await page.getByRole("button", { name: "Plan my trip", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.getByLabel("Where are you going?")).toHaveValue("Rome");
  await dialog.getByLabel("When does the trip start?").fill("2030-06-02"); await dialog.getByLabel("When does the trip end?").fill("2030-06-02");
  await dialog.getByLabel("How many people will travel?").fill("1");
  await dialog.getByRole("button", { name: "Flexible", exact: true }).click();
  await dialog.getByRole("button", { name: "Architecture", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Generate my trip", exact: true }).click(); await expect(page).toHaveURL(/\/trips\/[a-f0-9]{24}$/);
  await expect(page.locator(".leaflet-container")).toBeVisible(); await expect(page.getByRole("button", { name: /^Reorder / }).first()).toBeVisible();
  expect((await harness.trip(page.url().split("/").at(-1)!)).analysis).toMatchObject({ destinationId: "city-005", destination: "Rome", country: "Italy" });
});

test("measures bounded catalog requests and checks keyboard/reduced-motion layout at five widths", async ({ page, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/home$/);
  const requests: string[] = [];
  const completed: string[] = [];
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/destinations") || url.pathname === "/api/saved/destinations/status") requests.push(url.pathname + url.search); });
  page.on("requestfinished", request => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/destinations") || url.pathname === "/api/saved/destinations/status") completed.push(url.pathname + url.search); });
  const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/destinations");
  await page.goto("/explore"); await expect(page.locator("[data-destination-id]")).toHaveCount(24);
  const bytes = (await (await response).body()).length;
  await expect(page.locator("[data-destination-id]").first().getByRole("button", { name: /^Save / })).toBeEnabled();
  await expect.poll(() => completed.filter(path => path.startsWith("/api/destinations?")).length).toBe(1);
  expect(completed.filter(path => path === "/api/destinations/filters")).toHaveLength(1);
  expect(completed.filter(path => path === "/api/saved/destinations/status")).toHaveLength(1);
  const initialAttempts = requests.length;
  await expect(page.getByRole("heading", { name: "Explore destinations" })).toHaveCount(0);
  const pagination = page.getByRole("navigation", { name: "Destination pages" });
  const positioning = await pagination.evaluate(element => {
    const parent = element.getBoundingClientRect(); const list = element.querySelector("ul")!.getBoundingClientRect();
    return { margin: getComputedStyle(element).marginTop, offset: Math.abs((parent.left + parent.right - list.left - list.right) / 2) };
  });
  expect(positioning.margin).toBe("40px"); expect(positioning.offset).toBeLessThan(1);
  expect(await page.locator(".explore-results-count").evaluate(element => ({ weight: getComputedStyle(element).fontWeight, margin: getComputedStyle(element).marginBottom }))).toEqual({ weight: "700", margin: "32px" });
  const input = page.getByRole("searchbox", { name: "Search destinations" });
  await input.fill("b"); await input.fill("bar"); await input.fill("barce");
  await expect(page).toHaveURL(/q=barce/); await expect(page.locator("[data-destination-id]")).toHaveCount(1);
  await expect.poll(() => completed.filter(path => path.startsWith("/api/destinations?")).length).toBe(2);
  console.log(JSON.stringify({ exploreMeasurement: { initialListBytes: bytes, initialCompletedListRequests: 1, initialCompletedMetadataRequests: 1, initialCompletedSavedStatusRequests: 1, initialAttemptsIncludingStrictModeCancellations: initialAttempts, rapidEdits: 3, additionalCompletedSearchRequests: 1 } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(input).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), `horizontal overflow at ${width}`).toBeLessThanOrEqual(width);
    const heart = page.getByRole("button", { name: "Save Barcelona" }); const bounds = await heart.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    const durations = await page.locator(".trend-card").evaluate(card =>
      getComputedStyle(card).transitionDuration.split(",").map(value => Number.parseFloat(value)));
    expect(durations.every(seconds => seconds <= 0.00001), "reduced-motion transitions are at most 0.01ms").toBe(true);
  }
  await input.focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Clear search" })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(input).toBeFocused(); await expect(page).toHaveURL(/\/explore$/);
  expect((await harness.state()).calls).toEqual([]);
});
