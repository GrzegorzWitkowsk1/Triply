import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Each invocation owns its servers. Never attach to a development API/database.
process.env.TRIPLY_E2E_TOKEN ??= randomUUID();
export default defineConfig({
  testDir: "./apps/api/e2e",
  testMatch: "**/*.spec.ts",
  globalTeardown: "./apps/api/e2e/teardown.ts",
  // Shard individual independent tests; each shard still owns one serial worker.
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    headless: true,
    timezoneId: "Europe/Madrid",
    locale: "en-GB",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    launchOptions: { args: [
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      "--no-proxy-server",
    ] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bun run --cwd apps/api e2e:server",
      url: "http://127.0.0.1:4001/health",
      timeout: 120_000,
      reuseExistingServer: false,
      env: { NODE_ENV: "test", TZ: "UTC", TRIPLY_E2E: "1", TRIPLY_E2E_TOKEN: process.env.TRIPLY_E2E_TOKEN },
    },
    {
      command: "bun run --cwd apps/web dev --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      timeout: 60_000,
      reuseExistingServer: false,
      env: { TRIPLY_E2E_API_ORIGIN: "http://127.0.0.1:4001" },
    },
  ],
});
