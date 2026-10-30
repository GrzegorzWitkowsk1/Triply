import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect, openExportMenu, timelineNames } from "./fixtures.ts";
import { analysis } from "./data.ts";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, credentials: "include", ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function createDraft(page: Page) {
  const created = await api(page, "/api/trips/analyze", "POST", { prompt: "Barcelona, Spain" });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const id = created.body.draftId as string;
  const patched = await api(page, `/api/trips/${id}/requirements`, "PATCH", { answers: analysis(), confirmedFields: [] });
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  return id;
}

test("guest entry, reload, mobile navigation, upgrade and exit", async ({ page, harness }) => {
  await page.goto('/login');
  expect((await harness.state()).sessions).toBe(0);
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText('Guest', { exact: true })).toBeVisible();
  const original = (await api(page, '/api/auth/session?identity=1')).body.guest.id;
  await page.reload();
  await expect(page.getByRole('button', { name: 'End guest session' })).toBeVisible();
  expect((await api(page, '/api/auth/session?identity=1')).body.guest.id).toBe(original);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('link', { name: 'trips', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My trips', exact: true })).toBeVisible();
  await expect(page.getByLabel('Guest usage')).toContainText('Trips: 0 / 6');
  for (const width of [320, 375, 480]) {
    await page.setViewportSize({ width, height: 812 });
    const overflow = await page.evaluate(() => ({
      viewport: window.innerWidth,
      width: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('body *')].flatMap(element => {
        const rect = element.getBoundingClientRect();
        return rect.right > window.innerWidth || rect.left < 0
          ? [{ tag: element.tagName, className: element.getAttribute('class'), left: rect.left, right: rect.right }]
          : [];
      }),
    }));
    expect(overflow.width, JSON.stringify(overflow, null, 2)).toBeLessThanOrEqual(overflow.viewport);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  expect((await harness.state()).sessions).toBe(1);
  await page.getByRole('button', { name: 'End guest session' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await harness.state()).sessions).toBe(0);
});

test("guest session and trips survive a new browser context with restored persistent cookies", async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page.getByText('Guest', { exact: true })).toBeVisible();
  const id = await createDraft(page);
  const original = (await api(page, '/api/auth/session?identity=1')).body.guest.id;
  const storageState = await page.context().storageState();
  expect(storageState.cookies.find(c => c.name === 'triply.sid')!.expires).toBeGreaterThan(Date.now() / 1000);
  const restored = await browser.newContext({ storageState });
  try {
    const returning = await restored.newPage();
    await returning.goto('http://127.0.0.1:5174/trips');
    await expect(returning.getByText('Guest', { exact: true })).toBeVisible();
    expect((await api(returning, '/api/auth/session?identity=1')).body.guest.id).toBe(original);
    expect((await api(returning, `/api/trips/${id}`)).status).toBe(200);
  } finally { await restored.close(); }
});

test("expired guest reload explains lost access without silently replacing identity", async ({ page, harness }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page.getByText('Guest', { exact: true })).toBeVisible();
  const id = await createDraft(page);
  const guestId = (await api(page, '/api/auth/session?identity=1')).body.guest.id;
  await harness.command('/expire-guest', { guestId });
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/Trips from the expired session will not be reassigned/)).toBeVisible();
  expect((await api(page, `/api/trips/${id}`)).body.code).toBe('GUEST_SESSION_EXPIRED');
  expect((await api(page, '/api/auth/session?identity=1')).body.status).toBe('anonymous');
  expect((await harness.trip(id)).guestId).toBe(guestId);
  expect((await harness.state()).sessions).toBe(1);
});

test("guest sharing supports anonymous PDF/calendar exports and revocation without consuming quota", async ({ page, browser, harness }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page.getByText('Guest', { exact: true })).toBeVisible();
  const id = await createDraft(page);
  expect((await api(page, `/api/trips/${id}/generate`, 'POST')).status).toBe(200);
  const usage = (await api(page, '/api/guest/usage')).body;
  await page.goto(`/trips/${id}`);
  await openExportMenu(page);
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Enable sharing', exact: true }).click();
  const link = await page.getByLabel('Share link').inputValue();
  const token = new URL(link).pathname.split('/').at(-1)!;
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage(); await visitor.goto(link);
    await expect(visitor.getByRole('heading', { level: 1 })).toContainText('Barcelona');
    await expect(visitor.getByRole('button', { name: /^Reorder |Regenerate|Add Attraction/ })).toHaveCount(0);
    const calls = (await harness.state()).calls.length;
    for (const format of ['pdf', 'calendar']) {
      const response = await anonymous.request.get(`http://127.0.0.1:5174/api/public/trips/${token}/export/${format}`);
      expect(response.status()).toBe(200);
      const content = await response.body();
      expect(content.toString()).toContain(format === 'pdf' ? '%PDF-' : 'BEGIN:VCALENDAR');
      const owner = await page.context().request.get(`http://127.0.0.1:5174/api/trips/${id}/export/${format}`);
      expect(owner.status()).toBe(200);
    }
    expect((await harness.state()).calls.length).toBe(calls);
    expect((await api(page, '/api/guest/usage')).body).toEqual(usage);
    expect((await anonymous.cookies()).some(c => c.name === 'triply.sid')).toBe(false);
    await page.getByRole('button', { name: 'Disable sharing', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm disable', exact: true }).click();
    await expect(page.getByText('Sharing disabled', { exact: true })).toBeVisible();
    for (const suffix of ['', '/export/pdf', '/export/calendar']) {
      expect((await anonymous.request.get(`http://127.0.0.1:5174/api/public/trips/${token}${suffix}`)).status()).toBe(404);
    }
    await visitor.reload(); await expect(visitor.getByRole('alert')).toContainText('unavailable');
  } finally { await anonymous.close(); }
});

