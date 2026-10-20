import { test, expect, login } from "./fixtures.ts";
import type { Page } from "@playwright/test";

async function configure(page: Page, city?: string, country?: string) {
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  if (city) await dialog.getByLabel("Where are you going?").fill(city);
  if (country) await dialog.getByLabel("Which country is that in?").fill(country);
  await dialog.getByLabel("When does the trip start?").fill("2030-06-02");
  await dialog.getByLabel("When does the trip end?").fill("2030-06-04");
  await dialog.getByLabel("How many people will travel?").fill("1");
  await dialog.getByRole("button", { name: "€400–700", exact: true }).click();
  await dialog.getByRole("button", { name: "Architecture", exact: true }).click();
  await dialog.getByRole("button", { name: "Relaxed", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function generate(page: Page) {
  await page.getByRole("button", { name: "Generate my trip", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9]{24}$/);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reorder / }).first()).toBeVisible();
}
test("authenticated Explore to existing wizard, review and Barcelona itinerary", async ({ page, user, harness }) => {
  await login(page, user); await page.goto("/explore?q=barce&country=spain&sort=name-desc");
  await page.getByRole("button", { name: "Plan a trip", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/home\?destinationId=city-003$/);
  await expect(page.getByRole("textbox", { name: "Describe your trip" })).toHaveValue("Plan a trip to Barcelona, Spain");
  expect((await harness.state()).calls).toEqual([]);
  expect(await page.evaluate(async () => (await fetch("/api/trips")).json())).toEqual([]);
  await page.goBack(); await expect(page).toHaveURL(/q=barce&country=spain&sort=name-desc/);
  await page.getByRole("button", { name: "Plan a trip", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe your trip" })).toHaveValue("Plan a trip to Barcelona, Spain");
  await page.getByRole("button", { name: "Plan my trip", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Where are you going?")).toHaveValue("Barcelona");
  await expect(page.getByRole("dialog").getByLabel("Which country is that in?")).toHaveValue("Spain");
  await configure(page);
  const drafts = await page.evaluate(async () => (await fetch("/api/trips")).json());
  expect(drafts).toHaveLength(1); expect(drafts[0].status).toBe("draft");
  await generate(page);
  const id = page.url().split("/").at(-1)!; const stored = await harness.trip(id);
  expect(stored.analysis).toMatchObject({ destinationId: "city-003", destination: "Barcelona", country: "Spain", startDate: "2030-06-02", budget: { amount: 700, currency: "EUR" }, pace: "relaxed" });
  expect(stored.status).toBe("ready");
});
test("anonymous Saved planning entry preserves Rome through Guest Mode and manual Paris override", async ({ page, harness }) => {
  await page.goto("/explore?q=rome"); await page.getByRole("button", { name: "Plan a trip", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await harness.state()).sessions).toBe(0);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/home\?destinationId=city-005$/);
  await expect(page.getByRole("textbox", { name: "Describe your trip" })).toHaveValue("Plan a trip to Rome, Italy");
  await page.goto("/explore?q=rome"); await page.getByRole("button", { name: "Save Rome", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave Rome", exact: true })).toBeEnabled();
  await page.goto("/saved"); await page.getByRole("button", { name: "Plan a trip", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe your trip" })).toHaveValue("Plan a trip to Rome, Italy");
  expect((await harness.state()).calls).toEqual([]);
  await page.getByRole("button", { name: "Plan my trip", exact: true }).click();
  await configure(page, "Paris", "France");
  const usage = await page.evaluate(async () => (await fetch("/api/guest/usage")).json());
  expect(usage.aiGenerationsRemaining).toBe(2); expect(usage.dayRegenerationsRemaining).toBe(2);
  await generate(page);
  const stored = await harness.trip(page.url().split("/").at(-1)!);
  expect(stored.analysis).toMatchObject({ destinationId: null, destination: "Paris", country: "France", location: { city: "Paris", country: "France" } });
  await page.goto("/saved"); await expect(page.getByRole("article", { name: "Destination: Rome" })).toBeVisible();
});
test("invalid destination URL is recoverable in the normal wizard", async ({ page }) => {
  await page.goto("/home?destinationId=%E0%A4%A"); await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This destination link is invalid" })).toBeVisible();
  await page.getByRole("textbox", { name: "Describe your trip" }).fill("Paris, France");
  await page.getByRole("button", { name: "Plan my trip", exact: true }).click();
  await configure(page, "Paris", "France");
  await expect(page.getByRole("button", { name: "Generate my trip", exact: true })).toBeEnabled();
});
test("exhausted guest quota permits configuration but blocks generation on the backend", async ({ page, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/home$/);
  const session = await page.evaluate(async () => (await fetch("/api/auth/session?identity=1")).json());
  await harness.command("/exhaust-generation-quota", { guestId: session.guest.id });
  await page.goto("/explore?q=barce"); await page.getByRole("button", { name: "Plan a trip", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe your trip" })).toHaveValue("Plan a trip to Barcelona, Spain");
  expect((await harness.state()).calls).toEqual([]);
  await page.getByRole("button", { name: "Plan my trip", exact: true }).click(); await configure(page);
  await page.getByRole("button", { name: "Generate my trip", exact: true }).click();
  await expect(page.getByText("Your itinerary generation allowance is used for the last 24 hours. You can still edit your trip details.")).toBeVisible();
  // Bypassing the existing UI guard must still fail at the real generation endpoint.
  const rejected = await page.evaluate(async () => {
    const trips = await (await fetch("/api/trips")).json();
    const response = await fetch(`/api/trips/${trips[0].id}/generate`, { method: "POST" });
    return { status: response.status, body: await response.json() };
  });
  expect(rejected.status).toBe(429); expect(rejected.body.code).toBe("GUEST_AI_LIMIT_REACHED");
  const trips = await page.evaluate(async () => (await fetch("/api/trips")).json());
  expect(trips.every((trip: { status: string }) => trip.status !== "ready" && trip.status !== "generating")).toBe(true);
});
