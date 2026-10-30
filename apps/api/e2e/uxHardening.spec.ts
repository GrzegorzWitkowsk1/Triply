import type { Locator, Page } from "@playwright/test";
import { test, expect, login, openTrip } from "./fixtures.ts";

test.use({ scenario: "editing", locale: "en-US" });
async function keyboardTo(page: Page, target: Locator) {
  for (let index = 0; index < 80; index++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test("keyboard authentication validation focuses fields and a failed sign-in retains input", async ({ page, user }) => {
  let attempts = 0;
  await page.route("**/api/auth/login", async route => { attempts++; if (attempts === 1) await route.abort("failed"); else await route.continue(); });
  await page.goto("/login");
  const email = page.getByRole("textbox", { name: /Email address/ });
  const password = page.getByLabel(/^Password/);
  await keyboardTo(page, password); await page.keyboard.press("Enter");
  await expect(email).toBeFocused(); await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAccessibleDescription(/Enter a valid email and password/); expect(attempts).toBe(0);
  await page.keyboard.type(user.email); await keyboardTo(page, password); await page.keyboard.type(user.password);
  await page.keyboard.press("Enter"); await expect(page.getByRole("alert")).toBeVisible();
  await expect(email).toHaveValue(user.email); await expect(password).toHaveValue(user.password);
  await page.keyboard.press("Enter"); await expect(page).toHaveURL(/\/home$/);
  expect(attempts).toBe(2); await expect(page.locator("main")).toBeFocused();
});

test("skip link, creator validation and dialog focus work using the keyboard", async ({ page, user }) => {
  await login(page, user); await page.goto("/home");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await keyboardTo(page, skip); await page.keyboard.press("Enter"); await expect(page.locator("main")).toBeFocused();
  const prompt = page.getByRole("textbox", { name: "Describe your trip" });
  await keyboardTo(page, prompt); await page.keyboard.type("Barcelona, Spain: three days.");
  const plan = page.getByRole("button", { name: "Plan my trip", exact: true });
  await keyboardTo(page, plan); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await dialog.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  const destination = dialog.getByLabel("Where are you going?");
  await expect(destination).toBeFocused(); await expect(destination).toHaveAttribute("aria-invalid", "true");
  await expect(destination).toHaveAccessibleDescription(/Tell us where/);
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Fill in details", exact: true })).toBeFocused();
});

test("day tabs, edit dialogs and deletion keep keyboard focus on useful controls", async ({ page, user }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  const first = page.getByRole("tab").first(); await keyboardTo(page, first);
  await page.keyboard.press("ArrowRight"); await expect(page.getByRole("tab").nth(1)).toBeFocused();
  await page.keyboard.press("Home"); await expect(first).toBeFocused();
  const add = page.getByRole("button", { name: "Add Attraction", exact: true });
  await keyboardTo(page, add); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape"); await expect(add).toBeFocused();
  const edit = page.getByRole("button", { name: "Edit Barcelona Cathedral", exact: true });
  await keyboardTo(page, edit); await page.keyboard.press("Enter");
  const remove = page.getByRole("menuitem", { name: "Remove attraction", exact: true });
  for (let index = 0; index < 6; index++) {
    if (await remove.evaluate(element => element === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(remove).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page.locator('.activity-card[data-place-id="node/1000"]')).toHaveCount(0);
  await expect(page.locator('.activity-card[data-place-id="node/1001"]')).toBeFocused();
});

test("rapid expense submission accepts one mutation and a failed retry retains the draft", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  let attempts = 0;
  await page.route("**/expenses", async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++; if (attempts === 1) return route.abort("failed");
    await route.continue();
  });
  await page.getByLabel("Expense name", { exact: true }).fill("Keyboard taxi"); await page.getByLabel("Amount", { exact: true }).fill("12.29");
  await page.locator(".budget-expense-form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.locator(".budget-card").getByRole("alert")).toBeVisible(); expect(attempts).toBe(1);
  await expect(page.getByLabel("Expense name", { exact: true })).toHaveValue("Keyboard taxi");
  await page.locator(".budget-expense-form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.locator(".budget-expense-title", { hasText: "Keyboard taxi" })).toHaveCount(1); expect(attempts).toBe(2);
  expect((await harness.trip(user.tripId!)).expenses.filter(expense => expense.title === "Keyboard taxi")).toHaveLength(1);
});

test("rapid day preview and commit use one request each", async ({ page, user }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  let generated = 0, applied = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/days/1/regenerate")) generated++; if (request.method() === "POST" && request.url().endsWith("/days/1/apply")) applied++; });
  await page.getByRole("button", { name: "Regenerate Day", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByRole("textbox").fill("Less walking");
  await dialog.getByRole("button", { name: "Generate alternative" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(dialog.getByText("Here's the new day")).toBeVisible(); expect(generated).toBe(1);
  await dialog.getByRole("button", { name: "Apply changes", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(dialog).toBeHidden(); expect(applied).toBe(1);
});

test("an older budget read cannot erase an expense confirmed while it was pending", async ({ page, user }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  await expect(page.locator(".budget-expense-form")).toBeVisible();
  let release!: () => void;
  let started = false, finished = false;
  await page.route("**/budget", async route => {
    if (route.request().method() !== "GET" || started) return route.continue();
    const response = await route.fetch(); const body = await response.body();
    started = true; await new Promise<void>(resolve => { release = resolve; });
    // The application cancels this obsolete request; browsers may reject its fulfillment.
    try { await route.fulfill({ response, body }); } catch { /* Cancellation is expected. */ }
    finished = true;
  });
  await page.reload(); await expect.poll(() => started).toBe(true);
  await page.getByLabel("Expense name", { exact: true }).fill("Confirmed during read");
  await page.getByLabel("Amount", { exact: true }).fill("7.50");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect(page.locator(".budget-expense-title", { hasText: "Confirmed during read" })).toHaveCount(1);
  release(); await expect.poll(() => finished).toBe(true);
  await expect(page.locator(".budget-expense-title", { hasText: "Confirmed during read" })).toHaveCount(1);
});

test.describe("mobile focus and keyboard height", () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  test("Assistant contains focus, preserves a failed draft and restores its trigger", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    const calls = (await harness.state()).calls;
    const trigger = page.getByRole("button", { name: "Ask Triply", exact: true }); await trigger.tap();
    const panel = page.getByRole("dialog", { name: "Ask Triply about Barcelona" }); await expect(panel).toBeVisible();
    for (let index = 0; index < 14; index++) { await page.keyboard.press("Tab"); expect(await panel.evaluate(element => element.contains(document.activeElement))).toBe(true); }
    expect((await harness.state()).calls).toEqual(calls);
    await page.route("**/assistant/messages", route => route.abort("failed"));
    await panel.getByRole("textbox", { name: "Message Triply" }).fill("Keep my question");
    await page.setViewportSize({ width: 360, height: 360 }); await page.keyboard.press("Enter");
    await expect(panel.getByRole("alert")).toBeVisible(); await expect(panel.getByRole("textbox")).toHaveValue("Keep my question");
    await page.keyboard.press("Escape"); await expect(panel).toBeHidden(); await expect(trigger).toBeFocused();
    await trigger.tap(); await expect(page.getByRole("textbox", { name: "Message Triply" })).toHaveValue("Keep my question");
  });
});
