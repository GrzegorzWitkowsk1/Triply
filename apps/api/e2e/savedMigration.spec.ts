import type { Page } from "@playwright/test";
import { test, expect, login, openExploreDestination } from "./fixtures.ts";
import { findDestination } from "@triply/shared";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function enterGuest(page: Page) {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/home$/);
  return (await api(page, "/api/auth/session?identity=1")).body.guest.id as string;
}
async function saveDestinations(page: Page, destinationIds = ["city-003", "city-005"]) {
  for (const id of destinationIds) {
    const card = await openExploreDestination(page, id);
    const city = findDestination(id)!.city;
    await card.getByRole("button", { name: `Save ${city}`, exact: true }).click();
    await expect(card.getByRole("button", { name: `Unsave ${city}`, exact: true })).toBeEnabled();
  }
}
async function saveAttractions(page: Page, tripId: string, names = ["Barcelona Cathedral", "Palau de la Musica"]) {
  await page.goto(`/trips/${tripId}`);
  for (const name of names) {
    await page.getByRole("button", { name: `Save attraction ${name}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Unsave attraction ${name}`, exact: true })).toBeEnabled();
  }
}
async function registerGuest(page: Page, email: string) {
  await page.goto("/register"); await page.getByLabel("Email address").fill(email);
  await page.getByLabel(/^Password/).fill("Password123!Aa");
  await page.locator("form").getByRole("button", { name: "Create account", exact: true }).click();
  return page.getByRole("dialog", { name: "Save your guest data" });
}
async function importGuest(page: Page) {
  await page.getByRole("dialog", { name: "Save your guest data" }).getByRole("button", { name: "Import to my account", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("new account imports two destinations and two attractions with its trip and refreshes source hearts", async ({ page, harness }) => {
  const guestId = await enterGuest(page);
  await saveDestinations(page);
  const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId });
  await saveAttractions(page, tripId);
  const calls = (await harness.state()).calls;
  const dialog = await registerGuest(page, "saved-new@example.com");
  await expect(dialog).toContainText("1 trip, 2 destinations, and 2 attractions");
  await importGuest(page);
  expect((await harness.state()).calls).toEqual(calls);
  await page.goto("/saved"); await expect(page.getByRole("button", { name: "All (4)", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole("article")).toHaveCount(4);
  for (const id of ["city-003", "city-005"]) {
    const card = await openExploreDestination(page, id);
    await expect(card.getByRole("button", { name: `Unsave ${findDestination(id)!.city}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await page.goto(`/trips/${tripId}`);
  for (const name of ["Barcelona Cathedral", "Palau de la Musica"]) await expect(page.getByRole("button", { name: `Unsave attraction ${name}`, exact: true })).toHaveAttribute("aria-pressed", "true");
});

test.describe("existing account Saved merge", () => {
  test.use({ scenario: "editing" });
  test("preserves existing places and merges overlapping canonical keys exactly once", async ({ page, user, browser, harness }) => {
    await login(page, user); await saveDestinations(page, ["city-003", "city-005"]);
    await saveAttractions(page, user.tripId!, ["Barcelona Cathedral", "SITAKE YA"]);
    const existingTrip = await harness.trip(user.tripId!);
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:5174" });
    try {
      const guest = await context.newPage(); const guestId = await enterGuest(guest);
      await saveDestinations(guest, ["city-003", "city-011"]);
      const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId });
      await saveAttractions(guest, tripId);
      await guest.goto("/login");
      await guest.getByLabel("Email address").fill(user.email);
      await guest.getByLabel(/^Password/).fill(user.password);
      await guest.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
      const dialog = guest.getByRole("dialog", { name: "Save your guest data" });
      await expect(dialog).toContainText("1 trip, 2 destinations, and 2 attractions");
      await importGuest(guest); await guest.goto("/saved");
      await expect(guest.getByRole("button", { name: "All (6)", exact: true })).toBeVisible();
      await expect(guest.getByRole("article", { name: "Destination: Barcelona", exact: true })).toHaveCount(1);
      await expect(guest.getByRole("article", { name: "Attraction: Barcelona Cathedral", exact: true })).toHaveCount(1);
      for (const name of ["Rome", "Lisbon", "SITAKE YA", "Palau de la Musica"]) await expect(guest.getByText(name, { exact: true })).toBeVisible();
      await expect(guest.getByRole("alert").filter({ hasText: "were already saved and merged" })).toBeVisible();
      expect((await api(guest, "/api/auth/guest-migration/confirm", "POST")).body).toMatchObject({ alreadyImported: true, importedCount: 1, importedDestinationCount: 2, importedAttractionCount: 2, mergedDestinationCount: 1, mergedAttractionCount: 1 });
      expect(await harness.trip(user.tripId!)).toEqual(existingTrip);
      expect((await api(page, "/api/auth/guest-migration/confirm", "POST")).status).toBe(403);
    } finally { await context.close(); }
  });
});

test("Saved migration recovers from transaction interruption and a lost committed response", async ({ page, harness }) => {
  test.setTimeout(120_000);
  const guestId = await enterGuest(page); await saveDestinations(page);
  const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId }); await saveAttractions(page, tripId);
  const dialog = await registerGuest(page, "saved-retry@example.com"); await expect(dialog).toBeVisible();
  await harness.command("/fail-saved-import-once");
  await dialog.getByRole("button", { name: "Import to my account" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Your guest data is preserved");
  expect((await api(page, "/api/saved/destinations")).body.destinations).toHaveLength(0);
  expect((await api(page, "/api/saved/attractions")).body.attractions).toHaveLength(0);
  expect((await api(page, "/api/auth/guest-migration/status")).body).toMatchObject({ status: "pending", tripCount: 1, destinationCount: 2, attractionCount: 2 });
  await harness.command("/lose-import-response-once");
  await dialog.getByRole("button", { name: "Import to my account" }).click();
  await expect(dialog.getByRole("button", { name: "Import to my account" })).toBeEnabled();
  await expect(dialog.getByRole("alert")).toContainText("couldn't finish");
  expect((await api(page, "/api/auth/guest-migration/status")).body).toMatchObject({ status: "completed", importedDestinationCount: 2, importedAttractionCount: 2 });
  await importGuest(page); await page.goto("/saved");
  await expect(page.getByRole("button", { name: "All (4)", exact: true })).toBeVisible();
  expect((await api(page, "/api/auth/guest-migration/confirm", "POST")).body).toMatchObject({ alreadyImported: true, importedCount: 1, importedDestinationCount: 2, importedAttractionCount: 2 });
});

test("guest and account isolation survive import and old guest credentials are revoked", async ({ page, user, browser, harness }) => {
  test.setTimeout(120_000);
  const guestId = await enterGuest(page); await saveDestinations(page, ["city-003"]);
  const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId }); await saveAttractions(page, tripId, ["Barcelona Cathedral"]);
  const oldCookie = (await page.context().cookies()).find(cookie => cookie.name === "triply.sid")!;
  const b = await browser.newContext({ baseURL: "http://127.0.0.1:5174" });
  const replay = await browser.newContext({ baseURL: "http://127.0.0.1:5174" });
  const otherAccount = await browser.newContext({ baseURL: "http://127.0.0.1:5174" });
  try {
    const second = await b.newPage(); await enterGuest(second); await second.goto("/saved");
    await expect(second.getByText("No saved places yet", { exact: true })).toBeVisible();
    expect((await api(second, "/api/saved/attractions", "POST", { tripId, attractionKey: "osm:node:1000" })).status).toBe(404);
    await api(second, "/api/saved/destinations/city-003", "DELETE");
    expect((await api(page, "/api/saved/destinations")).body.destinations).toHaveLength(1);
    await registerGuest(page, "saved-owner@example.com"); await importGuest(page);
    await replay.addCookies([oldCookie]); const old = await replay.newPage(); await old.goto("/login");
    for (const path of ["/api/saved/destinations", "/api/saved/attractions", `/api/trips/${tripId}`]) expect((await api(old, path)).status).toBe(401);
    const outsider = await otherAccount.newPage(); await login(outsider, user); await outsider.goto("/saved");
    await expect(outsider.getByText("No saved places yet", { exact: true })).toBeVisible();
    expect((await api(outsider, "/api/saved/attractions", "POST", { tripId, attractionKey: "osm:node:1000" })).status).toBe(404);
    expect((await api(outsider, "/api/auth/guest-migration/confirm", "POST")).status).toBe(403);
    await api(outsider, "/api/saved/attractions/osm%3Anode%3A1000", "DELETE");
    expect((await api(page, "/api/saved/attractions")).body.attractions).toHaveLength(1);
  } finally { await b.close(); await replay.close(); await otherAccount.close(); }
});

test("Saved-only import remains available after deleting the source trip and deferring", async ({ page, harness }) => {
  const guestId = await enterGuest(page); await saveDestinations(page);
  const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId }); await saveAttractions(page, tripId);
  expect((await api(page, `/api/trips/${tripId}`, "DELETE")).status).toBe(204);
  const dialog = await registerGuest(page, "saved-only@example.com");
  await expect(dialog).toContainText("2 destinations and 2 attractions saved as a guest");
  await expect(dialog).not.toContainText("0 trips");
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByLabel("Pending guest import")).toBeVisible();
  expect((await api(page, "/api/saved/attractions")).body.attractions).toHaveLength(0);
  await page.getByRole("button", { name: "Resume import" }).click(); await importGuest(page);
  await page.goto("/saved"); await expect(page.getByRole("button", { name: "All (4)", exact: true })).toBeVisible();
  await page.getByRole("article", { name: "Attraction: Barcelona Cathedral", exact: true }).getByRole("button", { name: "View details" }).click();
  await expect(page.getByRole("link", { name: "View on OpenStreetMap" })).toHaveAttribute("href", "https://www.openstreetmap.org/node/1000");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Unsave attraction Barcelona Cathedral", exact: true }).click();
  await expect(page.getByRole("button", { name: "All (3)", exact: true })).toBeVisible();
});
