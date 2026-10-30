import type { Page } from "@playwright/test";
import { test, expect, login, openTrip } from "./fixtures.ts";

test.use({ scenario: "editing", locale: "en-US" });
const devices = [
  { name: "iPhone-sized", viewport: { width: 390, height: 844 } },
  { name: "small Android", viewport: { width: 360, height: 740 } },
  { name: "tablet", viewport: { width: 768, height: 1024 } },
];
const card = (page: Page, id: string) => page.locator(`.activity-card[data-place-id="${id}"]`);
const marker = (page: Page, id: string) => page.locator(`.trip-marker[data-place-id="${id}"]`);
async function noOverflow(page: Page) { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.viewportSize())!.width); }
async function headerFits(page: Page) {
  const clipped = await page.locator(".app-header").evaluate(header => {
    const bounds = header.getBoundingClientRect();
    return [...header.querySelectorAll(".header-actions a, .header-actions button")].filter(element => element.getClientRects().length > 0).flatMap(element => {
      const rect = element.getBoundingClientRect();
      return rect.top < bounds.top || rect.bottom > bounds.bottom || rect.right > window.innerWidth ? [element.getAttribute("aria-label") ?? element.textContent] : [];
    });
  });
  expect(clipped, `clipped header controls at ${page.viewportSize()!.width}px`).toEqual([]);
}
async function setLanguage(page: Page, language: "en" | "pl") {
  if (await page.locator("html").getAttribute("lang") === language) return;
  await page.getByRole("button", { name: /^(Language|Język):/ }).first().click();
  await page.getByRole("menuitemradio", { name: language === "pl" ? "Polski" : "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}

for (const device of devices) test.describe(device.name, () => {
  test.use({ viewport: device.viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

  test("primary navigation, discovery filters, saved places and Polish labels", async ({ page, user, harness }) => {
    await login(page, user);
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav.getByRole("link")).toHaveCount(4);
    for (const route of [{ label: "Explore", path: "/explore" }, { label: "Saved", path: "/saved" }, { label: "trips", path: "/trips" }, { label: "Home", path: "/home" }]) {
      await nav.getByRole("link", { name: route.label, exact: true }).tap();
      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(nav.getByRole("link", { name: route.label, exact: true })).toHaveAttribute("aria-current", "page"); await noOverflow(page);
    }
    await page.goto("/explore"); await page.getByRole("searchbox").fill("Barcelona");
    if (device.viewport.width < 768) {
      await expect(page.getByRole("combobox", { name: "Country", exact: true })).toBeHidden();
      await page.getByRole("button", { name: "Filters and sorting" }).tap();
      await expect(page.getByRole("combobox", { name: "Country", exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Save Barcelona", exact: true }).tap();
    await page.goto("/saved"); await expect(page.getByRole("article", { name: "Destination: Barcelona" })).toBeVisible();
    const calls = (await harness.state()).calls;
    await setLanguage(page, "pl"); await noOverflow(page);
    await page.getByRole("navigation", { name: "Nawigacja główna" }).getByRole("link", { name: "Start", exact: true }).tap();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); await noOverflow(page);
    await setLanguage(page, "en"); expect((await harness.state()).calls).toEqual(calls);
  });

  test("Plan/Map preserves day, selection, map instance and pending expense draft", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    await expect(page.locator(".trip-map")).toBeHidden();
    await page.getByRole("textbox", { name: "Expense name", exact: true }).fill("Keep this draft");
    await card(page, "node/1001").tap();
    const map = await page.locator(".trip-map").elementHandle();
    const calls = (await harness.state()).calls;
    let tripReads = 0;
    page.on("request", request => { if (request.method() === "GET" && request.url().endsWith(`/api/trips/${user.tripId}`)) tripReads++; });
    await page.getByRole("button", { name: "Map", exact: true }).tap();
    await expect(marker(page, "node/1001")).toHaveAttribute("aria-pressed", "true");
    await marker(page, "node/1000").tap();
    await page.getByRole("button", { name: "Plan", exact: true }).tap();
    await expect(card(page, "node/1000")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: "Expense name", exact: true })).toHaveValue("Keep this draft");
    await page.getByRole("button", { name: "Map", exact: true }).tap();
    await page.getByRole("tab").nth(1).tap();
    await expect(page.locator(".trip-marker")).toHaveCount(2);
    await page.getByRole("button", { name: "Plan", exact: true }).tap();
    await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
    expect(await map!.evaluate(element => element === document.querySelector(".trip-map"))).toBe(true);
    expect(tripReads).toBe(0); expect((await harness.state()).calls).toEqual(calls); await noOverflow(page);
  });

  test("touch add, tap reorder, rejection rollback and confirmed removal", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    await page.getByRole("button", { name: "Add Attraction", exact: true }).tap();
    const picker = page.getByRole("dialog");
    await picker.getByLabel("Search attractions").fill("La Boqueria");
    await picker.getByRole("button", { name: /La Boqueria/ }).tap();
    await picker.getByRole("button", { name: "Add attraction", exact: true }).tap();
    await expect(picker).toBeHidden(); await expect(card(page, "node/1003")).toBeVisible();
    await page.getByRole("button", { name: "Edit Barcelona Cathedral", exact: true }).tap();
    await page.getByRole("menuitem", { name: "Move later", exact: true }).tap();
    await expect(page.locator(".activity-name").first()).toHaveText("Palau de la Musica");
    const confirmed = await harness.trip(user.tripId!);
    await page.route("**/itinerary/edit", route => route.fulfill({ status: 422, json: { error: "Rejected fixture reorder" } }));
    await page.getByRole("button", { name: "Edit Barcelona Cathedral", exact: true }).tap();
    await page.getByRole("menuitem", { name: "Move earlier", exact: true }).tap();
    await expect(page.getByRole("alert").filter({ hasText: "Check the entered values" })).toBeVisible();
    expect((await harness.trip(user.tripId!)).itinerary).toEqual(confirmed.itinerary);
    await expect(page.locator(".activity-name").first()).toHaveText("Palau de la Musica");
    await page.unroute("**/itinerary/edit");
    await page.getByRole("button", { name: "Edit La Boqueria", exact: true }).tap();
    await page.getByRole("menuitem", { name: "Remove attraction", exact: true }).tap();
    await expect(page.getByRole("dialog")).toContainText("Remove La Boqueria");
    await page.getByRole("dialog").getByRole("button", { name: "Remove attraction", exact: true }).tap();
    await expect(card(page, "node/1003")).toHaveCount(0);
    await page.getByRole("button", { name: "Map", exact: true }).tap();
    await expect(marker(page, "node/1003")).toHaveCount(0); await noOverflow(page);
  });

  test("short-screen regeneration preview can be discarded and committed safely", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    const before = await harness.trip(user.tripId!);
    async function generate() {
      await page.getByRole("button", { name: "Regenerate Day", exact: true }).tap();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill("Less walking and a relaxed day");
      await page.setViewportSize({ width: device.viewport.width, height: 400 });
      const submit = dialog.getByRole("button", { name: "Generate alternative" });
      await expect(submit).toBeVisible();
      const bounds = await submit.boundingBox(); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(400);
      await submit.tap(); await expect(dialog.getByText("Here's the new day")).toBeVisible();
      return dialog;
    }
    let dialog = await generate(); await dialog.getByRole("button", { name: "Cancel", exact: true }).tap();
    expect((await harness.trip(user.tripId!)).itinerary).toEqual(before.itinerary);
    dialog = await generate(); await dialog.getByRole("button", { name: "Apply changes", exact: true }).tap();
    await expect(dialog).toBeHidden();
    const after = await harness.trip(user.tripId!);
    expect(after.itinerary!.days.slice(1)).toEqual(before.itinerary!.days.slice(1)); await noOverflow(page);
  });

  test("creator validation and back/edit retain entered values", async ({ page, user }) => {
    await login(page, user); await page.goto("/home");
    await page.getByRole("textbox", { name: "Describe your trip" }).fill("Barcelona, Spain: three days.");
    await page.getByRole("button", { name: "Plan my trip", exact: true }).tap();
    const dialog = page.getByRole("dialog");
    await dialog.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(dialog).toContainText("Tell us where you want to go");
    await dialog.getByLabel("Where are you going?").fill("Barcelona");
    await dialog.getByLabel("Which country is that in?").fill("Spain");
    await dialog.getByLabel("How many days do you have?").fill("3");
    await dialog.getByLabel("When does the trip start?").fill("2030-06-02");
    await dialog.getByLabel("How many people will travel?").fill("1");
    await dialog.getByRole("button", { name: "Flexible", exact: true }).tap();
    await dialog.getByRole("button", { name: "Food", exact: true }).tap();
    await dialog.getByRole("button", { name: "Continue", exact: true }).tap();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Adjust details", exact: true }).tap();
    await expect(dialog.getByLabel("Where are you going?")).toHaveValue("Barcelona");
    await expect(dialog.getByLabel("How many days do you have?")).toHaveValue("3");
    await dialog.getByRole("button", { name: "Close", exact: true }).tap(); await noOverflow(page);
  });

  test("packing, decimal expenses and keyboard-height chat remain usable", async ({ page, user, harness }) => {
    await login(page, user); await page.goto(`/trips/${user.tripId}/equipment`);
    await page.getByLabel("Item name", { exact: true }).fill("Sunscreen");
    await page.getByRole("button", { name: "Add item", exact: true }).tap();
    const checkbox = page.getByRole("checkbox", { name: "Sunscreen", exact: true });
    await checkbox.tap(); await expect(checkbox).toBeChecked(); await noOverflow(page);
    await page.getByRole("link", { name: "Back to trip", exact: true }).tap();
    await page.getByRole("link", { name: "View expenses", exact: true }).tap();
    await page.getByRole("textbox", { name: "Expense name", exact: true }).fill("Coffee");
    const amount = page.getByRole("textbox", { name: "Amount", exact: true });
    await expect(amount).toHaveAttribute("inputmode", "decimal"); await amount.fill("12.29");
    await page.getByRole("button", { name: "Add expense", exact: true }).tap();
    await expect(page.locator(".budget-expense-title").filter({ hasText: "Coffee" })).toBeVisible();
    expect((await harness.trip(user.tripId!)).expenses.find(expense => expense.title === "Coffee")?.amountMinor).toBe(1229);
    const calls = (await harness.state()).calls;
    await page.getByRole("button", { name: "Ask Triply", exact: true }).tap();
    const input = page.getByRole("textbox", { name: "Message Triply", exact: true });
    await input.fill("Keep this message draft");
    await page.setViewportSize({ width: device.viewport.width, height: 360 });
    await expect(input).toBeVisible();
    const send = await page.getByRole("button", { name: "Send message", exact: true }).boundingBox();
    expect(send!.y + send!.height).toBeLessThanOrEqual(360);
    await page.getByRole("button", { name: "Close assistant", exact: true }).tap();
    await page.getByRole("button", { name: "Ask Triply", exact: true }).tap();
    await expect(input).toHaveValue("Keep this message draft");
    expect((await harness.state()).calls).toEqual(calls); await noOverflow(page);
  });
});

test("all target widths and portrait/landscape preserve navigation without overflow", async ({ page, user }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 568 : 900 }); await noOverflow(page);
    await headerFits(page);
    if (width < 1024) { await page.getByRole("button", { name: "Map", exact: true }).click(); await expect(page.locator(".trip-map")).toBeVisible(); }
    else { await expect(page.locator(".trip-map")).toBeVisible(); await expect(page.locator(".trip-left")).toBeVisible(); }
  }
  await page.setViewportSize({ width: 740, height: 360 }); await noOverflow(page);
  await page.getByRole("button", { name: "Plan", exact: true }).click(); await expect(page.locator(".trip-left")).toBeVisible();
  await page.goto(`/trips/${user.tripId}/equipment`);
  await expect(page.locator(".equipment-page")).toBeVisible();
  for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 568 : 900 });
    await noOverflow(page); await headerFits(page);
  }
});

