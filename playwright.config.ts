import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Never retried into green (constitution §4.3): a flaky test is quarantined with an issue instead.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  // The CI runner serves the production build, the PDF job's Chromium and two workers on two cores: a server
  // action can take longer than the 5 s default before the page reacts. Longer assertions are not retries.
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  // CI: the `github` reporter annotates the failing test and its error on the check run (the raw logs are
  // not always reachable); `line` keeps the console readable; `html` is uploaded as an artifact.
  reporter: process.env.CI ? [["github"], ["line"], ["html", { open: "never" }]] : "html",
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
          // F111 (audit D14): the RLS-enforced role, as CI and the box — a local green proves what CI's does
          DATABASE_URL: "postgresql://af_app:app@localhost:5433/af_test",
          DATABASE_MIGRATION_URL: "postgresql://af:test@localhost:5433/af_test",
          // F108: the e2e upload flows wait for the mock's readings; the mock runs only when named
          OCR_PROVIDER: "mock",
        },
      },
});
