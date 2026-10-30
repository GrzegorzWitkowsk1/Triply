import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { TripDetail } from "@triply/shared";
import { test, expect, login, openTrip } from "./fixtures.ts";
import { localizedArtifacts } from "./localizationArtifacts.ts";

test.use({ locale: "en-US" });
const words = (locale: string, namespace: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../web/src/i18n/locales/${locale}/${namespace}.json`, import.meta.url), "utf8"));
async function language(page: Page, locale: "en" | "pl") {
  const selected = await page.locator("html").getAttribute("lang");
  if (selected === locale) return;
  await page.getByRole("button", { name: selected === "pl" ? "Język: Polski — PL" : "Language: English — EN", exact: true }).click();
  await page.getByRole("menuitemradio", { name: locale === "pl" ? "Polski" : "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
async function api(page: Page, path: string, body: unknown) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
}

for (const locale of ["en", "pl"] as const) test(`new ${locale} trip captures UI locale and persists localized content across reload`, async ({ page, user, harness }) => {
  const home = words(locale, "tripCreator/home"), fields = words(locale, "tripCreator/fields");
  await login(page, user); await language(page, locale);
  await page.locator("textarea").first().fill("Barcelona, Spain, culture");
  const analyzed = page.waitForResponse(response => response.url().endsWith("/api/trips/analyze"));
  await page.getByRole("button", { name: home.planMyTrip, exact: true }).click();
  const response = await analyzed;
  expect(response.request().postDataJSON().locale).toBe(locale);
  const draft = await response.json() as { draftId: string; contentLocale: string };
  expect(draft.contentLocale).toBe(locale);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fields.whereAreYouGoing!).fill("Barcelona");
  await dialog.getByLabel(fields.whichCountryIsThatIn!).fill("Spain");
  await dialog.getByLabel(fields.howManyDaysDoYouHave!).fill("3");
  await dialog.getByLabel(fields.whenDoesTheTripStart!).fill("2030-06-02");
  await dialog.getByLabel(fields.howManyPeopleWillTravel!).fill("1");
  await dialog.getByRole("button", { name: fields.somethingElse, exact: true }).click();
  await dialog.getByLabel(fields.myBudget!).fill("500");
  await dialog.getByLabel(fields.addYourOwn!).fill("architecture");
  await dialog.getByRole("button", { name: locale === "pl" ? "Dodaj" : "Add", exact: true }).click();
  await dialog.getByRole("button", { name: fields.continue, exact: true }).click();
  const generated = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/generate"));
  await page.getByRole("button", { name: home.generateMyTrip, exact: true }).click();
  const generationResponse = await generated;
  expect(generationResponse.status(), await generationResponse.text()).toBe(200);
  const detail = await generationResponse.json() as TripDetail;
  expect(detail.contentLocale).toBe(locale);
  expect(detail.analysis.notes).toBe(locale === "pl" ? "Polski opis podróży." : "English trip description.");
  const travel = detail.itinerary!.days.flatMap(day => day.activities).filter(activity => activity.type === "travel");
  expect(travel.length).toBeGreaterThan(0);
  expect(travel.every(activity => locale === "pl" ? /^(Przejście do:|Powrót)/.test(activity.title) : /^(To |Return)/.test(activity.title))).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Barcelona");
  await expect(page.getByText(detail.itinerary!.days[0]!.stops[0]!.name, { exact: true }).first()).toBeVisible();
  const stored = await harness.trip(draft.draftId);
  expect(stored.contentLocale).toBe(locale);
  expect(stored.analysis.notes).toBe(detail.analysis.notes);
  await localizedArtifacts(page, locale);
  for (const path of ["equipment", "expenses"]) {
    await page.goto(`/trips/${draft.draftId}/${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
});

test.describe("existing English content", () => {
  test.use({ scenario: "editing" });
  test("Polish UI preserves English trip and regenerates only its selected day in English", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    const before = await harness.trip(user.tripId!); const calls = (await harness.state()).calls;
    await language(page, "pl");
    expect((await harness.state()).calls).toEqual(calls);
    expect((await harness.trip(user.tripId!)).itinerary).toEqual(before.itinerary);
    const preview = await api(page, `/api/trips/${user.tripId}/days/1/regenerate`, { locale: "pl", preferences: { relaxedPace: true } });
    expect(preview.status).toBe(200);
    expect(preview.body.day.activities.filter((a: { type: string }) => a.type === "break").every((a: { title: string }) => a.title.includes("break"))).toBe(true);
    const applied = await api(page, `/api/trips/${user.tripId}/days/1/apply`, { previewId: preview.body.previewId });
    expect(applied.status).toBe(200); expect(applied.body.contentLocale).toBe("en");
    const after = await harness.trip(user.tripId!);
    expect(after.itinerary!.days.slice(1)).toEqual(before.itinerary!.days.slice(1));
  });
  test("assistant uses the UI locale for new messages while keeping old messages", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!); await language(page, "pl");
    const trip = await harness.trip(user.tripId!);
    await page.getByRole("button", { name: "Zapytaj Triply", exact: true }).click();
    await page.locator(".assistant-input").fill("Ile jest atrakcji?");
    const polish = page.waitForResponse(r => r.url().endsWith("/assistant/messages"));
    await page.getByRole("button", { name: "Wyślij wiadomość", exact: true }).click();
    const pl = await polish; expect(pl.request().postDataJSON().locale).toBe("pl");
    const oldMessage = (await pl.json()).response.message as string;
    await expect(page.getByText(oldMessage, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Zamknij asystenta" }).click();
    await language(page, "en");
    await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
    await page.locator(".assistant-input").fill("How many attractions?");
    const english = page.waitForResponse(r => r.url().endsWith("/assistant/messages"));
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const en = await english; expect(en.request().postDataJSON().locale).toBe("en");
    expect((await en.json()).response.message).toContain("scheduled attractions");
    await expect(page.getByText(oldMessage, { exact: true })).toBeVisible();
    expect((await harness.trip(user.tripId!)).itinerary).toEqual(trip.itinerary);
  });
  test("Polish packing suggestions remain unchanged after switching to English", async ({ page, user, harness }) => {
    await login(page, user); await page.goto(`/trips/${user.tripId}/equipment`); await language(page, "pl");
    const pl = words("pl", "packing/suggestions");
    const generated = page.waitForResponse(r => r.url().endsWith("/equipment/generate"));
    await page.getByRole("button", { name: pl.generatePackingList }).click();
    const response = await generated; expect(response.request().postDataJSON().locale).toBe("pl");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox", { name: /Ładowarka do telefonu/ })).toBeVisible();
    await dialog.getByRole("button", { name: /Dodaj wybrane/ }).click();
    await expect(dialog).toBeHidden();
    const saved = (await harness.trip(user.tripId!)).equipment;
    expect(saved.map(item => item.name)).toContain("Ładowarka do telefonu");
    const calls = (await harness.state()).calls;
    await language(page, "en"); await page.reload();
    await expect(page.getByRole("checkbox", { name: "Ładowarka do telefonu", exact: true })).toBeVisible();
    expect((await harness.trip(user.tripId!)).equipment).toEqual(saved);
    expect((await harness.state()).calls).toEqual(calls);
  });
});
