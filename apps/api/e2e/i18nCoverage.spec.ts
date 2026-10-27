import type { Page } from "@playwright/test";
import { test, expect, login, openTrip } from "./fixtures.ts";

test.use({ locale: "en-US", scenario: "editing" });
const widths = [320, 375, 768, 1024, 1440];
async function language(page: Page, code: "en" | "pl") {
  await page.getByRole("button", { name: /^(Language|Język):/ }).first().click();
  await page.getByRole("menuitemradio", { name: code === "pl" ? "Polski" : "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", code);
}
async function responsive(page: Page) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), `overflow at ${width}px: ${page.url()}`).toBeLessThanOrEqual(width);
  }
}
async function noMissingKeys(page: Page) {
  // Deliberately scoped to UI chrome: persisted/user/provider content is excluded.
  for (const selector of ["header", "nav", ".MuiDialogActions-root"]) {
    for (const text of await page.locator(selector).allTextContents()) expect(text).not.toMatch(/\b(?:common|trips|packing|auth|explore|errors):[\w.]+|\{\{|\$t\(/);
  }
  const wrongLabels = await page.locator("html").getAttribute("lang") === "pl"
    ? ["Sign out", "Continue as guest", "Create account", "My Trips", "Explore", "Saved", "Send message", "Close assistant", "Add item", "Add expense", "Export to Calendar", "Download PDF", "Try again", "Search destinations", "Expense name", "Quantity", "Category"]
    : ["Wyloguj się", "Kontynuuj jako gość", "Utwórz konto", "Moje podróże", "Odkrywaj", "Zapisane", "Wyślij wiadomość", "Dodaj rzecz", "Dodaj wydatek", "Eksportuj do kalendarza", "Spróbuj ponownie"];
  const labels = await page.locator("button, nav a, label, input, [aria-label]").evaluateAll(elements => elements
    .filter(element => element.getClientRects().length > 0)
    .flatMap(element => [element.textContent, element.getAttribute("aria-label"), element.getAttribute("placeholder")])
    .filter((text): text is string => Boolean(text)).map(text => text.trim().replace(/\s*\*$/, "")));
  for (const label of wrongLabels) expect(labels, `unexpected UI label ${label}`).not.toContain(label);
}

for (const route of [
  { path: "/home", en: "Plan a trip you’ll actually enjoy.", pl: "Zaplanuj podróż, która sprawi Ci przyjemność." },
  { path: "/trips", en: "My trips", pl: "Moje podróże" },
  { path: "/explore", en: "Where to next?", pl: "Dokąd teraz?" },
  { path: "/explore/collections/food-first-weekends", en: "Food-first weekends", pl: "Kulinarne weekendy" },
  { path: "/saved", en: "Saved places", pl: "Zapisane miejsca" },
  { path: "/notifications", en: "Notifications", pl: "Powiadomienia" },
  { path: "/profile", en: "Settings", pl: "Ustawienia" },
]) test(`route locale and responsive coverage: ${route.path}`, async ({ page, user, harness }) => {
  await login(page, user);
  await page.goto(route.path);
  await expect(page.getByRole("heading", { name: route.en, exact: true }).first()).toBeVisible();
  await responsive(page);
  const url = page.url();
  const calls = (await harness.state()).calls;
  await language(page, "pl");
  expect(page.url()).toBe(url);
  await expect(page.getByRole("heading", { name: route.pl, exact: true }).first()).toBeVisible();
  await responsive(page); await noMissingKeys(page);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await expect(page.getByRole("heading", { name: route.pl, exact: true }).first()).toBeVisible();
  if (route.path === "/home") {
    await page.getByRole("textbox", { name: "Opisz podróż" }).fill("Keep this draft");
    await language(page, "en");
    await expect(page.getByRole("textbox", { name: "Describe your trip" })).toHaveValue("Keep this draft");
  } else if (route.path === "/trips") {
    await page.getByRole("button", { name: /^Usuń podróż/ }).first().click();
    await expect(page.getByRole("dialog")).toContainText("Usunąć tę podróż?");
    await page.getByRole("button", { name: "Anuluj", exact: true }).click();
  } else if (route.path === "/explore") {
    await page.getByRole("searchbox", { name: "Szukaj miejsc" }).fill("barce");
    await expect(page.locator("[data-destination-id]")).toHaveCount(1);
  } else if (route.path.includes("/collections/")) {
    await page.getByRole("button", { name: "Zapisz: Barcelona", exact: true }).click();
    await expect(page.getByRole("button", { name: "Usuń z zapisanych: Barcelona", exact: true })).toBeVisible();
  } else if (route.path === "/saved") {
    await page.getByRole("searchbox").fill("no-such-place");
    await expect(page.getByRole("searchbox")).toHaveValue("no-such-place");
  } else if (route.path === "/notifications") {
    await page.getByRole("button", { name: "Nieprzeczytane", exact: true }).click();
    await expect(page.getByRole("button", { name: "Nieprzeczytane", exact: true })).toBeVisible();
  } else {
    await page.getByLabel("Imię", { exact: true }).fill("Draft name");
    await language(page, "en");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Draft name");
  }
  expect((await harness.state()).calls).toEqual(calls);
});

for (const path of ["/login", "/register"]) test(`public auth locale: ${path}`, async ({ page }) => {
  await page.goto(path);
  await expect(page.getByLabel("Email address")).toBeVisible();
  await responsive(page); await language(page, "pl");
  await page.getByLabel("Adres e-mail").fill("keep@example.com");
  await expect(page.getByRole("button", { name: "Pokaż hasło" })).toBeVisible();
  await language(page, "en"); await expect(page.getByLabel("Email address")).toHaveValue("keep@example.com");
  await language(page, "pl"); await responsive(page); await page.reload();
  await expect(page.getByLabel("Adres e-mail")).toBeVisible();
});

test("existing trip, editor, Packing and Expenses preserve data when switching", async ({ page, user, harness }) => {
  await login(page, user); await openTrip(page, user.tripId!);
  const original = await harness.trip(user.tripId!);
  const calls = (await harness.state()).calls;
  const writes: string[] = [];
  page.on("request", request => {
    // Candidate listing is an existing read-only POST; opening the editor legitimately requests it.
    const candidateRead = request.url().endsWith("/itinerary/candidates") && request.postDataJSON()?.discover === false;
    if (/\/api\//.test(request.url()) && request.method() !== "GET" && !candidateRead) writes.push(request.url());
  });
  await responsive(page); await language(page, "pl"); await responsive(page);
  await page.getByRole("button", { name: "Dodaj atrakcję", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Dodaj atrakcję");
  await responsive(page); await page.getByRole("button", { name: "Anuluj", exact: true }).click();
  await page.getByRole("button", { name: "Wydatki według dni" }).click();
  await page.getByRole("textbox", { name: "Nazwa wydatku" }).fill("Unchanged expense draft");
  await language(page, "en");
  await expect(page.getByRole("textbox", { name: "Expense name" })).toHaveValue("Unchanged expense draft");
  await page.goto(`/trips/${user.tripId}/equipment`);
  await expect(page.getByRole("heading", { name: "What to bring", exact: true })).toBeVisible();
  await responsive(page); await language(page, "pl");
  await expect(page.getByRole("heading", { name: "Co zabrać", exact: true })).toBeVisible();
  await responsive(page); await page.reload(); await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await page.getByRole("button", { name: "Dodaj rzecz", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Podaj nazwę rzeczy");
  expect(await harness.trip(user.tripId!)).toEqual(original);
  expect((await harness.state()).calls).toEqual(calls); expect(writes).toEqual([]);
});

test("controlled Explore failure translates and recovers without AI", async ({ page, harness }) => {
  let failed = true;
  await page.route("**/api/destinations?*", route => failed ? route.fulfill({ status: 503, json: { error: "Technical diagnostics must stay hidden" } }) : route.continue());
  await page.goto("/explore");
  await expect(page.getByRole("alert")).toContainText("Could not load destinations");
  await language(page, "pl");
  await expect(page.getByRole("alert")).toContainText("Nie udało się wczytać miejsc");
  await expect(page.getByText("Technical diagnostics must stay hidden")).toHaveCount(0);
  failed = false; await page.getByRole("button", { name: "Spróbuj ponownie", exact: true }).click();
  await expect(page.locator("[data-destination-id]")).toHaveCount(24);
  expect((await harness.state()).calls).toEqual([]);
});

test("shared itinerary and revoked link retain localized UI", async ({ page, user }) => {
  await login(page, user);
  const { token } = await page.evaluate(async id => {
    const response = await fetch(`/api/trips/${id}/sharing`, { method: "POST" });
    if (!response.ok) throw new Error(`Sharing fixture failed: ${response.status}`);
    return response.json();
  }, user.tripId!);
  await page.goto(`/shared/${token}`);
  await expect(page.getByText("Shared itinerary · Read only")).toBeVisible();
  await responsive(page); await language(page, "pl"); await responsive(page);
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await expect(page.getByText("Udostępniony plan · Tylko do odczytu")).toBeVisible();
  const disabled = await page.evaluate(async id => {
    const response = await fetch(`/api/trips/${id}/sharing`, { method: "DELETE" });
    return { status: response.status, body: await response.json() };
  }, user.tripId!);
  expect(disabled.status, JSON.stringify(disabled.body)).toBe(200);
  await page.reload(); await expect(page.getByRole("alert")).toContainText("Ta udostępniona podróż jest niedostępna");
});

test("Polish guest wizard validates and preserves its draft across language switching", async ({ page, harness }) => {
  await page.goto("/login"); await language(page, "pl");
  await page.getByRole("button", { name: "Kontynuuj jako gość" }).click();
  await page.getByRole("textbox", { name: "Opisz podróż" }).fill("Barcelona, Spain: three days.");
  await page.getByRole("button", { name: "Zaplanuj podróż", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  // The native submit button is disabled until valid; submitting the form exercises resolver messages.
  await dialog.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(dialog).toContainText("Podaj cel podróży");
  await dialog.getByLabel("Dokąd jedziesz?").fill("Barcelona");
  await dialog.getByLabel("W jakim kraju?").fill("Spain");
  await dialog.getByLabel("Ile dni masz do dyspozycji?").fill("3");
  await dialog.getByLabel("Kiedy zaczyna się podróż?").fill("2030-06-02");
  await dialog.getByLabel("Ile osób podróżuje?").fill("1");
  await dialog.getByRole("button", { name: "Elastyczny", exact: true }).click();
  await dialog.getByRole("button", { name: "Jedzenie", exact: true }).click();
  await responsive(page);
  await dialog.getByRole("button", { name: "Kontynuuj", exact: true }).click();
  await expect(dialog).toBeHidden();
  const calls = (await harness.state()).calls;
  await language(page, "en"); await page.getByRole("button", { name: "Adjust details" }).click();
  await expect(dialog.getByLabel("Where are you going?")).toHaveValue("Barcelona");
  await expect(dialog.getByLabel("Which country is that in?")).toHaveValue("Spain");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await language(page, "pl"); await page.reload(); await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  expect((await harness.state()).calls).toEqual(calls);
});

test("Polish Explore search, collection save and Saved preserve destination ownership", async ({ page, harness }) => {
  await page.goto("/login"); await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.goto("/explore"); await language(page, "pl");
  await page.getByRole("searchbox", { name: "Szukaj miejsc" }).fill("barce");
  await expect(page.locator("[data-destination-id]")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Kraj", exact: true }).click();
  await page.getByRole("option", { name: "Spain", exact: true }).click();
  await page.getByRole("link", { name: "Kulinarne weekendy", exact: true }).click();
  await page.getByRole("button", { name: "Zapisz: Barcelona", exact: true }).click();
  await expect(page.getByRole("button", { name: "Usuń z zapisanych: Barcelona", exact: true })).toBeVisible();
  await page.goto("/saved"); await expect(page.getByRole("heading", { name: "Zapisane miejsca", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Cel podróży: Barcelona" })).toBeVisible();
  const saved = await (await page.request.get("/api/saved/destinations")).json();
  await language(page, "en"); await page.reload();
  await expect(page.getByRole("article", { name: "Destination: Barcelona" })).toBeVisible();
  expect(await (await page.request.get("/api/saved/destinations")).json()).toEqual(saved);
  expect((await harness.state()).calls).toEqual([]);
});

test("redirects and unavailable routes preserve locale", async ({ page, user }) => {
  await login(page, user); await language(page, "pl");
  for (const path of ["/", "/nonexistent-route"]) {
    await page.goto(path); await expect(page).toHaveURL(/\/home$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  }
  await page.goto("/explore/collections/no-such-collection");
  await expect(page.getByRole("heading", { name: "Nie znaleziono kolekcji" })).toBeVisible();
  await page.goto("/shared/expired-token");
  await expect(page.getByRole("alert")).toContainText("Ta udostępniona podróż jest niedostępna");
  await language(page, "en"); await expect(page.getByRole("alert")).toContainText("This shared trip is unavailable");
});
