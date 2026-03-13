import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          include: ["src/server/**/*.test.ts"],
          environment: "node",
          setupFiles: ["src/server/db/test-setup.ts"],
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "lib",
          include: ["src/lib/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          include: ["src/components/**/*.test.tsx", "src/hooks/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