test("guest wizard, generation, editing, PDF, quotas, deletion and cross-guest isolation", async ({ page, browser, harness }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.getByPlaceholder(/4 days in Barcelona/).fill('Barcelona, Spain: three days, food and architecture.');
  await page.getByRole('button', { name: 'Plan my trip', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Guest trips: up to 7 calendar days/)).toBeVisible();
  await dialog.getByLabel('Where are you going?').fill('Barcelona');
  await dialog.getByLabel('Which country is that in?').fill('Spain');
  await dialog.getByLabel('How many days do you have?').fill('3');
  await dialog.getByLabel('When does the trip start?').fill('2030-06-02');
  await dialog.getByLabel('How many people will travel?').fill('1');
  await dialog.getByRole('button', { name: 'Something else' }).click();
  await dialog.getByLabel('My budget').fill('500');
  await dialog.getByRole('button', { name: 'Food', exact: true }).click();
  await dialog.getByRole('button', { name: 'Architecture', exact: true }).click();
  const saved = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/requirements'));
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  expect((await saved).status()).toBe(200);
  const generating = page.waitForResponse(r => r.url().endsWith('/generate') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Generate my trip', exact: true }).click();
  expect((await generating).status()).toBe(200);
  const first = page.url().split('/').at(-1)!;
  await expect(timelineNames(page).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Barcelona');
  const before = await harness.trip(first);
  expect(before.guestId).toEqual(expect.any(String)); expect(before.user).toBeUndefined();
  const name = before.itinerary!.days[0]!.stops[0]!.name;
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  const editing = page.waitForResponse(r => r.url().endsWith('/itinerary/edit') && r.request().method() === 'POST');
  await page.getByRole('menuitem', { name: 'Remove attraction', exact: true }).click();
  expect((await editing).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('button', { name: `Edit ${name}`, exact: true })).toHaveCount(0);
  expect((await harness.trip(first)).itineraryVersion).toBe(before.itineraryVersion + 1);
  expect((await harness.trip(first)).itinerary!.days.slice(1)).toEqual(before.itinerary!.days.slice(1));
  await openExportMenu(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download PDF', exact: true }).click();
  const download = await downloading;
  expect((await readFile((await download.path())!)).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByLabel('Guest usage')).toContainText('AI generations remaining: 1 / 2');

  const second = await createDraft(page);
  expect((await api(page, `/api/trips/${second}/generate`, 'POST')).status).toBe(200);
  const third = await createDraft(page);
  const calls = (await harness.state()).calls.length;
  const rejected = await api(page, `/api/trips/${third}/generate`, 'POST');
  expect(rejected.status).toBe(429); expect(rejected.body.code).toBe('GUEST_AI_LIMIT_REACHED');
  expect((await harness.state()).calls.length).toBe(calls);
  await page.goto(`/trips/${third}`);
  await expect(page.getByLabel('Guest usage')).toContainText("You've used your 2 itinerary generations");
  await expect(page.getByRole('button', { name: 'Generate my trip', exact: true })).toBeDisabled();
  for (let i = 0; i < 3; i++) await createDraft(page);
  await page.goto('/trips');
  await expect(page.getByLabel('Guest usage')).toContainText('Trips: 6 / 6');
  await expect(page.getByRole('button', { name: 'Plan a new trip', exact: true }).first()).toBeDisabled();
  const seventh = await api(page, '/api/trips/analyze', 'POST', { prompt: 'seventh' });
  expect(seventh.status).toBe(409); expect(seventh.body.code).toBe('GUEST_TRIP_LIMIT_REACHED');
  await page.getByRole('button', { name: /^Delete trip Barcelona/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete trip', exact: true }).click();
  await expect(page.getByLabel('Guest usage')).toContainText('Trips: 5 / 6');
  await createDraft(page);
  const usage = (await api(page, '/api/guest/usage')).body;
  expect(usage.tripCount).toBe(6); expect(usage.aiGenerationsRemaining).toBe(0);

  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto('http://127.0.0.1:5174/login');
    await other.getByRole('button', { name: 'Continue as guest' }).click();
    await expect(other.getByLabel('Guest usage')).toContainText('Trips: 0 / 6');
    expect((await api(other, `/api/trips/${third}`)).status).toBe(404);
    expect((await api(other, `/api/trips/${third}`, 'DELETE')).status).toBe(404);
    expect((await api(other, '/api/trips')).body).toEqual([]);
  } finally { await context.close(); }
});
