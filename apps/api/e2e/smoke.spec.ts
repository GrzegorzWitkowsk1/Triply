import { test, expect, login, openTrip, timelineNames } from "./fixtures.ts";
import type { TripDetail, ItineraryEditResponse } from "@triply/shared";

test("real login, cookie persistence, credentialed CORS and logout", async ({ page, user, harness }) => {
  await page.goto("/trips");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel(/^Password/).fill("IncorrectPassword123!");
  const invalid = page.waitForResponse(r => r.url().endsWith("/api/auth/login"));
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await invalid).status()).toBe(401);
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
  await login(page, user);
  const cookie = (await page.context().cookies()).find(c => c.name === "triply.sid");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  expect((await harness.state()).sessions).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  // Browser fetch performs an actual preflight (JSON + custom header) across
  // Vite -> Fastify origins; credentials use the real MongoDB session.
  const validation = await page.evaluate(async () => {
    const response = await fetch("http://127.0.0.1:4001/api/trips/analyze", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-E2E-Probe": "1" }, body: JSON.stringify({ prompt: 123 }),
    });
    return { status: response.status, body: await response.json() };
  });
  await expect.poll(async () => (await harness.state()).preflights.find(r => r.path === "/api/trips/analyze")).toMatchObject({
    status: 204, origin: "http://127.0.0.1:5174", credentials: "true",
  });
  expect(validation.status).toBe(400);
  expect(validation.body.error).toEqual(expect.any(String));
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await harness.state()).sessions).toBe(0);
  expect((await page.context().cookies()).some(c => c.name === "triply.sid")).toBe(false);
  // Replay the previous signed cookie: logout must invalidate server state too.
  await page.context().addCookies([cookie!]);
  const protectedStatus = await page.evaluate(async () => (await fetch("/api/trips", { credentials: "include" })).status);
  expect(protectedStatus).toBe(401);
  await page.goto("/trips");
  await expect(page).toHaveURL(/\/login$/);
});

