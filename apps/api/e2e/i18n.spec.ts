import { test, expect } from "./fixtures.ts";
test.use({ locale: "en-US" });
for (const guest of [false, true]) test(`language preference persists for ${guest ? "guests on mobile" : "anonymous visitors"}`, async ({ page, harness }) => {
  if (guest) {
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click();
    await expect(page).toHaveURL(/\/home$/);
  } else await page.goto("/explore");
  const calls = (await harness.state()).calls;
  const writes: string[] = [];
  page.on("request", request => { if (request.method() !== "GET" && /\/api\//.test(request.url())) writes.push(request.url()); });
  const originalUrl = page.url();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Language: English — EN", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitemradio", { name: "English", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitemradio", { name: "Polski", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Język: Polski" }).locator("img")).toHaveAttribute("src", "/flags/pl.svg");
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  expect(page.url()).toBe(originalUrl);
  await expect(page.getByRole("link", { name: "Odkrywaj", exact: true }).last()).toBeVisible();
  if (guest) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await page.getByRole("link", { name: "Odkrywaj", exact: true }).last().click();
  await expect(page).toHaveURL(/\/explore/); await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await page.getByRole("button", { name: "Język: Polski" }).click(); await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(page.getByRole("link", { name: "Explore", exact: true }).last()).toBeVisible();
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect((await harness.state()).calls).toEqual(calls); expect(writes).toEqual([]);
});

test.describe("authenticated locale", () => {
test.use({ scenario: "editing" });
test("authenticated trip keeps persisted data and locale across logout and login", async ({ page, user, harness }) => {
  const { login, openTrip } = await import("./fixtures.ts");
  await login(page, user); await openTrip(page, user.tripId!);
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  await expect(page.getByText(/^Day 2 of/)).toBeVisible();
  const original = await harness.trip(user.tripId!);
  const calls = (await harness.state()).calls;
  const currentUrl = page.url();
  await page.getByRole("button", { name: "Language: English" }).click();
  await page.getByRole("menuitemradio", { name: "Polski" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await expect(page.getByText(/^Dzień 2 z/)).toBeVisible();
  expect(page.url()).toBe(currentUrl); expect(await harness.trip(user.tripId!)).toEqual(original);
  expect((await harness.state()).calls).toEqual(calls);
  await page.getByRole("button", { name: "Wyloguj się" }).click();
  await expect(page).toHaveURL(/\/login$/); await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await login(page, user); await expect(page.locator("html")).toHaveAttribute("lang", "pl");
});

});
