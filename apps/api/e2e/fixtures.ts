import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { TripRecord } from "../src/models/Trip.ts";
import type { Scenario } from "./data.ts";

interface UserFixture { email: string; password: string; tripId: string | null; now: string }
export interface ProviderState {
  calls: string[]; unexpected: string[]; sessions: number;
  preflights: { path: string; status: number; origin: string; credentials: string }[];
}
class Harness {
  constructor(private readonly request: APIRequestContext) {}
  async command<T = void>(path: string, data?: unknown): Promise<T> {
    const response = await this.request.post(path, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json() as Promise<T>;
  }
  async state(): Promise<ProviderState> {
    const response = await this.request.get("/state");
    expect(response.ok()).toBeTruthy(); return response.json() as Promise<ProviderState>;
  }
  async trip(id: string): Promise<TripRecord> {
    const response = await this.request.get(`/trip/${id}`);
    expect(response.ok()).toBeTruthy(); return response.json() as Promise<TripRecord>;
  }
  async advance(page: Page): Promise<void> {
    const { now } = await this.command<{ now: string }>("/advance");
    await page.clock.fastForward(11 * 60_000);
    await page.clock.setSystemTime(new Date(now));
  }
}

export const test = base.extend<{ scenario: Scenario; harness: Harness; user: UserFixture }>({
  scenario: ["empty", { option: true }],
  harness: async ({ playwright }, use, testInfo) => {
    if (testInfo.config.workers !== 1) throw new Error("This isolated smoke harness requires --workers=1");
    const token = process.env.TRIPLY_E2E_TOKEN;
    if (!token) throw new Error("Run with the root Playwright configuration");
    const request = await playwright.request.newContext({ baseURL: "http://127.0.0.1:4002", extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const harness = new Harness(request);
    try { await use(harness); }
    finally {
      const state = await harness.state();
      await harness.command("/cleanup");
      await request.dispose();
      expect(state.unexpected, "Unexpected backend provider requests").toEqual([]);
    }
  },
  user: async ({ harness, scenario }, use) => {
    await use(await harness.command<UserFixture>("/setup", { scenario }));
  },
  page: async ({ page, user }, use) => {
    await page.clock.install({ time: new Date(user.now) });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // Chromium's launch configuration blocks external DNS. Do not intercept
    // requests here: interception can change browser CORS/preflight behavior.
    await use(page);
    expect(errors, "Uncaught browser errors").toEqual([]);
  },
});
export { expect };

export async function login(page: Page, user: UserFixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel(/^Password/).fill(user.password);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
export async function openTrip(page: Page, id: string): Promise<void> {
  await page.goto(`/trips/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
export const timelineNames = (page: Page) => page.getByRole("button", { name: /^Reorder / });
export async function openExportMenu(page: Page): Promise<void> {
  if (await page.getByRole("menu").isVisible()) return;
  await page.getByRole("button", { name: /More export options|Więcej opcji eksportu/ }).click();
}
