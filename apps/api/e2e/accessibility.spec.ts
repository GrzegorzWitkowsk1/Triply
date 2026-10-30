import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, login, openTrip } from "./fixtures.ts";

test.use({ scenario: "editing" });
async function audit(page: Page, name: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  return result.violations.map(issue => ({ screen: name, rule: issue.id, impact: issue.impact, nodes: issue.nodes.map(node => ({ target: node.target, html: node.html, summary: node.failureSummary })) }));
}
async function language(page: Page, code: "en" | "pl") {
  if (await page.locator("html").getAttribute("lang") === code) return;
  await page.locator(".language-switcher").first().click();
  await page.getByRole("menuitemradio", { name: code === "pl" ? "Polski" : "English", exact: true }).click();
}
for (const code of ["en", "pl"] as const) for (const mobile of [false, true]) test.describe(`${mobile ? "mobile" : "desktop"}-${code}`, () => {
  test.use({ viewport: mobile ? { width: 360, height: 740 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
  test("representative routes and dialogs have no axe violations", async ({ page, user }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page, user); await language(page, code);
    const issues: Awaited<ReturnType<typeof audit>> = [];
    for (const path of ["/home", "/trips", "/explore", "/saved", `/trips/${user.tripId}/equipment`, "/profile", "/notifications"]) {
      await page.goto(path); await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      issues.push(...await audit(page, path));
    }
    await openTrip(page, user.tripId!); await expect(page.locator(".budget-expense-form")).toBeVisible();
    issues.push(...await audit(page, "trip-plan-and-expenses"));
    if (mobile) { await page.getByRole("button", { name: code === "pl" ? "Mapa" : "Map", exact: true }).click(); issues.push(...await audit(page, "trip-map")); }
    await page.getByRole("button", { name: code === "pl" ? "Zapytaj Triply" : "Ask Triply", exact: true }).click();
    issues.push(...await audit(page, "assistant"));
    await page.getByRole("button", { name: code === "pl" ? "Zamknij asystenta" : "Close assistant", exact: true }).click();
    await page.goto("/home");
    await page.getByRole("textbox", { name: code === "pl" ? "Opisz podróż" : "Describe your trip" }).fill("Barcelona, Spain: three days.");
    await page.getByRole("button", { name: code === "pl" ? "Zaplanuj podróż" : "Plan my trip", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible(); issues.push(...await audit(page, "creator"));
    await info.attach("axe-results", { body: JSON.stringify(issues, null, 2), contentType: "application/json" });
    expect(issues).toEqual([]);
  });
  test("authentication has no axe violations", async ({ page }, info) => {
    await page.goto("/login"); await language(page, code);
    const issues = await audit(page, "authentication");
    await info.attach("axe-results", { body: JSON.stringify(issues, null, 2), contentType: "application/json" });
    expect(issues).toEqual([]);
  });
});
