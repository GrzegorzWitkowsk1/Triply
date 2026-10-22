import type { Page } from "@playwright/test";
import { test, expect, login } from "./fixtures.ts";
test.use({ scenario: "editing" });
const preview = (page: Page) => page.getByRole("dialog", { name: "Packing suggestions" });
async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, credentials: "include", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function add(page: Page, name: string, category = "clothing") {
  const form = page.getByRole("form", { name: "Add packing item" });
  await form.getByLabel("Item name").fill(name); await form.getByLabel("Category").selectOption(category);
  await form.getByRole("button", { name: "Add item" }).click();
  await expect(form.getByLabel("Item name")).toHaveValue(""); await expect(page.getByRole("checkbox", { name, exact: true })).toBeVisible();
}
async function generate(page: Page) {
  await page.getByRole("button", { name: /Generate packing list|Refresh suggestions/ }).click();
  await expect(preview(page).getByText(/^Review every suggestion/)).toBeVisible();
}
async function applySelected(page: Page) {
  await preview(page).getByRole("button", { name: /Add \d+ selected items/ }).click();
  await expect(preview(page)).toBeHidden();
}
test("smart refresh follows a real itinerary edit and preserves packed manual items", async ({ page, user, harness }) => {
  await harness.command("/packing-smart-fixtures"); await login(page, user); await page.goto(`/trips/${user.tripId}/equipment`);
  await add(page, "Rain jacket"); await page.getByRole("checkbox", { name: "Rain jacket", exact: true }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await generate(page); await expect(preview(page).getByRole("checkbox", { name: /^Rain jacket,/ })).toBeDisabled();
  await expect(preview(page).getByText(/5 suggestions found: 4 new items, 1 already on your list, 0 possible duplicates/)).toBeVisible();
  await applySelected(page); await expect(page.getByRole("checkbox", { name: "Rain jacket", exact: true })).toBeChecked();
  const existing = await api(page, `/api/trips/${user.tripId}`);
  const first = existing.body.itinerary.days[0].stops[0];
  const changed = await api(page, `/api/trips/${user.tripId}/itinerary/edit`, "POST", { expectedVersion: existing.body.itineraryVersion, operation: { type: "remove", dayIndex: 1, attractionId: first.placeId } });
  expect(changed.status, JSON.stringify(changed.body)).toBe(200);
  await page.goto("/trips"); await page.goto(`/trips/${user.tripId}/equipment`);
  await expect(page.getByText(/Your trip has changed since these suggestions were generated/)).toBeVisible();
  const before = (await harness.state()).calls.filter(call => call === "packing").length;
  await page.getByRole("checkbox", { name: "Rain jacket", exact: true }).click(); await expect(page.getByRole("checkbox", { name: "Rain jacket", exact: true })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Rain jacket", exact: true }).click(); await expect(page.getByRole("checkbox", { name: "Rain jacket", exact: true })).toBeChecked();
  expect((await harness.state()).calls.filter(call => call === "packing")).toHaveLength(before);
  await generate(page); await expect(preview(page).getByText("All suggested items are already on your list.")).toBeVisible();
  await preview(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/Your trip has changed since these suggestions were generated/)).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Rain jacket", exact: true })).toBeChecked();
  const data = await harness.trip(user.tripId!); expect(data.equipment.find(item => item.name === "Rain jacket")).toMatchObject({ packed: true, source: "manual", count: 1 });
  expect(data.equipment.find(item => item.name === "Walking shoes")).toMatchObject({ source: "ai" });
});
test("possible duplicate review supports skipping and explicit add anyway across all viewport widths", async ({ page, user, harness }) => {
  await harness.command("/packing-smart-fixtures"); await login(page, user); await page.goto(`/trips/${user.tripId}/equipment`);
  await add(page, "Waterproof jacket"); await generate(page);
  await expect(preview(page).getByText("Similar to an item already on your list.")).toBeVisible();
  await expect(preview(page).getByRole("checkbox", { name: /^Rain jacket,/ })).not.toBeChecked();
  await preview(page).getByText("View matching Rain jacket items").click(); await expect(preview(page).getByText(/Waterproof jacket - Clothing, quantity 1, to pack/)).toBeVisible();
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await preview(page).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const overflow = await preview(page).evaluate(node => node.scrollWidth <= node.clientWidth); expect(overflow).toBe(true);
  }
  const clothing = preview(page).getByRole("region", { name: "Clothing suggestions" });
  const toggle = clothing.getByRole("button", { name: /Clothing, \d+ suggestions/ });
  await toggle.focus(); await page.keyboard.press("Enter"); await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space"); await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const why = preview(page).getByText("Why Rain jacket?"); await why.focus(); await page.keyboard.press("Enter");
  await expect(preview(page).getByText(/A general weather-protective layer/)).toBeVisible();
  await applySelected(page); await expect(page.getByRole("checkbox", { name: "Rain jacket", exact: true })).toHaveCount(0);
  await generate(page); await preview(page).getByRole("button", { name: "Add Rain jacket anyway" }).click();
  await expect(preview(page).getByRole("button", { name: "Add 1 selected items" })).toBeEnabled(); await applySelected(page);
  await page.reload(); await expect(page.getByRole("checkbox", { name: "Rain jacket", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Waterproof jacket", exact: true })).toBeVisible();
});
test("bulk actions respect filters and collapsed categories and survive reload without AI usage", async ({ page, user, harness }) => {
  await login(page, user); await page.goto(`/trips/${user.tripId}/equipment`);
  await add(page, "Rain jacket"); await add(page, "T-shirt"); await add(page, "Passport", "documents");
  await page.getByRole("checkbox", { name: "Passport", exact: true }).click(); await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  await page.getByRole("button", { name: "To pack", exact: true }).click();
  await page.getByRole("button", { name: "Pack visible unpacked items" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm packing change" }).click();
  await expect(page.getByRole("dialog")).toBeHidden(); await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByText("You are all packed!")).toBeVisible();
  await page.getByRole("button", { name: "Packed", exact: true }).click();
  await page.getByRole("region", { name: "Documents", exact: true }).getByRole("button", { name: /Documents/ }).click();
  await page.getByRole("button", { name: "Unpack visible packed items" }).click();
  await expect(page.getByRole("dialog").getByRole("heading")).toContainText("2");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm packing change" }).click();
  await expect(page.getByRole("dialog")).toBeHidden(); await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  await page.reload(); await expect(page.getByRole("checkbox", { name: "Passport", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Rain jacket", exact: true })).not.toBeChecked();
  expect((await harness.state()).calls).not.toContain("packing");
});
test("guest identity switching clears previews and rejects another owner's signed reference", async ({ page, user, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click(); await expect(page.getByText("Guest", { exact: true })).toBeVisible();
  const session = await api(page, "/api/auth/session?identity=1"); const { tripId } = await harness.command<{ tripId: string }>("/guest-attraction-trip", { guestId: session.body.guest.id });
  await page.goto(`/trips/${tripId}/equipment`);
  const generated = page.waitForResponse(response => response.url().endsWith("/equipment/generate") && response.request().method() === "POST");
  await generate(page); const original = await (await generated).json();
  // Changing session through real authentication endpoints dispatches the existing cross-tab restoration path.
  expect((await api(page, "/api/auth/logout", "POST")).status).toBe(204);
  expect((await api(page, "/api/auth/guest", "POST")).status).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("triply:session-expired")));
  await expect(preview(page)).toHaveCount(0);
  await page.goto("/trips");
  const denied = await api(page, `/api/trips/${tripId}/equipment/apply`, "POST", { token: original.token, selectedIds: [original.suggestions[0].id] }); expect(denied.status).toBe(404);
  await login(page, user); await expect(preview(page)).toHaveCount(0);
  expect((await api(page, `/api/trips/${tripId}/equipment/apply`, "POST", { token: original.token, selectedIds: [original.suggestions[0].id] })).status).toBe(404);
});
