import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";
import { analysis } from "./data.ts";
const emptySavedReceipt = { importedDestinationCount: 0, importedAttractionCount: 0, mergedDestinationCount: 0, mergedAttractionCount: 0 };

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, credentials: "include", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function draft(page: Page) {
  const result = await api(page, "/api/trips/analyze", "POST", { prompt: "Barcelona, Spain" });
  expect(result.status).toBe(200);
  const id = result.body.draftId as string;
  expect((await api(page, `/api/trips/${id}/requirements`, "PATCH", { answers: analysis(), confirmedFields: [] })).status).toBe(200);
  return id;
}
async function enter(page: Page) {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByText("Guest", { exact: true })).toBeVisible();
}

test("guest registration imports a generated itinerary, preserving sharing and revoking the old guest", async ({ page, browser, harness }) => {
  await enter(page);
  const id = await draft(page);
  await page.goto(`/trips/${id}`);
  const generated = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/generate"));
  await page.getByRole("button", { name: "Generate my trip", exact: true }).click();
  expect((await generated).status()).toBe(200);
  const link = await api(page, `/api/trips/${id}/sharing`, "POST");
  expect(link.status).toBe(200); const shareToken = link.body.token as string;
  const guestCookie = (await page.context().cookies()).find(c => c.name === "triply.sid")!;
  await page.getByRole("link", { name: "Create account", exact: true }).first().click();
  await page.getByLabel("Email address").fill("migration-new@example.com");
  await page.getByLabel(/^Password/).fill("Password123!Aa");
  await page.locator("form").getByRole("button", { name: "Create account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save your guest data" });
  await expect(dialog).toContainText("You have 1 trip");
  await expect(dialog.getByRole("button", { name: "Import to my account" })).toBeEnabled();
  const before = await harness.trip(id);
  const calls = (await harness.state()).calls.length;
  await page.setViewportSize({ width: 375, height: 812 });
  const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.width).toBeLessThanOrEqual(375);
  await dialog.getByRole("button", { name: "Not now" }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Import to my account" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "1 trip from your guest session is saved to your account." })).toBeVisible();
  expect((await harness.state()).calls.length).toBe(calls);
  const after = await harness.trip(id);
  const { guestId: _source, guestSlot: _slot, ...preserved } = before;
  const { user: _destination, ...content } = after;
  expect(content).toEqual(preserved);
  expect(after.user).toBeTruthy(); expect(after.guestId).toBeUndefined();
  await page.goto("/trips");
  await expect(page.locator(".my-trip-city")).toHaveText("Barcelona");
  await page.goto(`/trips/${id}`); await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Barcelona");
  expect((await harness.trip(id)).itinerary).toEqual(before.itinerary);
  const replay = await browser.newContext();
  try {
    await replay.addCookies([guestCookie]);
    const outsider = await replay.newPage(); await outsider.goto("http://127.0.0.1:5174/login");
    expect((await api(outsider, `/api/trips/${id}`)).status).toBe(401);
    expect((await api(outsider, `/api/trips/${id}/sharing`, "DELETE")).status).toBe(401);
    expect((await api(outsider, `/api/public/trips/${shareToken}`)).status).toBe(200);
  } finally { await replay.close(); }
});

test.describe("existing account handoff", () => {
  test.use({ scenario: "editing" });
  test("six guest trips survive deferred import, transaction interruption and retry without overwriting account trips", async ({ page, user, harness }) => {
    test.setTimeout(120_000);
    const existing = await harness.trip(user.tripId!);
    await enter(page);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await draft(page));
    await page.getByRole("link", { name: "Log in", exact: true }).click();
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel(/^Password/).fill(user.password);
    await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Save your guest data" });
    await expect(dialog).toContainText("You have 6 trips");
    const before = await Promise.all(ids.map(id => harness.trip(id)));
    await dialog.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByLabel("Pending guest import")).toBeVisible();
    await page.getByRole("button", { name: "Resume import" }).click();
    await harness.command("/fail-import-once");
    await dialog.getByRole("button", { name: "Import to my account" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Your guest data is preserved");
    expect(await Promise.all(ids.map(id => harness.trip(id)))).toEqual(before);
    expect((await api(page, "/api/auth/guest-migration/status")).body).toMatchObject({ status: "pending", tripCount: 6 });
    await dialog.getByRole("button", { name: "Import to my account" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "6 trips from your guest session are saved to your account." })).toBeVisible();
    expect((await api(page, "/api/auth/guest-migration/confirm", "POST")).body).toEqual({ ...emptySavedReceipt, importedCount: 6, alreadyImported: true });
    expect(await harness.trip(user.tripId!)).toEqual(existing);
    const owned = await api(page, "/api/trips");
    expect(owned.body).toHaveLength(7);
    expect(owned.body.map((t: { id: string }) => t.id).sort()).toEqual([user.tripId, ...ids].sort());
    await page.goto("/trips"); await page.reload();
    await expect(page.locator(".my-trip-city")).toHaveCount(7);
  });
});
