import { test, expect, login } from "./fixtures.ts";

test("guest saves, reloads, sees shared heart state, removes, and starts planning", async ({ page, harness }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/explore");
  await page.getByRole("button", { name: "Save Barcelona", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave Barcelona", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/saved");
  await expect(page.getByText("Barcelona", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Barcelona", { exact: true })).toBeVisible();
  await page.goto("/explore");
  await page.getByRole("button", { name: "Unsave Barcelona", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Save Barcelona", exact: true })).toBeEnabled();
  await page.goto("/saved");
  await expect(page.getByText(/No saved places yet/)).toBeVisible();
  await page.goto("/explore");
  await page.getByRole("button", { name: "Save Barcelona", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave Barcelona", exact: true })).toBeEnabled();
  await page.goto("/saved");
  await page.getByRole("button", { name: /Plan a trip/ }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("textbox").first()).toHaveValue("Plan a trip to Barcelona, Spain");
  expect((await harness.state()).calls).toEqual([]);
  const analyzed = page.waitForResponse(response => response.url().endsWith("/api/trips/analyze") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Plan my trip", exact: true }).click();
  const response = await analyzed;
  expect(response.status()).toBe(200);
  expect((await response.json()).analysis).toMatchObject({ destinationId: "city-003", destination: "Barcelona", country: "Spain" });
});

test("expired saved session is rejected and a new guest receives no old saves", async ({ page, harness }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/explore");
  await page.getByRole("button", { name: "Save Barcelona", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave Barcelona", exact: true })).toBeEnabled();
  const session = await page.evaluate(async () => (await fetch("/api/auth/session?identity=1")).json());
  await harness.command("/expire-guest", { guestId: session.guest.id });
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/saved/destinations");
    return { status: response.status, body: await response.json() };
  });
  expect(status.status).toBe(401); expect(status.body.code).toBe("GUEST_SESSION_EXPIRED");
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/saved");
  await expect(page.getByText(/No saved places yet/)).toBeVisible();
});

test("separate browser guests have isolated saved collections", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/explore");
  await page.getByRole("button", { name: "Save Barcelona", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave Barcelona", exact: true })).toBeEnabled();
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto("http://127.0.0.1:5174/login");
    await second.getByRole("button", { name: "Continue as guest" }).click();
    await expect(second).toHaveURL(/\/home$/);
    await second.goto("http://127.0.0.1:5174/saved");
    await expect(second.getByText(/No saved places yet/)).toBeVisible();
    await second.goto("http://127.0.0.1:5174/explore");
    await expect(second.getByRole("button", { name: "Save Barcelona", exact: true })).toBeEnabled();
    await page.goto("/saved");
    await expect(page.getByText("Barcelona", { exact: true })).toBeVisible();
  } finally { await other.close(); }
});

test.describe("authenticated destination cards", () => {
  test.use({ scenario: "future" });
  test("synchronizes Explore, homepage and Saved hearts", async ({ page, user }) => {
    await login(page, user);
    await page.goto("/explore");
    await page.getByRole("button", { name: "Save Rome", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unsave Rome", exact: true })).toBeEnabled();
    await page.getByRole("link", { name: "Triply", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unsave Rome", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Unsave Rome", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save Rome", exact: true })).toBeEnabled();
    await page.goto("/saved");
    await expect(page.getByText(/No saved places yet/)).toBeVisible();
  });
});