test("Barcelona requirements, creation and real generation survive reload", async ({ page, user, harness }) => {
  await login(page, user);
  await page.getByPlaceholder(/4 days in Barcelona/).fill("Barcelona, Spain: three days, 500 EUR, food, architecture and history.");
  await page.getByRole("button", { name: "Plan my trip" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Where are you going?").fill("Barcelona");
  await dialog.getByLabel("Which country is that in?").fill("Spain");
  await dialog.getByLabel("How many days do you have?").fill("3");
  await dialog.getByLabel("When does the trip start?").fill("2030-06-02");
  await expect(dialog.getByLabel("When does the trip end?")).toHaveValue("2030-06-04");
  await dialog.getByLabel("How many people will travel?").fill("1");
  await dialog.getByRole("button", { name: "Something else" }).click();
  await dialog.getByLabel("My budget").fill("500");
  await dialog.getByRole("button", { name: "Food", exact: true }).click();
  await dialog.getByRole("button", { name: "Architecture", exact: true }).click();
  await dialog.getByLabel("Add your own").fill("history");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  const requirements = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith("/requirements"));
  await dialog.getByRole("button", { name: "Continue" }).click();
  const saved = await requirements;
  expect(saved.status()).toBe(200);
  const draft = await saved.json() as { draftId: string };
  const before = await harness.trip(draft.draftId);
  expect(before.analysis).toMatchObject({ destination: "Barcelona", country: "Spain", durationDays: 3,
    budget: { amount: 500, currency: "EUR", type: "total" }, interests: ["food", "architecture", "history"], location: { lat: 41.38, lng: 2.17 } });
  await harness.command("/hold", { provider: "routing" });
  const generation = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/generate"));
  await page.getByRole("button", { name: "Generate my trip" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${draft.draftId}$`));
  await expect(page.getByLabel("Preparing your itinerary")).toBeVisible();
  await harness.command("/release", { provider: "routing" });
  const response = await generation;
  expect(response.status()).toBe(200);
  const detail = await response.json() as TripDetail;
  expect(detail.status).toBe("ready");
  expect(detail.itinerary!.days).toHaveLength(3);
  expect(detail.itinerary!.days.every(day => day.activities.some(a => a.type === "attraction" && /T\d\d:\d\d/.test(a.startTime)))).toBe(true);
  await expect(page.getByText("Day 1 of 3", { exact: true })).toBeVisible();
  await expect(timelineNames(page).first()).toBeVisible();
  for (const day of detail.itinerary!.days) {
    await expect(page.getByText(`Day ${day.dayIndex} of 3`, { exact: true })).toBeVisible();
    await expect(timelineNames(page)).toHaveCount(day.stops.length);
    const scheduled = day.activities.find(a => a.type === "attraction")!;
    await expect(page.getByText(scheduled.startTime.slice(11, 16), { exact: true }).first()).toBeVisible();
    if (day.dayIndex < 3) await page.getByRole("button", { name: "Next day" }).click();
  }
  const stored = await harness.trip(detail.id);
  expect(stored.itineraryVersion).toBe(1);
  expect(stored.itinerary!.days).toHaveLength(3);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Barcelona");
  await expect(page).toHaveURL(/day=3/);
  await expect(page.getByRole("tab").nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(timelineNames(page)).toHaveCount(detail.itinerary!.days[2]!.stops.length);
  for (const stop of detail.itinerary!.days[2]!.stops) await expect(page.getByRole("button", { name: `Reorder ${stop.name}`, exact: true })).toBeVisible();
  expect((await harness.trip(detail.id)).analysis).toEqual(before.analysis);
  expect((await harness.state()).calls).toEqual(expect.arrayContaining(["ai", "geocoding", "weather", "overpass", "routing"]));
});

test.describe("Prague recovery", () => {
  test.use({ scenario: "prague" });
  test("missing coordinates are resolved and saved by the real generation endpoint", async ({ page, user, harness }) => {
    await login(page, user);
    expect((await harness.trip(user.tripId!)).analysis.location).toBeNull();
    await openTrip(page, user.tripId!);
    await harness.command("/hold", { provider: "geocoding" });
    const generating = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/generate"));
    await page.getByRole("button", { name: "Generate my trip", exact: true }).click();
    await expect(page.getByLabel("Preparing your itinerary")).toBeVisible();
    await harness.command("/release", { provider: "geocoding" });
    expect((await generating).status()).toBe(200);
    await expect(page.getByText("Day 1 of 3", { exact: true })).toBeVisible();
    const stored = await harness.trip(user.tripId!);
    expect(stored.analysis.location).toMatchObject({ lat: 50.08, lng: 14.43 });
    expect(stored.status).toBe("ready");
    expect(stored.attractions.every(p => p.source === "geoapify")).toBe(true);
    expect((await harness.state()).calls).toEqual(expect.arrayContaining(["geocoding", "overpass", "geoapify", "routing"]));
    await expect(page.getByText("Trip is missing a destination or duration")).toHaveCount(0);
    await page.reload();
    await expect(timelineNames(page).first()).toBeVisible();
    expect((await harness.trip(user.tripId!)).itinerary).toEqual(stored.itinerary);
  });
});

test.describe("weather recovery", () => {
  test.use({ scenario: "weather" });
  test("provider outage, cooldown and UI retry update only weather", async ({ page, user, harness }) => {
    await login(page, user);
    await openTrip(page, user.tripId!);
    await expect(page.getByRole("status").filter({ hasText: /temporarily unavailable/i })).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry weather", exact: true });
    await expect(retry).toBeDisabled();
    expect((await harness.state()).calls.filter(c => c === "weather")).toHaveLength(3);
    const before = await harness.trip(user.tripId!);
    await harness.advance(page);
    await expect(retry).toBeEnabled();
    await harness.command("/hold", { provider: "weather" });
    const refreshing = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/weather/refresh"));
    await retry.click();
    await expect(page.getByRole("button", { name: /Retrying weather/ })).toBeVisible();
    await harness.command("/release", { provider: "weather" });
    expect((await refreshing).status()).toBe(200);
    await expect(page.getByText(/24°/).first()).toBeVisible();
    const after = await harness.trip(user.tripId!);
    expect(after.weather).toHaveLength(3);
    expect(after.weatherAvailability!.status).toBe("available");
    for (const key of ["itinerary", "itineraryVersion", "analysis", "expenses", "budgetRevision", "generation"] as const) expect(after[key]).toEqual(before[key]);
    expect((await harness.state()).calls.filter(c => c === "routing")).toHaveLength(0);
    await page.reload();
    await expect(page.getByText(/24°/).first()).toBeVisible();
    expect((await harness.trip(user.tripId!)).weather).toEqual(after.weather);
  });
});

test.describe("forecast horizon", () => {
  test.use({ scenario: "future" });
  test("Rome dates beyond the horizon do not fabricate a forecast", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    await expect(page.getByRole("status").filter({ hasText: "Forecast will be available from" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry weather", exact: true })).toBeDisabled();
    const trip = await harness.trip(user.tripId!);
    expect(trip.weather).toEqual([]);
    expect(trip.weatherAvailability!.status).toBe("not_yet_available");
    expect((await harness.state()).calls).not.toContain("weather");
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Forecast will be available from" })).toBeVisible();
  });
});

test.describe("manual editing", () => {
  test.use({ scenario: "editing" });
  test("removal and keyboard reorder persist without erasing another day's diagnostics", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    const before = await harness.trip(user.tripId!);
    await page.getByRole("button", { name: "Edit SITAKE YA", exact: true }).click();
    const removed = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/itinerary/edit"));
    await page.getByRole("menuitem", { name: "Remove attraction" }).click();
    expect((await removed).status()).toBe(200);
    await expect(page.getByRole("button", { name: "Edit SITAKE YA", exact: true })).toHaveCount(0);
    await expect(timelineNames(page)).toHaveCount(3);
    const handle = page.getByRole("button", { name: "Reorder Barcelona Cathedral", exact: true });
    await expect(handle).toBeEnabled();
    await handle.focus(); await handle.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await handle.press("ArrowDown");
    await expect(page.getByText("Barcelona Cathedral moved to position 2 of 3.", { exact: true })).toBeAttached();
    const reordered = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/itinerary/edit"));
    await handle.press("Space");
    const response = await reordered;
    expect(response.status()).toBe(200);
    const result = await response.json() as ItineraryEditResponse;
    expect(result.warnings.join(" ")).toContain("Schedule unresolved");
    await expect(page.getByRole("alert").filter({ hasText: "Review this day's schedule before continuing." }).first()).toBeVisible();
    const after = await harness.trip(user.tripId!);
    expect(after.itinerary!.days[0]!.stops.map(p => p.placeId)).toEqual(["node/1001", "node/1000", "node/1002"]);
    expect(after.itinerary!.days.slice(1)).toEqual(before.itinerary!.days.slice(1));
    expect(after.itinerary!.unscheduled.filter(p => p.dayIndex === 2)).toEqual(before.itinerary!.unscheduled);
    expect(after.expenses).toEqual(before.expenses);
    await page.reload();
    await expect(timelineNames(page)).toHaveCount(3);
    await expect(timelineNames(page).nth(0)).toHaveAccessibleName("Reorder Palau de la Musica");
    await expect(timelineNames(page).nth(1)).toHaveAccessibleName("Reorder Barcelona Cathedral");
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page.getByRole("region", { name: "Schedule and route checks" }).getByRole("alert").filter({ hasText: /Roman Walls:.*This visit has no feasible scheduled time/ })).toBeVisible();
    expect((await harness.trip(user.tripId!)).itinerary).toEqual(after.itinerary);
  });
});

test.describe("route recalculation", () => {
  test.use({ scenario: "conflict" });
  test("existing conflicts permit rerouting and unknown hours remain usable", async ({ page, user, harness }) => {
    await login(page, user); await openTrip(page, user.tripId!);
    const before = await harness.trip(user.tripId!);
    await expect(page.getByRole("alert").first()).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeEnabled();
    await harness.command("/hold", { provider: "routing" });
    const rerouted = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/itinerary/edit"));
    await retry.click();
    await expect(page.getByRole("status").filter({ hasText: "Saving itinerary" })).toBeVisible();
    await harness.command("/release", { provider: "routing" });
    expect((await rerouted).status()).toBe(200);
    await expect(page.getByRole("alert").filter({ hasText: "Review this day's schedule before continuing." }).first()).toBeVisible();
    const after = await harness.trip(user.tripId!);
    const day = after.itinerary!.days[0]!;
    expect(day.stops.map(p => p.placeId)).toEqual(before.itinerary!.days[0]!.stops.map(p => p.placeId));
    expect(day.activities.find(a => a.placeId === "node/1004" && a.type === "attraction")).toMatchObject({ openingHoursCheck: { status: "unknown" } });
    expect(day.activities.find(a => a.placeId === "node/1002" && a.type === "attraction")).toMatchObject({ schedulingStatus: "unresolved" });
    expect(day.activities.filter(a => ["node/1000", "node/1001"].includes(a.placeId ?? "") && a.type === "attraction").every(a => a.startTime.slice(11, 16) >= "13:30")).toBe(true);
    expect(day.geometry).not.toBeNull();
    expect(after.itineraryVersion).toBe(before.itineraryVersion + 1);
    expect(after.expenses).toEqual(before.expenses);
    await page.reload();
    await expect(page.getByRole("button", { name: "Edit SITAKE YA", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    expect((await harness.trip(user.tripId!)).itinerary).toEqual(after.itinerary);
  });
});
