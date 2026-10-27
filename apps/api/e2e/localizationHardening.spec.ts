import type { Page } from "@playwright/test";
import { test, expect, login, openTrip } from "./fixtures.ts";
import { analysis } from "./data.ts";
import { localizedArtifacts } from "./localizationArtifacts.ts";

test.use({ locale: "en-US" });
async function language(page: Page, locale: "en" | "pl") {
  if (await page.locator("html").getAttribute("lang") === locale) return;
  await page.getByRole("button", { name: /^(Language|Język):/ }).first().click();
  await page.getByRole("menuitemradio", { name: locale === "pl" ? "Polski" : "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, credentials: "include", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}

test.describe("legacy trip localization", () => {
  test.use({ scenario: "editing" });
  test("localized exports preserve legacy content and identical calendar instants", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    await expect(page.getByRole("button", { name: "More export options" })).toBeVisible();
    const before = await harness.trip(user.tripId!);
    const english = await localizedArtifacts(page, "en");
    await language(page, "pl");
    const polish = await localizedArtifacts(page, "pl");
    expect(polish.events).toEqual(english.events);
    for (const stop of before.itinerary!.days[0]!.stops) expect(polish.text).toContain(stop.name);
    const after = await harness.trip(user.tripId!);
    expect(after.itinerary).toEqual(before.itinerary);
    expect(after.contentLocale).toBe(before.contentLocale);
  });
  test("language preference synchronizes across tabs without changing data or requesting AI", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    await expect(page.getByRole("button", { name: "More export options" })).toBeVisible();
    const other = await page.context().newPage();
    try {
      await other.goto(`/trips/${user.tripId}`);
      await expect(other.getByRole("heading", { level: 1 })).toBeVisible();
      const before = await harness.trip(user.tripId!), calls = (await harness.state()).calls;
      for (const locale of ["pl", "en", "pl"] as const) {
        await language(page, locale);
        await expect(other.locator("html")).toHaveAttribute("lang", locale);
      }
      for (const path of ["equipment", "expenses", "", "equipment"]) {
        await page.goto(`/trips/${user.tripId}/${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        for (const width of [320, 375, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
      }
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", "pl");
      expect((await harness.state()).calls).toEqual(calls);
      expect((await harness.trip(user.tripId!)).itinerary).toEqual(before.itinerary);
      expect((await harness.trip(user.tripId!)).equipment).toEqual(before.equipment);
    } finally { await other.close(); }
  });
});

test("Polish guest migration preserves content locale, manual packing, saved places and UI preference", async ({ page, harness }) => {
  await page.goto("/login"); await language(page, "pl");
  await page.getByRole("button", { name: "Kontynuuj jako gość" }).click();
  await expect(page).toHaveURL(/\/home$/);
  const created = await api(page, "/api/trips/analyze", "POST", { prompt: "Barcelona, Spain", locale: "pl" });
  expect(created.status).toBe(200);
  const id = created.body.draftId as string;
  expect((await api(page, `/api/trips/${id}/requirements`, "PATCH", { answers: analysis(), confirmedFields: [] })).status).toBe(200);
  expect((await api(page, `/api/trips/${id}/generate`, "POST")).status).toBe(200);
  expect((await api(page, `/api/trips/${id}/equipment`, "POST", { name: "Moja kurtka", category: "clothing", quantity: 1 })).status).toBe(201);
  // Use the visible save control so catalog identity and request validation remain exercised.
  await page.goto("/explore?q=Barcelona");
  await page.getByRole("button", { name: "Zapisz: Barcelona", exact: true }).click();
  await expect(page.getByRole("button", { name: "Usuń z zapisanych: Barcelona", exact: true })).toBeVisible();
  const before = await harness.trip(id), usage = (await api(page, "/api/guest/usage")).body;
  const calls = (await harness.state()).calls;
  await language(page, "en"); await language(page, "pl");
  expect((await api(page, "/api/guest/usage")).body).toEqual(usage);
  expect((await harness.state()).calls).toEqual(calls);
  await page.goto("/register");
  await page.getByLabel("Adres e-mail").fill("polish-migration@example.com");
  await page.getByLabel(/^Hasło/).fill("Password123!Aa");
  await page.locator("form").getByRole("button", { name: "Utwórz konto", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Zapisz dane gościa" });
  await dialog.getByRole("button", { name: "Zaimportuj na moje konto" }).click();
  await expect(dialog).toBeHidden();
  const after = await harness.trip(id);
  expect(after.user).toBeTruthy(); expect(after.guestId).toBeUndefined();
  expect(after.contentLocale).toBe("pl");
  expect(after.itinerary).toEqual(before.itinerary); expect(after.equipment).toEqual(before.equipment);
  await page.goto(`/trips/${id}/equipment`); await page.reload();
  await expect(page.getByRole("checkbox", { name: "Moja kurtka", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await page.goto("/saved");
  await expect(page.getByRole("heading", { name: "Barcelona", exact: true })).toBeVisible();
});
