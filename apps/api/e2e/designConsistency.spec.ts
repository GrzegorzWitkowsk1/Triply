import type { Page, TestInfo } from "@playwright/test";
import { test, expect, login, openTrip } from "./fixtures.ts";

test.use({ scenario: "editing", locale: "en-US" });

async function setLanguage(page: Page, language: "en" | "pl") {
  await page.getByRole("button", { name: /^(Language|Język):/ }).first().click();
  await page.getByRole("menuitemradio", { name: language === "en" ? "English" : "Polski", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}

async function capture(page: Page, info: TestInfo, screen: string, language: string) {
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), `${screen} overflow at ${width}px`).toBeLessThanOrEqual(width);
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible()) {
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    if (width === 375 || width === 1440) {
      const path = info.outputPath(`${screen}-${language}-${width}.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled", mask: [page.locator(".user-email")], maskColor: "#fbeae7" });
      await info.attach(`${screen}-${language}-${width}`, { path, contentType: "image/png" });
    }
  }
}

for (const language of ["en", "pl"] as const) {
  test(`design review: feature screens in ${language}`, async ({ page, user, harness }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page, user);
    await setLanguage(page, language);
    for (const route of ["home", "trips", "explore", "saved"]) {
      await page.goto(`/${route}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      if (route === "explore") await expect(page.locator("[data-destination-id]").first()).toBeVisible();
      if (route === "trips") {
        // Card metadata lives on a white surface, outside the image overlay.
        await expect(page.locator(".my-trip-city").first()).toHaveCSS("color", "rgb(28, 28, 28)");
        await expect(page.locator(".my-trip-locale-sub").first()).toHaveCSS("text-shadow", "none");
      }
      await capture(page, info, route, language);
    }
    await openTrip(page, user.tripId!);
    await expect(page.locator(".budget-expense-form")).toBeVisible();
    await capture(page, info, "trip-details-and-expenses", language);
    await page.goto(`/trips/${user.tripId}/equipment`);
    await expect(page.locator(".packing-form")).toBeVisible();
    await capture(page, info, "packing", language);
    expect((await harness.state()).calls.filter(call => call !== "weather")).toEqual([]);
  });

  test(`design review: authentication and creator in ${language}`, async ({ page, harness }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await setLanguage(page, language);
    await capture(page, info, "authentication", language);
    const submit = page.locator("form .btn-primary");
    await expect(submit).toHaveCSS("min-height", "44px");
    await expect(submit).toHaveCSS("color", "rgb(28, 28, 28)");
    await submit.hover();
    await expect(submit).toHaveCSS("filter", "brightness(0.97)");
    await page.getByRole("button", { name: language === "en" ? "Continue as guest" : "Kontynuuj jako gość" }).click();
    await page.getByRole("textbox", { name: language === "en" ? "Describe your trip" : "Opisz podróż" }).fill("Barcelona, Spain: three days.");
    await page.getByRole("button", { name: language === "en" ? "Plan my trip" : "Zaplanuj podróż", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture(page, info, "trip-creator", language);
    // Opening the requirements form must not generate or regenerate an itinerary.
    expect((await harness.state()).calls).not.toContain("itinerary");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
}
