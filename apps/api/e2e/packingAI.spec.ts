import type { Page } from "@playwright/test";
import { test, expect, login } from "./fixtures.ts";
test.use({ scenario: "editing" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Packing suggestions" });
async function add(page: Page, name: string) {
  const form = page.getByRole("form", { name: "Add packing item" });
  await form.getByLabel("Item name").fill(name); await form.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("checkbox", { name, exact: true })).toBeVisible(); await expect(form.getByLabel("Item name")).toHaveValue("");
}
async function generate(page: Page) {
  await page.getByRole("button", { name: /Generate packing list|Refresh suggestions/ }).click();
  await expect(dialog(page).getByText(/^Review every suggestion/)).toBeVisible();
}
async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, credentials: "include", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
test("AI preview adds only selected items and preserves packed manual items across reload", async ({ page, user }) => {
  await login(page, user); await page.goto(`/trips/${user.tripId}/equipment`);
  await add(page, "Passport"); await page.getByRole("checkbox", { name: "Passport", exact: true }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await generate(page); await dialog(page).getByText("Why Walking shoes?").click(); await expect(dialog(page).getByText(/Comfort for your planned visit/)).toBeVisible();
  await expect(dialog(page).getByRole("checkbox", { name: /Passport/ })).toBeDisabled();
  await dialog(page).getByRole("checkbox", { name: /Phone charger/ }).uncheck();
  await dialog(page).getByRole("button", { name: "Add selected items (2)" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole("checkbox", { name: "Walking shoes", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Phone charger", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Passport", exact: true })).toBeChecked();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  await page.reload(); await expect(page.getByRole("checkbox", { name: "Passport", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Everyday socks", exact: true })).toBeVisible();
});
test("provider timeout preserves manual items and offers a working retry", async ({ page, user, harness }) => {
  await login(page, user); await page.goto(`/trips/${user.tripId}/equipment`); await add(page, "Passport");
  await harness.command("/packing-provider-timeout"); await page.getByRole("button", { name: /Generate packing list|Refresh suggestions/ }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Something went wrong. Please try again.");
  expect((await harness.trip(user.tripId!)).equipment.map(item => item.name)).toEqual(["Passport"]);
  await dialog(page).getByRole("button", { name: "Try again" }).click();
  await expect(dialog(page).getByRole("checkbox", { name: /Walking shoes/ })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 812 });
  const box = await dialog(page).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.width).toBeLessThanOrEqual(320);
  await dialog(page).getByRole("button", { name: "Cancel" }).focus(); await page.keyboard.press("Tab");
  await expect(dialog(page).getByRole("button", { name: "Refresh suggestions" })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole("checkbox", { name: "Passport", exact: true })).toBeVisible();
});
test("two same-identity contexts preserve concurrent manual additions and deduplicate apply", async ({ page, browser, user }) => {
  await login(page, user); await page.goto(`/trips/${user.tripId}/equipment`); await generate(page);
  const secondContext = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const other = await secondContext.newPage(); await other.goto(`http://127.0.0.1:5174/trips/${user.tripId}/equipment`);
    await add(other, "Phone charger"); await add(other, "Manual hat");
    await dialog(page).getByRole("button", { name: "Add selected items (4)" }).click(); await expect(dialog(page)).toBeHidden();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Manual hat", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Phone charger", exact: true })).toHaveCount(1);
    await generate(other); await expect(dialog(other).getByText(/All suggested items are already on your list/)).toBeVisible();
  } finally { await secondContext.close(); }
});
test("guest packing uses its own quota and survives import to an account", async ({ page, browser, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByText("Guest", { exact: true })).toBeVisible();
  const session = await api(page, "/api/auth/session?identity=1"); const guestId = session.body.guest.id as string;
  const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId });
  await page.goto(`/trips/${tripId}/equipment`); await generate(page);
  await dialog(page).getByRole("button", { name: "Add selected items (4)" }).click(); await expect(dialog(page)).toBeHidden();
  await page.reload(); await expect(page.getByRole("checkbox", { name: "Walking shoes", exact: true })).toBeVisible();
  for (let i = 1; i < 3; i++) { await generate(page); await dialog(page).getByRole("button", { name: "Cancel" }).click(); await expect(dialog(page)).toBeHidden(); }
  await page.getByRole("button", { name: /Generate packing list|Refresh suggestions/ }).click(); await expect(dialog(page).getByRole("alert")).toContainText("Your packing suggestion allowance is used.");
  await dialog(page).getByRole("button", { name: "Close" }).click();
  expect((await api(page, "/api/guest/usage")).body).toMatchObject({ aiGenerationsRemaining: 2, dayRegenerationsRemaining: 2 });
  const outsider = await browser.newContext();
  try {
    const other = await outsider.newPage(); await other.goto("http://127.0.0.1:5174/login"); await other.getByRole("button", { name: "Continue as guest" }).click();
    await expect(other.getByText("Guest", { exact: true })).toBeVisible();
    expect((await api(other, `/api/trips/${tripId}/equipment/generate`, "POST", {})).status).toBe(404);
  } finally { await outsider.close(); }
  await page.getByRole("link", { name: "Create account", exact: true }).first().click();
  await page.getByLabel("Email address").fill("packing-import@example.com"); await page.getByLabel(/^Password/).fill("Password123!Aa");
  await page.locator("form").getByRole("button", { name: "Create account", exact: true }).click();
  const migration = page.getByRole("dialog", { name: "Save your guest data" });
  await migration.getByRole("button", { name: "Import to my account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "1 trip from your guest session is saved to your account." })).toBeVisible();
  await page.goto(`/trips/${tripId}/equipment`); await expect(page.getByRole("checkbox", { name: "Walking shoes", exact: true })).toBeVisible();
  expect((await harness.trip(tripId)).equipment).toHaveLength(4);
});
