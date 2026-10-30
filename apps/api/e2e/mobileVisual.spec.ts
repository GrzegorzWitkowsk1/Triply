import type { Page, TestInfo } from "@playwright/test";
import { test, expect, login, openTrip } from "./fixtures.ts";
test.use({ scenario: "editing", locale: "en-US", isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const widths = [320, 375, 390, 768, 1440];
async function language(page: Page, code: "en" | "pl") {
  if (await page.locator("html").getAttribute("lang") === code) return;
  await page.getByRole("button", { name: /^(Language|Język):/ }).first().click();
  await page.getByRole("menuitemradio", { name: code === "pl" ? "Polski" : "English", exact: true }).click();
}
async function capture(page: Page, info: TestInfo, screen: string, code: string, prepare?: (width: number) => Promise<void>) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 740 : 900 });
    await prepare?.(width);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), `${screen} overflow at ${width}`).toBeLessThanOrEqual(width);
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible()) {
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual((await page.viewportSize())!.height);
    }
    const path = info.outputPath(`${screen}-${code}-${width}.png`);
    await page.screenshot({ path, fullPage: false, animations: "disabled", mask: [page.locator(".user-email")], maskColor: "#fbeae7" });
    await info.attach(`${screen}-${code}-${width}`, { path, contentType: "image/png" });
  }
}
for (const code of ["en", "pl"] as const) {
  test(`mobile visual review ${code}`, async ({ page, user }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page, user); await language(page, code);
    for (const route of ["home", "explore", "saved", `trips/${user.tripId}/equipment`]) {
      await page.goto(`/${route}`); await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      if (route === "explore") await expect(page.locator("[data-destination-id]").first()).toBeVisible();
      await capture(page, info, route.includes("equipment") ? "packing" : route, code);
    }
    await openTrip(page, user.tripId!);
    await expect(page.locator(".budget-expense-form")).toBeVisible();
    await capture(page, info, "trip-plan", code, async width => {
      if (width < 1024) await page.getByRole("button", { name: "Plan", exact: true }).click();
      await page.locator(".trip-experience-controls").scrollIntoViewIfNeeded();
    });
    await capture(page, info, "trip-map", code, async width => {
      if (width < 1024) await page.getByRole("button", { name: code === "pl" ? "Mapa" : "Map", exact: true }).click();
      await page.locator(".trip-map").scrollIntoViewIfNeeded(); await expect(page.locator(".trip-map")).toBeVisible();
    });
    await capture(page, info, "expenses", code, async () => {
      await page.getByRole("link", { name: code === "pl" ? "Zobacz wydatki" : "View expenses", exact: true }).click();
      await expect(page.locator(".budget-expense-form")).toBeVisible();
      await page.locator(".budget-expense-form").scrollIntoViewIfNeeded();
    });
    await page.getByRole("button", { name: code === "pl" ? "Zapytaj Triply" : "Ask Triply", exact: true }).click();
    await expect(page.locator(".assistant-panel")).toBeVisible();
    await capture(page, info, "assistant", code);
    await page.getByRole("button", { name: code === "pl" ? "Zamknij asystenta" : "Close assistant", exact: true }).click();
    await page.goto("/home");
    await page.getByRole("textbox", { name: code === "pl" ? "Opisz podróż" : "Describe your trip" }).fill("Barcelona, Spain: three days.");
    await page.getByRole("button", { name: code === "pl" ? "Zaplanuj podróż" : "Plan my trip", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture(page, info, "creator", code);
  });
  test(`mobile authentication visual review ${code}`, async ({ page }, info) => {
    await page.goto("/login"); await language(page, code);
    await capture(page, info, "authentication", code);
    await page.setViewportSize({ width: 740, height: 320 });
    await page.getByLabel(code === "pl" ? "Adres e-mail" : "Email address").fill("mobile@example.test");
    await expect(page.locator("form .btn-primary")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(740);
  });
}
