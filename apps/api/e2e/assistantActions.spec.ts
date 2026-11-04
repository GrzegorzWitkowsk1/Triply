import { test, expect, login, openTrip } from "./fixtures.ts";
import AxeBuilder from "@axe-core/playwright";

test.use({ scenario: "future" });

test("packing requests redirect without exposing packing tools or changing the checklist", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  const before = await harness.trip(user.tripId!); const calls = (await harness.state()).calls.filter(call => call === "assistant").length;
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await page.locator(".assistant-input").fill("Add Umbrella to my packing list"); await page.locator(".assistant-input").press("Enter");
  await expect(page.locator(".assistant-bubble.is-ai").last()).toContainText("separate Packing Assistant");
  await expect(page.locator(".assistant-proposal")).toHaveCount(0);
  expect((await harness.trip(user.tripId!)).equipment).toEqual(before.equipment);
  expect((await harness.state()).calls.filter(call => call === "assistant")).toHaveLength(calls);
});

test("expense proposal requires confirmation, clears input, and survives a lost response", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  const before = await harness.trip(user.tripId!);
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  const input = page.locator(".assistant-input");
  await input.fill("Add 25 EUR for lunch"); await input.press("Enter");
  await expect(input).toHaveValue("");
  const card = page.locator(".assistant-proposal").last();
  await expect(card).toContainText("Awaiting confirmation");
  await expect(card).toContainText("25.00");
  expect((await new AxeBuilder({ page }).include(".assistant-panel").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect((await harness.trip(user.tripId!)).expenses).toEqual(before.expenses);
  expect((await harness.trip(user.tripId!)).equipment).toEqual(before.equipment);
  await input.fill("What is my remaining budget?"); await input.press("Enter");
  await expect(page.locator(".assistant-bubble.is-ai").last()).toContainText("Actual unspent budget:");
  await expect(page.locator(".assistant-proposal")).toHaveCount(1);
  await expect(card).toContainText("Awaiting confirmation");
  expect((await harness.trip(user.tripId!)).expenses).toEqual(before.expenses);
  let lost = false;
  await page.route("**/assistant/actions/*/apply", async route => {
    if (!lost) { lost = true; await route.fetch(); return route.abort("failed"); }
    return route.continue();
  });
  await card.getByRole("button", { name: "Confirm changes", exact: true }).click();
  // The receipt is persisted with the domain changes. Refetch reveals completion
  // despite losing the HTTP response; replaying the same ID cannot duplicate it.
  await expect(card).toContainText("Changes saved");
  await expect(card.getByRole("alert")).toHaveCount(0);
  // A recovered receipt must refresh the visible domain data too, before reload.
  await expect(page.locator(".budget-expenses .budget-expense-title").filter({ hasText: /^Lunch$/ })).toHaveCount(before.expenses.filter(e => e.title === "Lunch").length + 1);
  const after = await harness.trip(user.tripId!);
  expect(after.expenses).toHaveLength(before.expenses.length + 1);
  expect(after.equipment).toEqual(before.equipment);
  expect(after.itinerary).toEqual(before.itinerary);
  await page.reload(); await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await expect(page.locator(".assistant-proposal")).toContainText("Changes saved");
  expect((await harness.trip(user.tripId!)).expenses).toHaveLength(after.expenses.length);
});

test("itinerary preview supports keyboard confirmation, cancellation and scheduling conflicts", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  const before = await harness.trip(user.tripId!);
  const name = before.itinerary!.days[0].activities.find(a => a.type === "attraction")!.title;
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  const input = page.locator(".assistant-input");
  await input.fill(`Move ${name} to 15:00`); await input.press("Enter");
  const first = page.locator(".assistant-proposal").last();
  await expect(first).toContainText("Awaiting confirmation");
  await first.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(first).toContainText("Cancelled");
  expect((await harness.trip(user.tripId!)).itinerary).toEqual(before.itinerary);
  await input.fill(`Move ${name} to 23:00`); await input.press("Enter");
  await expect(page.locator(".assistant-proposal").last()).toContainText("Changes blocked");
  await expect(page.locator(".assistant-proposal").last().getByRole("button", { name: "Confirm changes" })).toHaveCount(0);
  await input.fill(`Remove ${name}`); await input.press("Enter");
  const final = page.locator(".assistant-proposal").last();
  const confirm = final.getByRole("button", { name: "Confirm changes", exact: true });
  await expect(confirm).toBeEnabled(); await confirm.focus(); await page.keyboard.press("Enter");
  await expect(final).toContainText("Changes saved");
  expect((await harness.trip(user.tripId!)).itineraryVersion).toBe(before.itineraryVersion + 1);
});

test("mobile Polish preview stays within the viewport and does not execute on language change", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  await page.getByRole("button", { name: /^Language:/ }).click();
  await page.getByRole("menuitemradio", { name: "Polski", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByRole("button", { name: /Ask Triply|Zapytaj Triply/, exact: true }).click();
  const before = await harness.trip(user.tripId!);
  await page.locator(".assistant-input").fill("Dodaj 25 EUR za obiad"); await page.locator(".assistant-input").press("Enter");
  const card = page.locator(".assistant-proposal").last();
  await expect(card).toContainText("Oczekuje na potwierdzenie");
  await expect(card).toContainText("25,00");
  const box = await card.boundingBox(); expect(box!.width).toBeLessThanOrEqual(360);
  expect((await harness.trip(user.tripId!)).equipment).toEqual(before.equipment);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  const calls = (await harness.state()).calls.filter(c => c === "assistant").length;
  await page.getByRole("button", { name: /^Język:/ }).click();
  await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await expect(card).toContainText("Awaiting confirmation");
  expect((await harness.state()).calls.filter(c => c === "assistant")).toHaveLength(calls);
  expect((await harness.trip(user.tripId!)).equipment).toEqual(before.equipment);
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("stale confirmation preserves newer edits and provider failures remain recoverable", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  const before = await harness.trip(user.tripId!);
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  const input = page.locator(".assistant-input");
  await input.fill("Add 25 EUR for lunch"); await input.press("Enter");
  const card = page.locator(".assistant-proposal").last();
  await expect(card).toContainText("Awaiting confirmation");
  const attraction = before.itinerary!.days[0].activities.find(a => a.type === "attraction")!;
  const status = await page.evaluate(async ({ id, version, attractionId, day }) => {
    const result = await fetch(`/api/trips/${id}/itinerary/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version, operation: { type: "remove", attractionId, dayIndex: day } }) });
    return result.status;
  }, { id: user.tripId!, version: before.itineraryVersion, attractionId: attraction.placeId!, day: before.itinerary!.days[0].dayIndex });
  expect(status).toBe(200);
  await card.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(card).toContainText("Data changed");
  const current = await harness.trip(user.tripId!);
  expect(current.expenses).toEqual(before.expenses); expect(current.itineraryVersion).toBe(before.itineraryVersion + 1);
  await input.fill("Add provider failure"); await input.press("Enter");
  await expect(page.locator(".assistant-bubble.is-ai").last()).toContainText("busy");
  await expect(input).toHaveValue("Add provider failure"); await expect(page.locator(".assistant-typing")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry message", exact: true })).toBeEnabled();
});
