import { test, expect, login, openTrip } from "./fixtures.ts";

test.use({ scenario: "journey", locale: "en-US" });

test("two tabs converge Journey locks and Budget without provider enrichment or sensitive broadcasts", async ({ page, context, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  const other = await context.newPage();
  try {
    await other.clock.install({ time: new Date(user.now) });
    await openTrip(other, user.tripId!);
    await expect(other.getByRole("button", { name: "Edit Barcelona Cathedral", exact: true })).toBeEnabled();
    await other.evaluate(() => {
      const messages: unknown[] = [];
      Object.assign(window, { recoveryMessages: messages });
      const channel = new BroadcastChannel("triply:mutable-data:v1");
      channel.onmessage = event => messages.push(event.data);
      window.addEventListener("pagehide", () => channel.close(), { once: true });
    });
    const before = await harness.state();
    await page.bringToFront();
    await page.getByRole("button", { name: "Journey mode", exact: true }).click();
    await page.getByRole("button", { name: "Mark Barcelona Cathedral as visited", exact: true }).click();
    await expect(page.getByText(/Visited · .*60.* added to expenses/)).toBeVisible();
    await other.bringToFront();
    await expect(other.getByRole("button", { name: "Edit Barcelona Cathedral", exact: true })).toBeDisabled();
    await expect(other.getByRole("button", { name: "Reorder Barcelona Cathedral", exact: true })).toBeDisabled();
    await expect(other.getByRole("button", { name: "Correct expense for Barcelona Cathedral", exact: true })).toHaveCount(1);
    await expect.poll(() => other.evaluate(() => Reflect.get(window, "recoveryMessages"))).toEqual(["invalidate"]);
    await page.bringToFront();
    await page.getByRole("button", { name: "Correct expense for Barcelona Cathedral", exact: true }).click();
    const correction = page.getByRole("dialog", { name: "Correct admission expense" });
    await correction.getByRole("textbox", { name: "Amount", exact: true }).fill("50.00");
    await correction.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(correction).toHaveCount(0);
    await other.bringToFront();
    const expenses = other.getByRole("list", { name: "Expenses", exact: true });
    await expect(expenses.locator("li").filter({ hasText: "Barcelona Cathedral" })).toContainText("€50.00");
    await expect(other.getByRole("button", { name: "Correct expense for Barcelona Cathedral", exact: true })).toHaveCount(1);
    const stored = await harness.trip(user.tripId!);
    expect(stored.expenses.filter(expense => expense.automaticSource)).toHaveLength(1);
    expect(stored.expenses.find(expense => expense.automaticSource)).toMatchObject({ amountMinor: 5000, automaticSource: { postedAmountMinor: 6000 } });
    const after = await harness.state();
    expect(after.calls).toEqual(before.calls);
  } finally { await other.close(); }
});
