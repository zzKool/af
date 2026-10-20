import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Never retried into green (constitution §4.3): a flaky test is quarantined with an issue instead.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "owner-setup",
      testMatch: /auth\.setup\.ts/,
      testDir: "./e2e/fixtures",
    },
    {
      name: "accountant-setup",
      testMatch: /auth-accountant\.setup\.ts/,
      testDir: "./e2e/fixtures",
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
      dependencies: ["owner-setup", "accountant-setup"],
      testMatch: "**/*.spec.ts",
      testIgnore: "**/fixtures/**",
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        env: {
          DATABASE_URL: "postgresql://defterfab:test@localhost:5433/defterfab_test",
        },
      },
});
