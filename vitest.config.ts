import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        name: "server",
        include: ["src/server/**/*.test.ts"],
        environment: "node",
        setupFiles: ["src/server/db/test-setup.ts"],
      },
      {
        name: "client",
        include: ["src/components/**/*.test.tsx", "src/lib/**/*.test.ts"],
        environment: "jsdom",
      },
    ],
  },
});
