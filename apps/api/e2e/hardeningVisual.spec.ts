import AxeBuilder from "@axe-core/playwright";
import type { Route } from "@playwright/test";
import { test, expect, login, openTrip } from "./fixtures.ts";

test.use({ scenario: "editing" });
for (const code of ["en", "pl"] as const) for (const mobile of [false, true]) test.describe(`${code}-${mobile ? "mobile" : "desktop"}`, () => {
  test.use({ viewport: mobile ? { width: 375, height: 740 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
  test("validation, empty, dialog, loading and network error states", async ({ page, user }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    if (code === "pl") {
      await page.locator(".language-switcher").click(); await page.getByRole("menuitemradio", { name: "Polski", exact: true }).click();
    }
    const capture = async (state: string) => {
      const issues = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
      expect(issues.map(issue => ({ rule: issue.id, nodes: issue.nodes.map(node => node.target) }))).toEqual([]);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.viewportSize())!.width);
      const path = info.outputPath(`${state}.png`); await page.screenshot({ path, animations: "disabled", mask: [page.locator(".user-email")] });
      await info.attach(state, { path, contentType: "image/png" });
    };
    await page.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.locator('input[aria-invalid="true"]').first()).toBeFocused(); await capture("validation");
    await login(page, user); await page.goto("/saved"); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); await capture("empty-saved");
    await openTrip(page, user.tripId!);
    await page.getByRole("button", { name: code === "pl" ? "Zmień plan dnia" : "Regenerate Day", exact: true }).click();
    const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible(); await capture("dialog");
    let pending: Route | undefined;
    await page.route("**/days/1/regenerate", route => { pending = route; });
    await dialog.getByRole("textbox").fill("Less walking");
    await dialog.getByRole("button", { name: code === "pl" ? "Wygeneruj wariant" : "Generate alternative", exact: true }).click();
    await expect.poll(() => Boolean(pending)).toBe(true); await expect(dialog.getByRole("status")).toBeVisible(); await capture("loading");
    await pending!.abort("failed"); await expect(dialog.getByRole("alert")).toBeVisible(); await capture("network-error");
    await expect(dialog.getByRole("textbox")).toHaveValue("Less walking");
    await expect(dialog.getByRole("button", { name: code === "pl" ? "Wygeneruj wariant" : "Generate alternative", exact: true })).toBeEnabled();
  });
});