test.describe("native touch gestures", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("map drag and pinch retain markers and the mounted map", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    await page.getByRole("button", { name: "Map", exact: true }).tap();
    await page.locator(".trip-map").scrollIntoViewIfNeeded();
    const bounds = await page.locator(".trip-map").boundingBox();
    const x = Math.round(bounds!.x + bounds!.width / 2), y = Math.round(bounds!.y + bounds!.height / 2);
    const session = await page.context().newCDPSession(page);
    const calls = (await harness.state()).calls;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 35, y: y + 20, id: 0 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 25, y, id: 0 }, { x: x + 25, y, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 55, y, id: 0 }, { x: x + 55, y, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator(".trip-marker")).toHaveCount(4);
    await page.getByRole("button", { name: "Plan", exact: true }).tap();
    await expect(card(page, "node/1000")).toBeVisible();
    expect((await harness.state()).calls).toEqual(calls);
    await session.detach();
  });
  test("a long-press touch drag rejected by the server restores confirmed order", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    const before = await harness.trip(user.tripId!);
    const handle = page.getByRole("button", { name: "Reorder Barcelona Cathedral", exact: true });
    await handle.scrollIntoViewIfNeeded();
    const source = await handle.boundingBox();
    const target = await page.getByRole("button", { name: "Reorder Palau de la Musica", exact: true }).boundingBox();
    await page.route("**/itinerary/edit", route => route.fulfill({ status: 422, json: { error: "Rejected fixture drag" } }));
    const session = await page.context().newCDPSession(page);
    const x = Math.round(source!.x + source!.width / 2), y = Math.round(source!.y + source!.height / 2);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
    // The production touch sensor deliberately requires a 200ms hold.
    await page.waitForTimeout(250);
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 30, id: 0 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(target!.y + target!.height / 2), id: 0 }] });
    const response = page.waitForResponse(r => r.url().endsWith("/itinerary/edit"));
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect((await response).status()).toBe(422);
    await expect(page.locator(".activity-name").first()).toHaveText("Barcelona Cathedral");
    expect((await harness.trip(user.tripId!)).itinerary).toEqual(before.itinerary);
    await expect(page.locator(".timeline-item[data-dragging]")).toHaveCount(0);
    await session.detach();
  });
});
