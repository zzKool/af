import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
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
      name: "owner-tests",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/owner.json",
      },
      dependencies: ["owner-setup"],
      testMatch: "**/*.spec.ts",
      testIgnore: "**/fixtures/**",
    },
    {
      name: "accountant-tests",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/accountant.json",
      },
      dependencies: ["accountant-setup"],
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
