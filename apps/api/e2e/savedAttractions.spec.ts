import { test, expect, login } from "./fixtures.ts";

test("guest saves from itinerary, persists, synchronizes, and retains attraction after trip deletion", async ({ page, harness }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/home$/);
  const session = await page.evaluate(async () => (await fetch("/api/auth/session?identity=1")).json());
  const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId: session.guest.id });
  await page.goto(`/trips/${tripId}`);
  const name = "Barcelona Cathedral";
  await page.getByRole("button", { name: `Save attraction ${name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Unsave attraction ${name}`, exact: true })).toBeEnabled();
  await page.goto("/saved");
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.goto(`/trips/${tripId}`);
  const unsave = page.getByRole("button", { name: `Unsave attraction ${name}`, exact: true });
  await expect(unsave).toHaveAttribute("aria-pressed", "true");
  await unsave.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: `Save attraction ${name}`, exact: true })).toBeEnabled();
  await page.goto("/saved");
  await expect(page.getByText(/No saved places yet/)).toBeVisible();
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: `Save attraction ${name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Unsave attraction ${name}`, exact: true })).toBeEnabled();
  const deleted = await page.evaluate(async id => (await fetch(`/api/trips/${id}`, { method: "DELETE" })).status, tripId);
  expect(deleted).toBe(204);
  await page.goto("/saved");
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View details" }).click();
  await expect(page.getByRole("link", { name: "View on OpenStreetMap" })).toHaveAttribute("href", "https://www.openstreetmap.org/node/1000");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: `Unsave attraction ${name}`, exact: true }).click();
  await expect(page.getByText(/No saved places yet/)).toBeVisible();
});

test("guest attraction collections are isolated and expired guests cannot reuse old saves", async ({ page, browser, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/home$/);
  const session = await page.evaluate(async () => (await fetch("/api/auth/session?identity=1")).json());
  const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId: session.guest.id });
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: "Save attraction Barcelona Cathedral", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave attraction Barcelona Cathedral", exact: true })).toBeEnabled();
  const other = await browser.newContext();
  try {
    const second = await other.newPage(); await second.goto("http://127.0.0.1:5174/login");
    await second.getByRole("button", { name: "Continue as guest" }).click(); await expect(second).toHaveURL(/\/home$/);
    await second.goto("http://127.0.0.1:5174/saved"); await expect(second.getByText(/No saved places yet/)).toBeVisible();
    const denied = await second.evaluate(async id => (await fetch("/api/saved/attractions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tripId: id, attractionKey: "osm:node:1000" }) })).status, tripId);
    expect(denied).toBe(404);
    await page.goto("/saved"); await expect(page.getByText("Barcelona Cathedral", { exact: true })).toBeVisible();
  } finally { await other.close(); }
  await harness.command("/expire-guest", { guestId: session.guest.id });
  await page.reload(); await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page).toHaveURL(/\/saved$/);
  await expect(page.getByText(/No saved places yet/)).toBeVisible();
});

test.describe("authenticated saves", () => {
  test.use({ scenario: "future" });
  test("saves an attraction from an owned itinerary", async ({ page, user }) => {
    await login(page, user); await page.goto(`/trips/${user.tripId}`);
    await page.getByRole("button", { name: "Save attraction Colosseum", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unsave attraction Colosseum", exact: true })).toBeEnabled();
    await page.goto("/saved"); await expect(page.getByText("Colosseum", { exact: true })).toBeVisible();
  });
});
