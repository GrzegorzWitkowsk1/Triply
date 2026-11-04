import { test, expect, login, openTrip } from "./fixtures.ts";
import { analysis } from "./data.ts";
test.use({ scenario: "editing" });

test("assistant handles ten keyboard turns, duplicate sends, navigation and recoverable errors", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  const before = await harness.trip(user.tripId!);
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await expect(page.locator(".assistant-typing")).toHaveCount(0);
  const initialCalls = (await harness.state()).calls.filter(c => c === "assistant").length;
  const field = page.getByRole("textbox", { name: "Message Triply" });
  for (let turn = 1; turn <= 10; turn++) {
    await field.fill(turn === 1 ? "What is planned on Day 2?" : `What does that day cost? Question ${turn}`);
    const sent = page.waitForResponse(r => r.url().endsWith("/assistant/messages"));
    await field.press("Enter"); await field.press("Enter");
    const response = await sent; expect(response.status()).toBe(200);
    await expect(page.locator(".assistant-bubble.is-ai").last()).toContainText(`Turn ${turn}.`);
    await expect(field).toHaveValue(""); await expect(page.locator(".assistant-typing")).toHaveCount(0);
  }
  expect((await harness.state()).calls.filter(c => c === "assistant").length - initialCalls).toBe(10);
  await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  await page.goto("/trips"); await openTrip(page, user.tripId!);
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await expect(page.locator(".assistant-bubble.is-ai").last()).toContainText("Turn 10.");
  let failed = false;
  await page.route("**/assistant/messages", route => {
    if (!failed) { failed = true; return route.abort("failed"); }
    return route.continue();
  });
  await field.fill("Keep this failed draft"); await field.press("Enter");
  await expect(page.locator(".assistant-panel").getByRole("alert")).toBeVisible(); await expect(field).toHaveValue("Keep this failed draft");
  await expect(page.locator(".assistant-typing")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry message", exact: true }).click();
  await expect(page.locator(".assistant-bubble.is-ai").last()).toContainText("Turn 11.");
  await expect(page.getByText("Keep this failed draft", { exact: true })).toHaveCount(1);
  const after = await harness.trip(user.tripId!);
  expect(after.itinerary).toEqual(before.itinerary); expect(after.expenses).toEqual(before.expenses); expect(after.equipment).toEqual(before.equipment);
});

test("mobile assistant contains the chat, sends follow-ups and preserves history after closing", async ({ page, user }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page, user); await openTrip(page, user.tripId!);
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Ask Triply about Barcelona" });
  await expect(panel).toBeVisible();
  // clientWidth avoids floating-point transform rounding (e.g. 360.00003px).
  expect(await panel.evaluate(element => element.clientWidth)).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const [index, text] of ["Day 2?", "And that museum?"].entries()) {
    await panel.getByRole("textbox").fill(text); await panel.getByRole("textbox").press("Enter");
    await expect(panel.locator(".assistant-bubble.is-ai").last()).toContainText(`Turn ${index + 1}.`);
  }
  await page.keyboard.press("Escape"); await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await expect(panel.locator(".assistant-bubble.is-ai").last()).toContainText("Turn 2.");
});

test("assistant conversations remain isolated when switching between two owned trips", async ({ page, user }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await page.locator(".assistant-input").fill("Tell me about Day 2 in the first trip");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await page.locator(".assistant-input").press("Enter");
  await expect(page.locator(".assistant-bubble.is-ai").last()).toContainText("Turn 1.");
  const secondId = await page.evaluate(async answers => {
    const send = async (url: string, method: string, body?: unknown) => {
      const response = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new Error(`Fixture trip request failed: ${response.status}`);
      return response.json();
    };
    const draft = await send("/api/trips/analyze", "POST", { prompt: "A second trip to Barcelona" });
    await send(`/api/trips/${draft.draftId}/requirements`, "PATCH", { answers, confirmedFields: [] });
    await send(`/api/trips/${draft.draftId}/generate`, "POST");
    return draft.draftId as string;
  }, analysis());
  await openTrip(page, secondId);
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await expect(page.locator(".assistant-typing")).toHaveCount(0);
  await expect(page.locator(".assistant-panel")).not.toContainText("in the first trip");
  await page.locator(".assistant-input").fill("Tell me about Day 1 in the second trip");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await page.locator(".assistant-input").press("Enter");
  await expect(page.locator(".assistant-bubble.is-ai").last()).toContainText("Turn 1.");
  await openTrip(page, user.tripId!);
  await page.getByRole("button", { name: "Ask Triply", exact: true }).click();
  await expect(page.locator(".assistant-panel")).toContainText("in the first trip");
  await expect(page.locator(".assistant-panel")).not.toContainText("in the second trip");
});
